import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { projects } from '../db/schema.js'
import { decrypt } from '../db/crypto.js'
import type {
  Project,
  GitInfo,
  GitBranch,
  GitCommit,
  GitDiff,
  DiffPatch,
  DiffLine,
} from '@mydevbox/shared'

/**
 * HTTP 상태 코드가 포함된 커스텀 에러
 */
class GitServiceError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'GitServiceError'
    this.statusCode = statusCode
  }
}

/**
 * 인증 정보를 포함한 remote URL 생성
 * https://github.com/user/repo.git → https://user:token@github.com/user/repo.git
 */
function buildAuthUrl(remoteUrl: string, username?: string, token?: string): string {
  if (!token) return remoteUrl
  const user = username ?? 'x-access-token'
  return remoteUrl.replace(
    /^(https?:\/\/)/,
    `$1${encodeURIComponent(user)}:${encodeURIComponent(token)}@`,
  )
}

export class GitService {
  /**
   * 프로젝트 ID로 프로젝트 정보 조회 (git config 포함)
   */
  private async getProject(projectId: string): Promise<Project> {
    const rows = await db.select().from(projects).where(eq(projects.id, projectId))
    if (rows.length === 0) {
      throw new GitServiceError(`Project not found: ${projectId}`, 404)
    }

    const row = rows[0]
    const hasGit = !!row.gitRemoteUrl

    // 토큰 복호화
    let token: string | undefined
    if (row.gitTokenEncrypted) {
      try {
        token = decrypt(row.gitTokenEncrypted)
      } catch {
        token = undefined
      }
    }

    return {
      id: row.id,
      name: row.name,
      path: row.path,
      status: (row.status ?? 'idle') as Project['status'],
      description: row.description ?? undefined,
      gitConfig: hasGit
        ? {
            remoteUrl: row.gitRemoteUrl!,
            username: row.gitUsername ?? undefined,
            token,
          }
        : undefined,
      lastOpenedAt: row.lastOpenedAt?.toISOString(),
    }
  }

  /**
   * simple-git 인스턴스 생성
   */
  private getGit(projectPath: string): SimpleGit {
    return simpleGit(projectPath)
  }

  /**
   * git 저장소 여부 확인
   */
  async isRepo(projectId: string): Promise<boolean> {
    const project = await this.getProject(projectId)
    try {
      const git = this.getGit(project.path)
      return await git.checkIsRepo()
    } catch {
      return false
    }
  }

  // ============ 상태 조회 ============

  /**
   * git status 조회 → GitInfo 반환
   */
  async getStatus(projectId: string): Promise<GitInfo> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    const status = await git.status()

    // remote URL 조회
    let remote: string | undefined
    try {
      const remotes = await git.getRemotes(true)
      remote = remotes.find((r) => r.name === 'origin')?.refs.fetch
    } catch {
      remote = undefined
    }

    return {
      branch: status.current ?? 'HEAD',
      remote,
      ahead: status.ahead,
      behind: status.behind,
      modified: status.modified.length,
      staged: status.staged.length,
      untracked: status.not_added.length,
    }
  }

  // ============ 브랜치 관리 ============

  /**
   * 브랜치 목록 조회
   */
  async getBranches(projectId: string): Promise<GitBranch[]> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    const branches = await git.branchLocal()
    const result: GitBranch[] = []

    for (const name of branches.all) {
      const isCurrent = name === branches.current

      // 마지막 커밋 메시지 조회
      let lastCommit: string | undefined
      try {
        const log = await git.log({ maxCount: 1, [name]: undefined })
        lastCommit = log.latest?.message.split('\n')[0]
      } catch {
        lastCommit = undefined
      }

      result.push({
        name,
        current: isCurrent,
        remote: false,
        lastCommit,
      })
    }

    return result
  }

  /**
   * 브랜치 체크아웃
   */
  async checkout(projectId: string, branch: string, create: boolean): Promise<GitInfo> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    // 커밋되지 않은 변경사항 확인
    const status = await git.status()
    const hasChanges = status.modified.length > 0 ||
      status.not_added.length > 0 ||
      status.staged.length > 0

    if (hasChanges && !create) {
      throw new GitServiceError(
        'Cannot checkout: uncommitted changes. Commit or stash first.',
        409,
      )
    }

    try {
      if (create) {
        await git.checkoutLocalBranch(branch)
      } else {
        // 브랜치 존재 확인
        const branches = await git.branchLocal()
        if (!branches.all.includes(branch)) {
          throw new GitServiceError(`Branch not found: ${branch}`, 404)
        }
        await git.checkout(branch)
      }
    } catch (e) {
      if (e instanceof GitServiceError) throw e
      throw new GitServiceError(`Checkout failed: ${(e as Error).message}`, 400)
    }

    return this.getStatus(projectId)
  }

  // ============ 커밋 ============

  /**
   * 커밋 생성
   */
  async commit(
    projectId: string,
    message: string,
    files?: string[],
    amend?: boolean,
  ): Promise<GitInfo> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    // 스테이지
    if (files && files.length > 0) {
      await git.add(files)
    } else {
      await git.add('-A')
    }

    // 커밋할 내용이 있는지 확인
    const status = await git.status()
    if (status.staged.length === 0 && !amend) {
      throw new GitServiceError('Nothing to commit', 400)
    }

    try {
      if (amend) {
        await git.commit(message, undefined, { '--amend': null })
      } else {
        await git.commit(message)
      }
    } catch (e) {
      throw new GitServiceError(`Commit failed: ${(e as Error).message}`, 400)
    }

    return this.getStatus(projectId)
  }

  // ============ Push / Pull ============

  /**
   * 원격 저장소 push
   */
  async push(projectId: string, force?: boolean): Promise<void> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    // remote 존재 확인
    const remotes = await git.getRemotes(true)
    if (remotes.length === 0) {
      throw new GitServiceError('No remote repository configured', 400)
    }

    // 토큰 인증 처리
    const originalUrl = project.gitConfig?.remoteUrl
    const token = project.gitConfig?.token
    const username = project.gitConfig?.username

    if (token) {
      const authUrl = buildAuthUrl(originalUrl!, username, token)
      try {
        await git.remote(['set-url', 'origin', authUrl])
      } catch {
        // ignore
      }
    }

    try {
      await git.push('origin', undefined, force ? { '--force': null } : undefined)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('Authentication') || msg.includes('401') || msg.includes('403')) {
        throw new GitServiceError('Authentication failed: invalid token', 401)
      }
      throw new GitServiceError(`Push failed: ${msg}`, 400)
    } finally {
      // 원래 URL로 복원
      if (token && originalUrl) {
        try {
          await git.remote(['set-url', 'origin', originalUrl])
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 원격 저장소 pull
   */
  async pull(projectId: string): Promise<GitInfo> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    const remotes = await git.getRemotes(true)
    if (remotes.length === 0) {
      throw new GitServiceError('No remote repository configured', 400)
    }

    // 토큰 인증 처리
    const originalUrl = project.gitConfig?.remoteUrl
    const token = project.gitConfig?.token
    const username = project.gitConfig?.username

    if (token) {
      const authUrl = buildAuthUrl(originalUrl!, username, token)
      try {
        await git.remote(['set-url', 'origin', authUrl])
      } catch {
        // ignore
      }
    }

    try {
      await git.pull('origin')
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('Authentication') || msg.includes('401') || msg.includes('403')) {
        throw new GitServiceError('Authentication failed: invalid token', 401)
      }
      if (msg.includes('conflict') || msg.includes('CONFLICT')) {
        throw new GitServiceError('Merge conflict detected', 409)
      }
      throw new GitServiceError(`Pull failed: ${msg}`, 400)
    } finally {
      if (token && originalUrl) {
        try {
          await git.remote(['set-url', 'origin', originalUrl])
        } catch {
          // ignore
        }
      }
    }

    return this.getStatus(projectId)
  }

  // ============ 커밋 히스토리 ============

  /**
   * 커밋 히스토리 조회
   */
  async getLog(
    projectId: string,
    limit: number = 50,
    branch?: string,
  ): Promise<GitCommit[]> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    let log
    try {
      log = await git.log({
        maxCount: limit,
        ...(branch ? { from: branch, to: 'HEAD' } : {}),
      })
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('unknown revision')) {
        throw new GitServiceError(`Branch not found: ${branch}`, 404)
      }
      throw new GitServiceError(`Log failed: ${msg}`, 400)
    }

    const result: GitCommit[] = []

    for (const entry of log.all) {
      // 커밋당 변경된 파일 수 조회
      let filesChanged = 0
      try {
        const diff = await git.diffSummary([entry.hash, `${entry.hash}~1`])
        filesChanged = diff.files.length
      } catch {
        filesChanged = 0
      }

      result.push({
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        author: entry.author_name,
        email: entry.author_email,
        date: entry.date,
        message: entry.message.split('\n')[0],
        filesChanged,
      })
    }

    return result
  }

  // ============ Diff 조회 ============

  /**
   * 변경사항 diff 조회
   */
  async getDiff(
    projectId: string,
    file?: string,
    staged: boolean = false,
  ): Promise<GitDiff[]> {
    const project = await this.getProject(projectId)
    const git = this.getGit(project.path)

    if (!(await git.checkIsRepo())) {
      throw new GitServiceError('Not a git repository', 400)
    }

    // diff 데이터 조회
    const diffArgs: string[] = []
    if (staged) diffArgs.push('--cached')
    if (file) diffArgs.push('--', file)

    let rawDiff: string
    try {
      rawDiff = await git.diff(diffArgs)
    } catch {
      return []
    }

    if (!rawDiff) return []

    return this.parseUnifiedDiff(rawDiff)
  }

  /**
   * unified diff 형식 파싱
   */
  private parseUnifiedDiff(diff: string): GitDiff[] {
    const results: GitDiff[] = []
    const files = diff.split(/^diff --git /m).filter(Boolean)

    for (const fileDiff of files) {
      const lines = fileDiff.split('\n')
      let fileName = ''
      let additions = 0
      let deletions = 0
      const patches: DiffPatch[] = []
      let currentPatch: DiffPatch | null = null
      let oldLine = 0
      let newLine = 0

      for (const line of lines) {
        // 파일명 추출
        if (line.startsWith('diff --git')) {
          const match = line.match(/diff --git a\/(.+) b\/(.+)/)
          if (match) fileName = match[2]
        }

        // +++ b/file.txt
        if (line.startsWith('+++ ')) {
          const match = line.match(/^\+\+\+ b\/(.+)/)
          if (match && !fileName) fileName = match[1]
        }

        // hunk header: @@ -oldStart,oldLen +newStart,newLen @@
        const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (hunkMatch) {
          if (currentPatch) patches.push(currentPatch)
          oldLine = parseInt(hunkMatch[1], 10)
          newLine = parseInt(hunkMatch[2], 10)
          currentPatch = {
            oldStart: oldLine,
            oldEnd: oldLine,
            newStart: newLine,
            newEnd: newLine,
            lines: [],
          }
          continue
        }

        if (!currentPatch) continue

        const diffLine: DiffLine = { type: 'context', content: line }

        if (line.startsWith('+') && !line.startsWith('+++')) {
          diffLine.type = 'add'
          diffLine.content = line.slice(1)
          diffLine.lineNumber = newLine
          additions++
          newLine++
          currentPatch.newEnd = newLine - 1
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          diffLine.type = 'delete'
          diffLine.content = line.slice(1)
          diffLine.lineNumber = oldLine
          deletions++
          oldLine++
          currentPatch.oldEnd = oldLine - 1
        } else if (line.startsWith(' ')) {
          diffLine.type = 'context'
          diffLine.content = line.slice(1)
          diffLine.lineNumber = newLine
          oldLine++
          newLine++
          currentPatch.oldEnd = oldLine - 1
          currentPatch.newEnd = newLine - 1
        } else {
          continue
        }

        currentPatch.lines.push(diffLine)
      }

      if (currentPatch) patches.push(currentPatch)

      if (fileName) {
        results.push({ file: fileName, additions, deletions, patches })
      }
    }

    return results
  }

  // ============ 파일별 git 상태 ============

  /**
   * 파일별 git 상태 맵 반환 (FileTree 연동용)
   * Map<relativePath, 'modified' | 'staged' | 'untracked'>
   */
  async getFileStatuses(projectPath: string): Promise<Map<string, 'modified' | 'staged' | 'untracked'>> {
    const map = new Map<string, 'modified' | 'staged' | 'untracked'>()

    try {
      const git = this.getGit(projectPath)
      if (!(await git.checkIsRepo())) return map

      const status = await git.status()

      for (const file of status.modified) map.set(file, 'modified')
      for (const file of status.staged) map.set(file, 'staged')
      for (const file of status.not_added) map.set(file, 'untracked')

      // renamed 파일 처리
      for (const rename of status.renamed) {
        const newPath = typeof rename === 'string' ? rename : rename.to
        map.set(newPath, 'modified')
      }
    } catch {
      // git 저장소가 아니거나 에러 시 빈 맵 반환
    }

    return map
  }
}

export const gitService = new GitService()
