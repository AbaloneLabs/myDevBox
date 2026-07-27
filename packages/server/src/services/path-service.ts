import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/**
 * 크로스 플랫폼 tilde 확장
 * ~/repos → /home/user/repos (Linux/Mac) 또는 C:\Users\user\repos (Windows)
 */
export function expandTilde(p: string): string {
  if (p === '~') {
    return os.homedir()
  }
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2))
  }
  return p
}

/**
 * 프로젝트 경로 내의 상대 경로를 절대 경로로 해결
 * path traversal 공격 차단: 프로젝트 루트 밖으로 나갈 수 없음
 */
export function resolveProjectPath(projectRoot: string, relativePath: string): string {
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(root, relativePath)

  // 프로젝트 루트 내부인지 확인 (path traversal 방지)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new PathTraversalError(
      `Access denied: path outside project root: ${relativePath}`
    )
  }

  return resolved
}

/**
 * 절대 경로를 프로젝트 루트 기준 상대 경로로 변환
 */
export function toRelativePath(projectRoot: string, absolutePath: string): string {
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(absolutePath)
  if (resolved === root) return '.'
  if (resolved.startsWith(root + path.sep)) {
    return resolved.slice(root.length + 1)
  }
  return absolutePath
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

export interface PathValidation {
  valid: boolean
  resolved: string
  exists: boolean
  isDirectory: boolean
  error?: string
}

/**
 * 프로젝트 경로 유효성 검사
 */
export function validateProjectPath(p: string): PathValidation {
  const resolved = path.resolve(expandTilde(p))

  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      resolved,
      exists: false,
      isDirectory: false,
      error: `Project path does not exist: ${resolved}`,
    }
  }

  const stat = fs.statSync(resolved)
  if (!stat.isDirectory()) {
    return {
      valid: false,
      resolved,
      exists: true,
      isDirectory: false,
      error: `Path is not a directory: ${resolved}`,
    }
  }

  return {
    valid: true,
    resolved,
    exists: true,
    isDirectory: true,
  }
}

/**
 * 디렉토리가 git 저장소인지 확인 (.git 폴더 존재 여부)
 */
export function isGitRepo(dirPath: string): boolean {
  const gitDir = path.join(dirPath, '.git')
  return fs.existsSync(gitDir)
}
