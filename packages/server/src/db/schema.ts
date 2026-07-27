import { pgTable, text, integer, timestamp, jsonb, uuid, real } from 'drizzle-orm/pg-core'

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
