import { pgTable, text, integer, timestamp, jsonb, uuid, real, boolean } from 'drizzle-orm/pg-core'
import type { WikiFrontmatter } from '@mydevbox/shared'

// 프로젝트 테이블
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  description: text('description'),
  gitRemoteUrl: text('git_remote_url'),
  gitUsername: text('git_username'),
  gitTokenEncrypted: text('git_token_encrypted'),
  status: text('status').default('idle'),
  lastOpenedAt: timestamp('last_opened_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 채팅 메시지 테이블
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  fileChanges: jsonb('file_changes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 태스크 테이블
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('pending'),
  priority: text('priority').default('medium'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 계획 테이블
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  version: text('version').notNull(),
  filePath: text('file_path').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 문서 테이블
export const docs = pgTable('docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  generatedAt: timestamp('generated_at').notNull().defaultNow(),
})

// 코드 임베딩 테이블 (pgvector - RAG / sem_search 도구용)
// Plan 5, 6에서 활용: 에이전트가 코드를 의미 검색할 때 사용
export const codeEmbeddings = pgTable('code_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  filePath: text('file_path').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  content: text('content').notNull(),
  // pgvector 확장 필요: CREATE EXTENSION IF NOT EXISTS vector;
  // embedding 컬럼은 마이그레이션에서 수동으로 vector(1536) 타입으로 추가
  embedding: text('embedding'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 에이전트 설정 테이블 (Plan 5에서 사용)
export const agentConfigs = pgTable('agent_configs', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  provider: text('provider').default('anthropic'),
  model: text('model').default('claude-sonnet-4-20250514'),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(8192),
  apiKeyEncrypted: text('api_key_encrypted'),
})

// LLM 프로바이더 자격증명 (서버-레벨, 단일 사용자). isDefault=true 행을 에이전트가 사용.
export const providerCredentials = pgTable('provider_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  oauthAccessTokenEncrypted: text('oauth_access_token_encrypted'),
  oauthRefreshTokenEncrypted: text('oauth_refresh_token_encrypted'),
  oauthExpiresAt: timestamp('oauth_expires_at', { withTimezone: true }),
  baseUrlOverride: text('base_url_override'),
  defaultModel: text('default_model').notNull(),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at').defaultNow(),
})

// 역할별 모델 라우팅 (default/smol/slow/plan/commit → 자격증명+모델).
export const modelRoles = pgTable('model_roles', {
  role: text('role').primaryKey(),
  credentialId: uuid('credential_id').references(() => providerCredentials.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
})

// 외부 파일 추적 테이블 (Plan 11 - Drive)
export const trackedFiles = pgTable('tracked_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  absolutePath: text('absolute_path').notNull(),
  displayPath: text('display_path').notNull(),
  fileName: text('file_name').notNull(),
  directory: text('directory').notNull(),
  fileSize: integer('file_size'),
  fileType: text('file_type'),
  createdBy: text('created_by').notNull(),
  toolName: text('tool_name'),
  operation: text('operation').notNull(),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
  lastAccessedAt: timestamp('last_accessed_at').notNull().defaultNow(),
  exists: text('exists').default('true'),
  agentMessageId: uuid('agent_message_id'),
})

// 실행 프리셋 테이블 (Plan 9 - 코드 실행)
export const runPresets = pgTable('run_presets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  command: text('command').notNull(),
  cwd: text('cwd'),
  env: jsonb('env'),
  shortcut: text('shortcut'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ============ 위키 (Wiki) ============
// 자가-유지보수 LLM 위키. projectId가 NULL이면 마스터(크로스프로젝트) 위키.
export const wikiPages = pgTable('wiki_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }), // NULL = master
  path: text('path').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull(),
  content: text('content').notNull().default(''),
  frontmatter: jsonb('frontmatter').$type<WikiFrontmatter>().default({}),
  tags: text('tags').array().default([]),
  status: text('status').default('active'),
  sha: text('sha'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// 위키 운영 로그 (ingest / bootstrap / sync / lint / maintenance)
export const wikiLog = pgTable('wiki_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  op: text('op').notNull(),
  summary: text('summary').notNull(),
  meta: jsonb('meta').default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// 마스터 집계 대기 플래그 (projectId별)
export const syncNeeded = pgTable('sync_needed', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  flaggedAt: timestamp('flagged_at').notNull().defaultNow(),
  reason: text('reason'),
})

// 커밋 워터마크: 위키가 어느 커밋까지 반영했는지 추적
export const wikiSyncState = pgTable('wiki_sync_state', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  lastCommitSha: text('last_commit_sha'), // null = 아직 부트스트랩/추적 전
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
