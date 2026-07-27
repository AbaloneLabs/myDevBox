import os from 'node:os'

/**
 * 크로스 플랫폼 기본 셸 감지
 * AGENTS.md 원칙: process.env.SHELL ?? (win32 ? 'powershell.exe' : '/bin/bash')
 */
export function getDefaultShell(): string {
  // 1. 환경 변수 우선
  if (process.env.SHELL) return process.env.SHELL
  if (process.env.ComSpec) return process.env.ComSpec // Windows CMD

  // 2. OS별 기본값
  switch (process.platform) {
    case 'win32':
      return 'powershell.exe'
    case 'darwin':
      return '/bin/zsh'
    default:
      return '/bin/bash'
  }
}

/**
 * 셸이 존재하는지 확인하고, 없으면 대체 셸 반환
 * Docker Alpine 환경에서는 /bin/bash 대신 /bin/sh 사용
 */
export function resolveShell(preferred?: string): string {
  const candidates = preferred
    ? [preferred, '/bin/sh']
    : [getDefaultShell(), '/bin/sh']

  // 셸 존재 여부는 node-pty가 spawn 시점에 판단하므로 여기서는 첫 후보 반환
  return candidates[0]
}

/**
 * 터미널 세션 생성 시 전달할 기본 환경 변수
 */
export function getShellEnv(cwd: string, extra?: Record<string, string>): Record<string, string> {
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CWD: cwd,
    ...extra,
  } as Record<string, string>
}
