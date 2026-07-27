import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { db } from '../db/connection.js'
import { projects } from '../db/schema.js'
import { encrypt } from '../db/crypto.js'
import { expandTilde, validateProjectPath, isGitRepo } from './path-service.js'
import type { Project, ScannedDir, ProjectStatus } from '@mydevbox/shared'
import type { CreateProjectInput, UpdateProjectInput } from '@mydevbox/shared'

/**
 * DB 행을 API 응답용 Project 객체로 변환
 */
function rowToProject(row: typeof projects.$inferSelect): Project {
  const hasGit = !!row.gitRemoteUrl
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    status: (row.status ?? 'idle') as ProjectStatus,
    description: row.description ?? undefined,
    gitConfig: hasGit
      ? {
          remoteUrl: row.gitRemoteUrl!,
          username: row.gitUsername ?? undefined,
          // token은 평문으로 반환하지 않음 (암호화된 값만 DB에 저장)
        }
      : undefined,
    lastOpenedAt: row.lastOpenedAt?.toISOString(),
  }
}

/**
 * 인증 정보를 포함한 clone URL 생성
 * https://github.com/user/repo.git → https://user:token@github.com/user/repo.git
 */
function buildAuthUrl(remoteUrl: string, username?: string, token?: string): string {
  if (!token) return remoteUrl
  const user = username ?? 'x-access-token' // GitHub PAT 기본값
  return remoteUrl.replace(
    /^(https?:\/\/)/,
    `$1${encodeURIComponent(user)}:${encodeURIComponent(token)}@`
  )
}

export class ProjectService {
  /**
   * 프로젝트 목록 조회 (lastOpenedAt 내림차순)
   */
  async list(): Promise<Project[]> {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(projects.lastOpenedAt)

    // lastOpenedAt이 null인 것은 createdAt 기준으로 정렬
    const allRows = await db.select().from(projects)
    const sorted = allRows.sort((a, b) => {
      const aTime = a.lastOpenedAt?.getTime() ?? a.createdAt.getTime()
      const bTime = b.lastOpenedAt?.getTime() ?? b.createdAt.getTime()
      return bTime - aTime
    })

    return sorted.map(rowToProject)
  }

  /**
   * 프로젝트 상세 조회
   */
  async getById(id: string): Promise<Project | null> {
    const rows = await db.select().from(projects).where(eq(projects.id, id))
    if (rows.length === 0) return null
    return rowToProject(rows[0])
  }

  /**
   * 프로젝트 생성
   * - gitConfig가 있으면 git clone 수행
   * - 토큰은 AES-256-GCM 암호화 후 DB 저장
   */
  async create(input: CreateProjectInput): Promise<Project> {
    const resolvedPath = path.resolve(expandTilde(input.path))

    // 중복 경로 확인
    const existing = await db.select().from(projects).where(eq(projects.path, resolvedPath))
    if (existing.length > 0) {
      const err = new Error('Project already registered with this path')
      ;(err as Error & { statusCode?: number }).statusCode = 409
      throw err
    }

    // git clone이 필요한 경우
    if (input.gitConfig?.remoteUrl) {
      const { remoteUrl, username, token } = input.gitConfig

      // 경로가 이미 존재하면 clone 불가 (빈 디렉토리가 아닌 경우)
      if (fs.existsSync(resolvedPath)) {
        const stat = fs.statSync(resolvedPath)
        if (!stat.isDirectory()) {
          const err = new Error(`Path is not a directory: ${resolvedPath}`)
          ;(err as Error & { statusCode?: number }).statusCode = 400
          throw err
        }
        const files = fs.readdirSync(resolvedPath)
        if (files.length > 0) {
          const err = new Error(`Directory is not empty, cannot clone: ${resolvedPath}`)
          ;(err as Error & { statusCode?: number }).statusCode = 400
          throw err
        }
      } else {
        // 디렉토리 생성
        fs.mkdirSync(resolvedPath, { recursive: true })
      }

      // git clone 실행
      try {
        const authUrl = buildAuthUrl(remoteUrl, username, token)
        const git = simpleGit()
        await git.clone(authUrl, resolvedPath)
      } catch (e) {
        const err = new Error(`Git clone failed: ${(e as Error).message}`)
        ;(err as Error & { statusCode?: number }).statusCode = 422
        throw err
      }
    } else {
      // 로컬 프로젝트: 경로 존재 확인
      const validation = validateProjectPath(resolvedPath)
      if (!validation.valid) {
        const err = new Error(validation.error!)
        ;(err as Error & { statusCode?: number }).statusCode = 400
        throw err
      }
    }

    // DB에 저장
    const tokenEncrypted = input.gitConfig?.token
      ? encrypt(input.gitConfig.token)
      : null

    const [row] = await db
      .insert(projects)
      .values({
        name: input.name,
        path: resolvedPath,
        description: input.description ?? null,
        gitRemoteUrl: input.gitConfig?.remoteUrl ?? null,
        gitUsername: input.gitConfig?.username ?? null,
        gitTokenEncrypted: tokenEncrypted,
        status: 'idle',
      })
      .returning()

    return rowToProject(row)
  }

  /**
   * 프로젝트 수정
   */
  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.getById(id)
    if (!existing) {
      const err = new Error(`Project not found: ${id}`)
      ;(err as Error & { statusCode?: number }).statusCode = 404
      throw err
    }

    const updates: Partial<typeof projects.$inferInsert> = {}

    if (input.name !== undefined) updates.name = input.name
    if (input.description !== undefined) updates.description = input.description ?? null
    if (input.path !== undefined) {
      updates.path = path.resolve(expandTilde(input.path))
    }
    if (input.gitConfig !== undefined) {
      if (input.gitConfig === undefined) {
        // gitConfig 제거
        updates.gitRemoteUrl = null
        updates.gitUsername = null
        updates.gitTokenEncrypted = null
      } else {
        updates.gitRemoteUrl = input.gitConfig.remoteUrl
        updates.gitUsername = input.gitConfig.username ?? null
        if (input.gitConfig.token) {
          updates.gitTokenEncrypted = encrypt(input.gitConfig.token)
        }
      }
    }

    const [row] = await db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, id))
      .returning()

    return rowToProject(row)
  }

  /**
   * 프로젝트 삭제
   * @param deleteFiles true면 실제 파일도 삭제
   */
  async delete(id: string, deleteFiles: boolean): Promise<void> {
    const existing = await this.getById(id)
    if (!existing) {
      const err = new Error(`Project not found: ${id}`)
      ;(err as Error & { statusCode?: number }).statusCode = 404
      throw err
    }

    // 연관 데이터는 cascade로 자동 삭제 (스키마 설정)
    await db.delete(projects).where(eq(projects.id, id))

    if (deleteFiles && fs.existsSync(existing.path)) {
      fs.rmSync(existing.path, { recursive: true, force: true })
    }
  }

  /**
   * 프로젝트 열기 (lastOpenedAt 갱신)
   */
  async open(id: string): Promise<Project> {
    const existing = await this.getById(id)
    if (!existing) {
      const err = new Error(`Project not found: ${id}`)
      ;(err as Error & { statusCode?: number }).statusCode = 404
      throw err
    }

    // 경로 재확인 (삭제되었을 수 있음)
    if (!fs.existsSync(existing.path)) {
      const err = new Error(`Project path no longer exists: ${existing.path}`)
      ;(err as Error & { statusCode?: number }).statusCode = 400
      throw err
    }

    const [row] = await db
      .update(projects)
      .set({
        lastOpenedAt: new Date(),
        status: 'active',
      })
      .where(eq(projects.id, id))
      .returning()

    return rowToProject(row)
  }

  /**
   * 디렉토리 스캔 - 하위 폴더 목록 반환
   * 프로젝트 추가 폼에서 경로 탐색용
   */
  async scanDir(dir: string): Promise<ScannedDir[]> {
    const resolved = path.resolve(expandTilde(dir))

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return []
    }

    // 이미 등록된 경로 목록 조회
    const registeredRows = await db.select({ path: projects.path }).from(projects)
    const registeredPaths = new Set(registeredRows.map((r) => r.path))

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const dirs = entries.filter((e) => e.isDirectory())

    const results: ScannedDir[] = []

    for (const d of dirs) {
      // 숨김 폴더 제외 (.git, .cache, node_modules 등)
      if (d.name.startsWith('.') || d.name === 'node_modules') continue

      const fullPath = path.join(resolved, d.name)
      const gitRepo = isGitRepo(fullPath)

      let hasRemote = false
      if (gitRepo) {
        try {
          const git = simpleGit(fullPath)
          const remotes = await git.getRemotes(true)
          hasRemote = remotes.length > 0
        } catch {
          hasRemote = false
        }
      }

      results.push({
        name: d.name,
        path: fullPath,
        isGitRepo: gitRepo,
        hasRemote,
        isRegistered: registeredPaths.has(fullPath),
      })
    }

    return results.sort((a, b) => a.name.localeCompare(b.name))
  }
}

export const projectService = new ProjectService()
