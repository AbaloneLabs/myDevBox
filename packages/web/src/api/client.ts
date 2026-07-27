import type {
  ApiResponse,
  Project,
  ScannedDir,
  FileNode,
  FileContent,
  SearchResult,
  GitInfo,
  GitBranch,
  GitCommit,
  GitDiff,
  ChatMessage,
  AgentConfig,
  ModelInfo,
  Task,
  Plan,
  Doc,
  TaskStatus,
  TaskPriority,
  RunResult,
  RunPreset,
} from '@mydevbox/shared'

const API_BASE = '/api'

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const body: ApiResponse<T> = await res.json()

  if (!body.success) {
    throw new Error(body.error ?? 'Unknown error')
  }

  return body.data as T
}

// ============ Projects API ============

export const api = {
  async listProjects(): Promise<Project[]> {
    return request<Project[]>('/projects')
  },

  async createProject(input: {
    name: string
    path: string
    description?: string
    gitConfig?: {
      remoteUrl: string
      username?: string
      token?: string
    }
  }): Promise<Project> {
    return request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async getProject(id: string): Promise<Project> {
    return request<Project>(`/projects/${id}`)
  },

  async updateProject(
    id: string,
    input: Partial<{
      name: string
      path: string
      description: string
      gitConfig: { remoteUrl: string; username?: string; token?: string }
    }>,
  ): Promise<Project> {
    return request<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },

  async deleteProject(id: string, deleteFiles = false): Promise<void> {
    await request<null>(`/projects/${id}?deleteFiles=${deleteFiles}`, {
      method: 'DELETE',
    })
  },

  async openProject(id: string): Promise<Project> {
    return request<Project>(`/projects/${id}/open`, {
      method: 'POST',
    })
  },

  async scanDir(dir: string): Promise<ScannedDir[]> {
    return request<ScannedDir[]>(`/projects/scan?dir=${encodeURIComponent(dir)}`)
  },

  async health(): Promise<{ status: string; db: string }> {
    return request<{ status: string; db: string }>('/health')
  },

  // ============ Files API ============

  async getFileTree(
    projectId: string,
    subPath: string = '.',
    depth?: number,
  ): Promise<FileNode[]> {
    const params = new URLSearchParams({ path: subPath })
    if (depth !== undefined) params.set('depth', String(depth))
    return request<FileNode[]>(`/projects/${projectId}/tree?${params}`)
  },

  async readFile(
    projectId: string,
    filePath: string,
  ): Promise<FileContent> {
    return request<FileContent>(
      `/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`,
    )
  },

  async writeFile(
    projectId: string,
    filePath: string,
    content: string,
    overwrite = true,
  ): Promise<FileContent> {
    return request<FileContent>(`/projects/${projectId}/files`, {
      method: 'PUT',
      body: JSON.stringify({ path: filePath, content, overwrite }),
    })
  },

  async deleteFile(projectId: string, filePath: string): Promise<void> {
    await request<null>(
      `/projects/${projectId}/files?path=${encodeURIComponent(filePath)}`,
      { method: 'DELETE' },
    )
  },

  async renameFile(
    projectId: string,
    oldPath: string,
    newPath: string,
  ): Promise<FileNode> {
    return request<FileNode>(`/projects/${projectId}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    })
  },

  async mkdir(projectId: string, dirPath: string): Promise<FileNode> {
    return request<FileNode>(`/projects/${projectId}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path: dirPath }),
    })
  },

  async searchFiles(
    projectId: string,
    pattern: string,
    glob?: string,
  ): Promise<SearchResult> {
    const params = new URLSearchParams({ pattern })
    if (glob) params.set('glob', glob)
    return request<SearchResult>(
      `/projects/${projectId}/files/search?${params}`,
    )
  },

  // ============ Git API ============

  async getGitStatus(projectId: string): Promise<GitInfo> {
    return request<GitInfo>(`/projects/${projectId}/git/status`)
  },

  async getGitBranches(projectId: string): Promise<GitBranch[]> {
    return request<GitBranch[]>(`/projects/${projectId}/git/branches`)
  },

  async checkoutBranch(
    projectId: string,
    branch: string,
    create?: boolean,
  ): Promise<GitInfo> {
    return request<GitInfo>(`/projects/${projectId}/git/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch, create }),
    })
  },

  async commit(
    projectId: string,
    message: string,
    files?: string[],
    amend?: boolean,
  ): Promise<GitInfo> {
    return request<GitInfo>(`/projects/${projectId}/git/commit`, {
      method: 'POST',
      body: JSON.stringify({ message, files, amend }),
    })
  },

  async push(projectId: string, force?: boolean): Promise<void> {
    await request<null>(`/projects/${projectId}/git/push`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    })
  },

  async pull(projectId: string): Promise<GitInfo> {
    return request<GitInfo>(`/projects/${projectId}/git/pull`, {
      method: 'POST',
    })
  },

  async getGitLog(
    projectId: string,
    limit?: number,
    branch?: string,
  ): Promise<GitCommit[]> {
    const params = new URLSearchParams()
    if (limit) params.set('limit', String(limit))
    if (branch) params.set('branch', branch)
    const query = params.toString()
    return request<GitCommit[]>(
      `/projects/${projectId}/git/log${query ? `?${query}` : ''}`,
    )
  },

  async getGitDiff(
    projectId: string,
    file?: string,
    staged?: boolean,
  ): Promise<GitDiff[]> {
    const params = new URLSearchParams()
    if (file) params.set('file', file)
    if (staged) params.set('staged', 'true')
    const query = params.toString()
    return request<GitDiff[]>(
      `/projects/${projectId}/git/diff${query ? `?${query}` : ''}`,
    )
  },

  // ============ Agent API ============

  async getModels(): Promise<ModelInfo[]> {
    return request<ModelInfo[]>('/agent/models')
  },

  async getAgentConfig(projectId: string): Promise<AgentConfig> {
    return request<AgentConfig>(`/projects/${projectId}/agent/config`)
  },

  async updateAgentConfig(
    projectId: string,
    config: Partial<AgentConfig> & { apiKey?: string },
  ): Promise<AgentConfig> {
    return request<AgentConfig>(`/projects/${projectId}/agent/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  },

  async getMessages(projectId: string): Promise<ChatMessage[]> {
    return request<ChatMessage[]>(`/projects/${projectId}/agent/messages`)
  },

  async clearMessages(projectId: string): Promise<void> {
    await request<null>(`/projects/${projectId}/agent/messages`, {
      method: 'DELETE',
    })
  },

  async abortAgent(projectId: string): Promise<void> {
    await request<null>(`/projects/${projectId}/agent/abort`, {
      method: 'POST',
    })
  },

  // ============ Tasks API ============

  async listTasks(projectId: string): Promise<Task[]> {
    return request<Task[]>(`/projects/${projectId}/tasks`)
  },

  async createTask(
    projectId: string,
    input: {
      title: string
      description?: string
      status?: string
      priority?: string
    },
  ): Promise<Task> {
    return request<Task>(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updateTask(
    projectId: string,
    taskId: string,
    input: {
      title?: string
      description?: string
      status?: TaskStatus
      priority?: TaskPriority
    },
  ): Promise<Task> {
    return request<Task>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await request<null>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'DELETE',
    })
  },

  // ============ Plans API ============

  async listPlans(projectId: string): Promise<Plan[]> {
    return request<Plan[]>(`/projects/${projectId}/plans`)
  },

  async getPlan(projectId: string, planId: string): Promise<Plan> {
    return request<Plan>(`/projects/${projectId}/plans/${planId}`)
  },

  async createPlan(
    projectId: string,
    input: { planName: string; version?: string; content: string },
  ): Promise<Plan> {
    return request<Plan>(`/projects/${projectId}/plans`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async updatePlan(
    projectId: string,
    planId: string,
    input: { title?: string; version?: string; content?: string },
  ): Promise<Plan> {
    return request<Plan>(`/projects/${projectId}/plans/${planId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    })
  },

  async deletePlan(projectId: string, planId: string): Promise<void> {
    await request<null>(`/projects/${projectId}/plans/${planId}`, {
      method: 'DELETE',
    })
  },

  // ============ Docs API ============

  async listDocs(projectId: string): Promise<Doc[]> {
    return request<Doc[]>(`/projects/${projectId}/docs`)
  },

  async getDoc(projectId: string, docId: string): Promise<Doc> {
    return request<Doc>(`/projects/${projectId}/docs/${docId}`)
  },

  async createDoc(
    projectId: string,
    input: { title: string; content: string; filePath?: string },
  ): Promise<Doc> {
    return request<Doc>(`/projects/${projectId}/docs`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async deleteDoc(projectId: string, docId: string): Promise<void> {
    await request<null>(`/projects/${projectId}/docs/${docId}`, {
      method: 'DELETE',
    })
  },

  async scanDocs(projectId: string): Promise<Doc[]> {
    return request<Doc[]>(`/projects/${projectId}/docs/scan`, {
      method: 'POST',
    })
  },

  // ============ 코드 실행 & 터미널 ============
  async runFile(
    projectId: string,
    input: {
      file?: string
      command?: string
      args?: string[]
      cwd?: string
      timeout?: number
    },
  ): Promise<RunResult> {
    return request<RunResult>(`/projects/${projectId}/run`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async getRunPresets(projectId: string): Promise<RunPreset[]> {
    return request<RunPreset[]>(`/projects/${projectId}/run-presets`)
  },

  async createRunPreset(
    projectId: string,
    input: { name: string; command: string; cwd?: string; shortcut?: string },
  ): Promise<RunPreset> {
    return request<RunPreset>(`/projects/${projectId}/run-presets`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  async deleteRunPreset(projectId: string, presetId: string): Promise<void> {
    await request<null>(`/projects/${projectId}/run-presets/${presetId}`, {
      method: 'DELETE',
    })
  },
}
