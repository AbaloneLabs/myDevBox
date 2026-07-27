import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rgPath } from '@vscode/ripgrep'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { projects } from '../db/schema.js'
import { resolveProjectPath, toRelativePath, PathTraversalError } from './path-service.js'
import { detectLanguage, shouldIgnore } from './file-utils.js'
import { gitService } from './git-service.js'
import type {
  FileNode,
  FileContent,
  SearchResult,
  SearchMatch,
} from '@mydevbox/shared'

const execFileAsync = promisify(execFile)

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const SEARCH_TIMEOUT_MS = 10_000
const SEARCH_MAX_RESULTS = 1000

/**
 * HTTP 상태 코드가 포함된 커스텀 에러
 */
class FileServiceError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'FileServiceError'
    this.statusCode = statusCode
  }
}

export class FileService {
  /**
   * 프로젝트 ID로 프로젝트 경로 조회
   */
  private async getProjectPath(projectId: string): Promise<string> {
    const rows = await db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, projectId))

    if (rows.length === 0) {
      throw new FileServiceError(`Project not found: ${projectId}`, 404)
    }
    return rows[0].path
  }

  // ============ 디렉토리 트리 ============

  /**
   * 디렉토리 트리 조회
   */
  async getTree(
    projectId: string,
    subPath: string = '.',
    maxDepth: number = 10,
    showHidden: boolean = false,
  ): Promise<FileNode[]> {
    const projectPath = await this.getProjectPath(projectId)
    const rootPath = resolveProjectPath(projectPath, subPath)

    if (!fs.existsSync(rootPath)) {
      throw new FileServiceError(`Path not found: ${subPath}`, 404)
    }

    const stat = fs.statSync(rootPath)
    if (!stat.isDirectory()) {
      throw new FileServiceError(`Path is not a directory: ${subPath}`, 400)
    }

    // git 파일 상태 조회 (프로젝트 루트 기준)
    const gitStatuses = await gitService.getFileStatuses(projectPath)

    return this.buildTree(rootPath, projectPath, 0, maxDepth, showHidden, gitStatuses)
  }

  /**
   * 재귀적으로 트리 구성
   */
  private buildTree(
    dirPath: string,
    projectRoot: string,
    currentDepth: number,
    maxDepth: number,
    showHidden: boolean,
    gitStatuses?: Map<string, 'modified' | 'staged' | 'untracked'>,
  ): FileNode[] {
    if (currentDepth >= maxDepth) return []

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    // 디렉토리를 먼저, 파일을 나중에 (VS Code 스타일)
    const sorted = entries.sort((a, b) => {
      const aIsDir = a.isDirectory()
      const bIsDir = b.isDirectory()
      if (aIsDir && !bIsDir) return -1
      if (!aIsDir && bIsDir) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of sorted) {
      // 숨김 파일 및 ignore 패턴 제외
      if (!showHidden && (entry.name.startsWith('.') || shouldIgnore(entry.name))) {
        continue
      }

      const fullPath = path.join(dirPath, entry.name)
      const relativePath = toRelativePath(projectRoot, fullPath)

      if (entry.isDirectory()) {
        const children = this.buildTree(
          fullPath,
          projectRoot,
          currentDepth + 1,
          maxDepth,
          showHidden,
          gitStatuses,
        )
        nodes.push({
          id: relativePath,
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
        })
      } else {
        nodes.push({
          id: relativePath,
          name: entry.name,
          path: relativePath,
          type: 'file',
          language: detectLanguage(entry.name),
          gitStatus: gitStatuses?.get(relativePath) ?? 'unmodified',
        })
      }
    }

    return nodes
  }

  // ============ 파일 읽기 ============

  /**
   * 파일 내용 읽기
   */
  async readFile(
    projectId: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<FileContent> {
    const projectPath = await this.getProjectPath(projectId)
    const fullPath = resolveProjectPath(projectPath, filePath)

    if (!fs.existsSync(fullPath)) {
      throw new FileServiceError(`File not found: ${filePath}`, 404)
    }

    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      throw new FileServiceError(`Path is a directory: ${filePath}`, 400)
    }

    // 파일 크기 제한
    if (stat.size > MAX_FILE_SIZE) {
      throw new FileServiceError(
        `File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE} bytes)`,
        413,
      )
    }

    const buffer = fs.readFileSync(fullPath)

    // 바이너리 파일 감지 (NUL 바이트 확인)
    if (this.isBinary(buffer)) {
      return {
        path: filePath,
        content: '',
        language: detectLanguage(filePath),
        size: stat.size,
        lineCount: 0,
        isBinary: true,
      }
    }

    const fullContent = buffer.toString('utf-8')
    const allLines = fullContent.split('\n')

    // 부분 읽기
    let content = fullContent
    if (startLine !== undefined || endLine !== undefined) {
      const start = (startLine ?? 1) - 1
      const end = endLine ?? allLines.length
      content = allLines.slice(start, end).join('\n')
    }

    return {
      path: filePath,
      content,
      language: detectLanguage(filePath),
      size: stat.size,
      lineCount: allLines.length,
      isBinary: false,
    }
  }

  /**
   * 바이너리 파일 감지 - NUL 바이트가 있으면 바이너리
   */
  private isBinary(buffer: Buffer): boolean {
    // 처음 8192바이트만 검사
    const checkLength = Math.min(buffer.length, 8192)
    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) return true
    }
    return false
  }

  // ============ 파일 쓰기 ============

  /**
   * 파일 쓰기 (생성/수정)
   */
  async writeFile(
    projectId: string,
    filePath: string,
    content: string,
    overwrite: boolean = false,
  ): Promise<FileContent> {
    const projectPath = await this.getProjectPath(projectId)
    const fullPath = resolveProjectPath(projectPath, filePath)

    // 덮어쓰기 금지인 경우 기존 파일 확인
    if (!overwrite && fs.existsSync(fullPath)) {
      throw new FileServiceError(
        `File already exists: ${filePath}. Set overwrite=true to replace.`,
        409,
      )
    }

    // 상위 디렉토리 자동 생성
    const parentDir = path.dirname(fullPath)
    fs.mkdirSync(parentDir, { recursive: true })

    // 파일 쓰기
    fs.writeFileSync(fullPath, content, 'utf-8')

    const stat = fs.statSync(fullPath)
    const lineCount = content.split('\n').length

    return {
      path: filePath,
      content,
      language: detectLanguage(filePath),
      size: stat.size,
      lineCount,
      isBinary: false,
    }
  }

  // ============ 파일 삭제 ============

  /**
   * 파일 또는 디렉토리 삭제
   */
  async deleteFile(projectId: string, filePath: string): Promise<void> {
    const projectPath = await this.getProjectPath(projectId)
    const fullPath = resolveProjectPath(projectPath, filePath)

    if (!fs.existsSync(fullPath)) {
      throw new FileServiceError(`File not found: ${filePath}`, 404)
    }

    const stat = fs.statSync(fullPath)
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true })
    } else {
      fs.unlinkSync(fullPath)
    }
  }

  // ============ 이름 변경 ============

  /**
   * 파일/폴더 이름 변경 또는 이동
   */
  async rename(
    projectId: string,
    oldPath: string,
    newPath: string,
  ): Promise<FileNode> {
    const projectPath = await this.getProjectPath(projectId)
    const fullOld = resolveProjectPath(projectPath, oldPath)
    const fullNew = resolveProjectPath(projectPath, newPath)

    if (!fs.existsSync(fullOld)) {
      throw new FileServiceError(`File not found: ${oldPath}`, 404)
    }

    if (fs.existsSync(fullNew)) {
      throw new FileServiceError(`Target already exists: ${newPath}`, 409)
    }

    // 상위 디렉토리 자동 생성
    const parentDir = path.dirname(fullNew)
    fs.mkdirSync(parentDir, { recursive: true })

    fs.renameSync(fullOld, fullNew)

    const stat = fs.statSync(fullNew)
    const relativeNew = toRelativePath(projectPath, fullNew)

    return {
      id: relativeNew,
      name: path.basename(fullNew),
      path: relativeNew,
      type: stat.isDirectory() ? 'directory' : 'file',
      language: stat.isFile() ? detectLanguage(relativeNew) : undefined,
    }
  }

  // ============ 디렉토리 생성 ============

  /**
   * 디렉토리 생성
   */
  async mkdir(projectId: string, dirPath: string): Promise<FileNode> {
    const projectPath = await this.getProjectPath(projectId)
    const fullPath = resolveProjectPath(projectPath, dirPath)

    if (fs.existsSync(fullPath)) {
      throw new FileServiceError(`Directory already exists: ${dirPath}`, 409)
    }

    fs.mkdirSync(fullPath, { recursive: true })

    const relativePath = toRelativePath(projectPath, fullPath)

    return {
      id: relativePath,
      name: path.basename(fullPath),
      path: relativePath,
      type: 'directory',
      children: [],
    }
  }

  // ============ 파일 검색 (ripgrep) ============

  /**
   * ripgrep을 사용한 파일 내용 검색
   */
  async search(
    projectId: string,
    pattern: string,
    glob?: string,
    outputMode: 'content' | 'files_with_matches' | 'count' = 'files_with_matches',
    contextLines: number = 0,
  ): Promise<SearchResult> {
    const projectPath = await this.getProjectPath(projectId)

    if (!fs.existsSync(projectPath)) {
      throw new FileServiceError(`Project path not found: ${projectPath}`, 404)
    }

    const rgBinPath = rgPath
    const args: string[] = ['--json', '--max-count', String(SEARCH_MAX_RESULTS)]

    if (glob) {
      args.push('--glob', glob)
    }

    if (contextLines > 0) {
      args.push('--before-context', String(contextLines))
      args.push('--after-context', String(contextLines))
    }

    // ignore 패턴 적용
    for (const ignorePattern of ['node_modules', '.git', 'dist', 'build']) {
      args.push('--glob', `!${ignorePattern}`)
    }

    args.push(pattern, projectPath)

    let stdout: string
    try {
      const result = await execFileAsync(rgBinPath, args, {
        timeout: SEARCH_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        cwd: projectPath,
      })
      stdout = result.stdout
    } catch (e) {
      // ripgrep은 매치가 없으면 exit code 1로 종료함
      const err = e as { code?: number; stdout?: string; stderr?: string }
      if (err.code === 1) {
        stdout = err.stdout ?? ''
      } else if (err.code === 2) {
        throw new FileServiceError(
          `Search error: ${err.stderr ?? 'ripgrep failed'}`,
          500,
        )
      } else {
        throw new FileServiceError(
          `Search failed: ${(e as Error).message}`,
          500,
        )
      }
    }

    return this.parseRipgrepJson(stdout, projectPath, outputMode)
  }

  /**
   * ripgrep --json 출력 파싱
   */
  private parseRipgrepJson(
    stdout: string,
    projectRoot: string,
    outputMode: 'content' | 'files_with_matches' | 'count',
  ): SearchResult {
    const matches: SearchMatch[] = []
    const lines = stdout.trim().split('\n').filter(Boolean)
    let truncated = false

    const contextBuffer: Record<string, { before?: string[]; after?: string[] }> = {}

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)

        if (msg.type === 'match') {
          if (matches.length >= SEARCH_MAX_RESULTS) {
            truncated = true
            break
          }

          const filePath = toRelativePath(projectRoot, msg.data.path.text)
          const matchText = msg.data.lines.text
          const lineNumber = msg.data.line_number
          const column = msg.data.submatches?.[0]?.start

          const match: SearchMatch = {
            file: filePath,
            line: lineNumber,
            content: matchText.replace(/\n$/, ''),
          }

          if (column !== undefined) {
            match.column = column + 1
          }

          // context 정보가 있으면 추가
          const key = `${filePath}:${lineNumber}`
          if (contextBuffer[key]) {
            match.beforeContext = contextBuffer[key].before
            match.afterContext = contextBuffer[key].after
            delete contextBuffer[key]
          }

          if (outputMode === 'content') {
            matches.push(match)
          } else if (outputMode === 'files_with_matches') {
            // files_with_matches: 파일당 한 번만
            if (!matches.some((m) => m.file === filePath)) {
              matches.push(match)
            }
          }
        } else if (msg.type === 'context') {
          // context 라인 처리 (before/after context)
          const filePath = toRelativePath(projectRoot, msg.data.path.text)
          const lineNumber = msg.data.line_number
          const text = msg.data.lines.text.replace(/\n$/, '')

          // 가장 가까운 match를 찾아 context 추가
          const lastMatch = matches[matches.length - 1]
          if (lastMatch && lastMatch.file === filePath) {
            if (lineNumber < lastMatch.line) {
              lastMatch.beforeContext = [...(lastMatch.beforeContext ?? []), text]
            } else if (lineNumber > lastMatch.line) {
              lastMatch.afterContext = [...(lastMatch.afterContext ?? []), text]
            }
          }
        }
      } catch {
        // JSON 파싱 실패 시 해당 라인 스킵
        continue
      }
    }

    return { matches, truncated }
  }
}

export const fileService = new FileService()
