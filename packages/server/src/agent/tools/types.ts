/**
 * Agent Tools - Common Types
 *
 * Based on pi's createTool pattern (opensource/pi/packages/coding-agent/src/core/tools/)
 */

import type { AgentTool } from '../types.js'

export interface ToolOptions {
  maxFileSize?: number        // 읽기/쓰기 최대 파일 크기 (bytes, 기본 10MB)
  maxOutputLines?: number     // bash/grep 출력 최대 줄 수 (기본 500)
  commandTimeout?: number     // 명령 타임아웃 (ms, 기본 30초)
  maxOutputBytes?: number     // 명령 출력 최대 바이트 (기본 100KB)
}

export const DEFAULT_TOOL_OPTIONS: Required<ToolOptions> = {
  maxFileSize: 10 * 1024 * 1024,
  maxOutputLines: 500,
  commandTimeout: 30_000,
  maxOutputBytes: 100 * 1024,
}

/**
 * 도구 생성 팩토리 (pi의 createTool 패턴 참고)
 * 각 도구는 프로젝트 경로(cwd)와 옵션을 받아 AgentTool을 생성한다.
 */
export type ToolFactory = (cwd: string, options?: ToolOptions) => AgentTool
