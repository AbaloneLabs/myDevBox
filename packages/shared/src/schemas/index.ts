import { z } from 'zod'

// ============ 프로젝트 ============
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, '프로젝트 이름은 영문/숫자로 시작해야 하며, 영문·숫자·대시(-)·밑줄(_)·점(.)만 사용할 수 있습니다'),
  description: z.string().optional(),
  gitConfig: z.object({
    remoteUrl: z.string().url(),
    username: z.string().optional(),
    token: z.string().optional(),
  }).optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

export const updateProjectSchema = createProjectSchema.partial()
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>

// ============ 파일 시스템 ============
export const writeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  overwrite: z.boolean().optional().default(false),
})

export type WriteFileInput = z.infer<typeof writeFileSchema>

export const renameFileSchema = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
})

export type RenameFileInput = z.infer<typeof renameFileSchema>

export const mkdirSchema = z.object({
  path: z.string().min(1),
})

export type MkdirInput = z.infer<typeof mkdirSchema>

export const searchFilesSchema = z.object({
  pattern: z.string().min(1),
  glob: z.string().optional(),
  outputMode: z.enum(['content', 'files_with_matches', 'count']).default('files_with_matches'),
  context: z.number().int().min(0).max(5).optional().default(0),
})

export type SearchFilesInput = z.infer<typeof searchFilesSchema>

// ============ 채팅 ============
export const sendMessageSchema = z.object({
  content: z.string().min(1),
})

export type SendMessageInput = z.infer<typeof sendMessageSchema>

// ============ Git ============
export const checkoutSchema = z.object({
  branch: z.string().min(1),
  create: z.boolean().optional().default(false),
})

export type CheckoutInput = z.infer<typeof checkoutSchema>

export const commitSchema = z.object({
  message: z.string().min(1),
  files: z.array(z.string()).optional(),
  amend: z.boolean().optional().default(false),
})

export type CommitInput = z.infer<typeof commitSchema>

export const pushSchema = z.object({
  force: z.boolean().optional().default(false),
})

export type PushInput = z.infer<typeof pushSchema>

// ============ 에이전트 설정 ============
export const updateAgentConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(32768).optional(),
  apiKey: z.string().optional(),           // 설정 시 암호화 저장
})

export type UpdateAgentConfigInput = z.infer<typeof updateAgentConfigSchema>

// ============ LLM 프로바이더 (서버-레벨) ============
export const saveProviderSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrlOverride: z.string().optional(),
  defaultModel: z.string().min(1),
  isDefault: z.boolean().optional(),
})

export type SaveProviderInput = z.infer<typeof saveProviderSchema>

// ============ Tasks ============
export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional().default('pending'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

// ============ Plans ============
export const createPlanSchema = z.object({
  planName: z.string().min(1).max(100),
  version: z.string().min(1).max(20).optional().default('v1'),
  content: z.string().min(1),
})

export type CreatePlanInput = z.infer<typeof createPlanSchema>

export const updatePlanSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  version: z.string().min(1).max(20).optional(),
  content: z.string().optional(),
})

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>

// ============ Docs ============
export const createDocSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  filePath: z.string().optional(),
})

export type CreateDocInput = z.infer<typeof createDocSchema>

// ============ 코드 실행 (Plan 9) ============
export const runFileSchema = z.object({
  file: z.string().min(1).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().int().min(1000).max(600_000).optional().default(60_000),
}).refine(
  (data) => data.file || data.command,
  { message: 'Either "file" or "command" must be provided' },
)

export type RunFileInput = z.infer<typeof runFileSchema>

export const createRunPresetSchema = z.object({
  name: z.string().min(1).max(100),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  shortcut: z.string().optional(),
})

export type CreateRunPresetInput = z.infer<typeof createRunPresetSchema>

// ============ Wiki ============
export const createWikiPageSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  type: z.enum([
    'index', 'log', 'gaps', 'model', 'controller', 'service', 'route',
    'architecture', 'decision', 'dependency', 'roadmap', 'debt', 'plan',
    'pattern', 'learning', 'convention', 'project_summary', 'glossary',
  ]).optional(),
  tags: z.array(z.string()).optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
})

export type CreateWikiPageInput = z.infer<typeof createWikiPageSchema>

export const updateWikiPageSchema = createWikiPageSchema.partial()
export type UpdateWikiPageInput = z.infer<typeof updateWikiPageSchema>
