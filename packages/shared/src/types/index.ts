// 공유 타입 정의 - 프론트엔드와 백엔드 양쪽에서 사용

// ============ 작업 모드 ============
export type WorkMode = 'developer' | 'vibe'

// ============ 사이드 패널 ============
export type SidePanelType = 'tasks' | 'plans' | 'docs' | 'preview' | 'wiki' | null

// ============ 프로젝트 ============
export type ProjectStatus = 'idle' | 'active' | 'loading'

export interface Project {
  id: string
  name: string
  path: string             // VM 내 절대 경로 (예: ~/repos/my-project)
  status: ProjectStatus
  description?: string
  // git 연동 정보 (입력한 경우에만 존재, 없으면 로컬 프로젝트)
  gitConfig?: GitConfig
  // git 상태 (백엔드에서 갱신)
  gitInfo?: GitInfo
  lastOpenedAt?: string
}

// ============ Git 연동 설정 ============
export interface GitConfig {
  remoteUrl: string        // 원격 저장소 URL (예: https://github.com/user/repo.git)
  token?: string           // 인증 토큰 (GitHub PAT, GitLab 토큰 등)
  username?: string        // 인증 사용자명 (토큰 사용 시 보통 토큰 소유자)
}

// ============ Git ============
export interface GitInfo {
  branch: string
  remote?: string          // origin URL
  ahead: number            // unpushed commits
  behind: number           // unpulled commits
  modified: number         // 수정된 파일 수
  staged: number           // 스테이지된 파일 수
  untracked: number        // 추적되지 않은 파일 수
}

export interface GitBranch {
  name: string
  current: boolean
  remote?: boolean
  lastCommit?: string
}

// ============ Git 커밋 히스토리 ============
export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  message: string
  filesChanged: number
}

// ============ Git Diff ============
export interface GitDiff {
  file: string
  additions: number
  deletions: number
  patches: DiffPatch[]
}

export interface DiffPatch {
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete'
  content: string
  lineNumber?: number
}

// ============ 파일 시스템 ============
export type FileNodeType = 'file' | 'directory'

export interface FileNode {
  id: string
  name: string
  path: string
  type: FileNodeType
  children?: FileNode[]
  language?: string
  gitStatus?: 'modified' | 'staged' | 'untracked' | 'unmodified'
}

export interface FileContent {
  path: string
  content: string
  language?: string
  size: number
  lineCount: number
  isBinary: boolean
}

// ============ 파일 검색 결과 ============
export interface SearchMatch {
  file: string
  line: number
  column?: number
  content: string
  beforeContext?: string[]
  afterContext?: string[]
}

export interface SearchResult {
  matches: SearchMatch[]
  truncated: boolean
}

// ============ 할 일 (Tasks) ============
export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  createdAt: string
}

// ============ 계획 (Plans) ============
export interface Plan {
  id: string
  projectId: string
  title: string
  version: string
  content: string
  createdAt: string
}

// ============ 문서 (Docs) ============
export interface Doc {
  id: string
  projectId: string
  filePath: string
  title: string
  content: string
  generatedAt: string
}

// ============ 에이전트 채팅 ============
export type MessageRole = 'user' | 'agent' | 'system'

export interface ChatMessage {
  id: string
  projectId: string
  role: MessageRole
  content: string
  createdAt: string
  // 에이전트가 코드를 수정한 경우
  fileChanges?: FileChange[]
}

export interface FileChange {
  filePath: string
  changeType: 'create' | 'modify' | 'delete'
  diff?: string
}

// ============ 에이전트 이벤트 (pi의 AgentEvent 참고) ============
export type AgentEventType =
  | 'agent_start' | 'agent_end'
  | 'turn_start' | 'turn_end'
  | 'message_start' | 'message_update' | 'message_end'
  | 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end'
  | 'error'

export interface AgentEvent {
  type: AgentEventType
  // message_update의 경우 텍스트 델타
  delta?: string
  // tool_execution_*의 경우
  toolCallId?: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  isError?: boolean
  // message_start/message_end/message_update의 경우 메시지 객체 (서버 내부 Message 타입)
  message?: unknown
  // agent_end의 경우 전체 메시지 목록
  messages?: unknown[]
  timestamp: number
}

// ============ 에이전트 설정 ============
export type LLMProvider = 'openai' | 'anthropic'

export interface AgentConfig {
  projectId: string
  provider: LLMProvider
  model: string
  temperature: number
  maxTokens: number
  hasApiKey: boolean             // API 키 설정 여부 (키 자체는 반환하지 않음)
}

export interface ModelInfo {
  id: string                     // 모델 ID (예: 'claude-sonnet-4-20250514')
  name: string                   // 표시명 (예: 'Claude Sonnet 4')
  provider: LLMProvider
  contextWindow: number          // 최대 컨텍스트 길이
  maxOutput: number              // 최대 출력 토큰
  supportsTools: boolean         // 도구 호출 지원 여부
}

// ============ LLM 프로바이더 (서버-레벨 자격증명) ============
export type ProviderCategory = 'api-key' | 'openai-compat' | 'oauth' | 'cloud'

/** 레지스트리 descriptor의 공개 표현 (시크릿 미포함). */
export interface ProviderDescriptorPublic {
  id: string
  displayName: string
  category: ProviderCategory
  apiShape: string
  defaultBaseUrl?: string
  authFieldLabel?: string
  supportsDiscovery?: boolean
  docsUrl?: string
}

/** 저장된 프로바이더 자격증명 (API 응답 — 시크릿 미포함, hasApiKey만). */
export interface ProviderCredential {
  id: string
  provider: string
  displayName: string
  baseUrlOverride?: string
  defaultModel: string
  isDefault: boolean
  hasApiKey: boolean
}

// ============ 역할별 모델 라우팅 ============
export type ModelRole = 'default' | 'smol' | 'slow' | 'plan' | 'commit'
export const MODEL_ROLES: ModelRole[] = ['default', 'smol', 'slow', 'plan', 'commit']

/** 역할 → 자격증명+모델 매핑 (API 응답). */
export interface ModelRoleMapping {
  role: ModelRole
  credentialId: string
  model: string
  provider: string
  displayName: string
}

// ============ API 공통 응답 ============
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// ============ 디렉토리 스캔 ============
export interface ScannedDir {
  name: string
  path: string
  isGitRepo: boolean       // .git 폴더 존재 여부
  hasRemote: boolean       // git remote가 설정되어 있는지
  isRegistered: boolean    // 이미 MyDevBox에 등록된 프로젝트인지
}

// ============ WebSocket 메시지 (Plan 7) ============

// 클라이언트 → 서버
export type ClientMessage =
  | { type: 'send_message'; content: string }
  | { type: 'abort_agent' }
  | { type: 'subscribe_file_changes' }
  | { type: 'unsubscribe_file_changes' }
  | { type: 'ping' }

// 서버 → 클라이언트
export type ServerMessage =
  // 에이전트 이벤트
  | { type: 'agent_event'; event: AgentEvent }
  // 파일 시스템 이벤트
  | { type: 'file_changed'; path: string }
  | { type: 'file_created'; path: string }
  | { type: 'file_deleted'; path: string }
  // 태스크 이벤트
  | { type: 'todo_updated'; todos: Task[] }
  // 외부 파일 추적 (Plan 11)
  | { type: 'tracked_file_updated'; file: TrackedFileInfo }
  | { type: 'tracked_file_deleted'; path: string }
  // 위키 이벤트
  | { type: 'wiki_updated'; projectId: string | null; path: string }
  // 연결 상태
  | { type: 'connected'; projectId: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }

// 드라이브 추적 파일 정보 (Plan 11)
export interface TrackedFileInfo {
  id: string
  projectId: string
  absolutePath: string
  displayPath: string
  fileName: string
  directory: string
  fileSize: number | null
  fileType: string | null
  createdBy: string
  toolName: string | null
  operation: string
  firstSeenAt: string
  lastAccessedAt: string
  exists: boolean
}

// ============ 코드 실행 & 터미널 (Plan 9) ============

// 터미널 WebSocket 클라이언트 → 서버
export type TerminalClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'create'; cwd?: string; shell?: string; cols?: number; rows?: number }
  | { type: 'kill' }

// 터미널 WebSocket 서버 → 클라이언트
export type TerminalServerMessage =
  | { type: 'created'; sessionId: string }
  | { type: 'output'; data: string }
  | { type: 'exited'; exitCode: number }
  | { type: 'error'; message: string }

// 파일 실행 결과
export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
  command: string
  truncated: boolean
}

// 실행 프리셋
export interface RunPreset {
  id: string
  projectId: string
  name: string
  command: string
  cwd?: string
  env?: Record<string, string>
  shortcut?: string
  autoDetected: boolean
}

// ============ 위키 (Wiki) ============

export type WikiPageType =
  | 'index' | 'log' | 'gaps' | 'model' | 'controller' | 'service' | 'route'
  | 'architecture' | 'decision' | 'dependency' | 'roadmap' | 'debt' | 'plan'
  | 'pattern' | 'learning' | 'convention' | 'project_summary' | 'glossary'

export type WikiPageStatus = 'active' | 'outdated' | 'disputed'

export interface WikiFrontmatter {
  title?: string
  type?: WikiPageType
  source?: string
  sha?: string
  lines?: string
  tags?: string[]
  created?: string
  updated?: string
  status?: WikiPageStatus
  tldr?: string
}

export type WikiScope = 'project' | 'master'

export interface WikiPage {
  id: string
  projectId: string | null   // null = master wiki (cross-project)
  path: string
  title: string
  type: WikiPageType
  content: string
  frontmatter: WikiFrontmatter
  tags: string[]
  status: WikiPageStatus
  sha: string | null
  createdAt: string
  updatedAt: string
}

export interface WikiLogEntry {
  id: string
  projectId: string | null
  op: 'ingest' | 'query' | 'lint' | 'bootstrap' | 'sync' | 'maintenance'
  summary: string
  meta: Record<string, unknown>
  createdAt: string
}

export interface WikiSyncState {
  projectId: string
  lastCommitSha: string | null
  updatedAt: string
}

export interface WikiBacklink {
  fromPath: string
  fromTitle: string
  context: string
}

export interface WikiSearchHit {
  path: string
  title: string
  type: WikiPageType
  snippet: string
  score: number
}
