import { create } from 'zustand'
import type {
  WorkMode,
  SidePanelType,
  Project,
  FileNode,
  Task,
  Plan,
  ProviderCredential,
  ProviderDescriptorPublic,
  SaveProviderInput,
  ModelRoleMapping,
  Doc,
  ChatMessage,
  GitInfo,
  ServerMessage,
  AgentEvent,
  TaskStatus,
  TaskPriority,
  RunResult,
  RunPreset,
  WikiPage,
  WikiSearchHit,
  WikiSyncState,
} from '../types'
import { api, type OAuthProviderInfo } from '../api/client'
import { wsClient } from '../api/ws-client'

interface AppState {
  // ============ 로딩 / 에러 ============
  loading: boolean
  error: string | null
  setError: (error: string | null) => void

  // ============ 앱 뷰 ============
  view: 'launcher' | 'dashboard' | 'project'
  setView: (view: 'launcher' | 'dashboard' | 'project') => void

  // ============ LLM 프로바이더 (서버-레벨 설정) ============
  availableProviders: ProviderDescriptorPublic[]
  providers: ProviderCredential[]
  providerSettingsOpen: boolean
  providersLoading: boolean
  openProviderSettings: () => void
  closeProviderSettings: () => void
  loadAvailableProviders: () => Promise<void>
  loadProviders: () => Promise<void>
  saveProvider: (input: SaveProviderInput) => Promise<void>
  setDefaultProvider: (id: string) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  roleMappings: ModelRoleMapping[]
  loadRoleMappings: () => Promise<void>
  saveRoleMappings: (
    roles: Array<{ role: string; credentialId: string; model: string }>,
  ) => Promise<void>
  oauthProviders: OAuthProviderInfo[]
  oauthPending: null | {
    provider: string
    userCode?: string
    verificationUri?: string
    interval?: number
    flowType: string
  }
  loadOAuthProviders: () => Promise<void>
  startOAuthLogin: (provider: string) => Promise<void>
  pollOAuthOnce: (provider: string) => Promise<void>
  cancelOAuthLogin: () => void

  // ============ 프로젝트 관리 ============
  projects: Project[]
  activeProjectId: string | null
  loadProjects: () => Promise<void>
  openProject: (project: Project) => Promise<void>
  closeProject: () => void
  createProject: (input: {
    name: string
    description?: string
    gitConfig?: {
      remoteUrl: string
      username?: string
      token?: string
    }
  }) => Promise<Project>
  removeProject: (projectId: string, deleteFiles?: boolean) => Promise<void>

  // ============ 작업 모드 ============
  workMode: WorkMode
  setWorkMode: (mode: WorkMode) => void
  toggleWorkMode: () => void

  // ============ 사이드 패널 ============
  activePanel: SidePanelType
  setActivePanel: (panel: SidePanelType) => void
  togglePanel: (panel: SidePanelType) => void

  // ============ 파일 시스템 ============
  fileTree: FileNode[]
  fileTreeLoading: boolean
  loadFileTree: (subPath?: string) => Promise<void>
  setFileTree: (tree: FileNode[]) => void
  activeFilePath: string | null
  setActiveFile: (path: string | null) => void
  openTabs: string[]
  openTab: (path: string) => void
  closeTab: (path: string) => void
  fileContents: Record<string, string>
  fileLanguages: Record<string, string>
  fileBinary: Record<string, boolean>
  setFileContent: (path: string, content: string) => void
  openFile: (path: string) => Promise<void>
  saveFile: (path: string, content: string) => Promise<void>
  createFile: (path: string, content?: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  renameFile: (oldPath: string, newPath: string) => Promise<void>
  createDirectory: (path: string) => Promise<void>

  // ============ Git ============
  gitInfo: GitInfo | null
  gitLoading: boolean
  loadGitStatus: () => Promise<void>
  checkoutBranch: (branch: string, create?: boolean) => Promise<void>
  commit: (message: string, files?: string[], amend?: boolean) => Promise<void>
  push: (force?: boolean) => Promise<void>
  pull: () => Promise<void>

  // ============ 할 일 (Tasks) ============
  tasks: Task[]
  loadTasks: () => Promise<void>
  createTask: (input: {
    title: string
    description?: string
    status?: TaskStatus
    priority?: TaskPriority
  }) => Promise<void>
  updateTask: (
    taskId: string,
    input: {
      title?: string
      description?: string
      status?: TaskStatus
      priority?: TaskPriority
    },
  ) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  updateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>

  // ============ 계획 (Plans) ============
  plans: Plan[]
  activePlanId: string | null
  loadPlans: () => Promise<void>
  createPlan: (input: {
    planName: string
    version?: string
    content: string
  }) => Promise<void>
  updatePlan: (
    planId: string,
    input: { title?: string; version?: string; content?: string },
  ) => Promise<void>
  deletePlan: (planId: string) => Promise<void>
  setActivePlan: (planId: string | null) => void

  // ============ 문서 (Docs) ============
  docs: Doc[]
  loadDocs: () => Promise<void>
  createDoc: (input: {
    title: string
    content: string
    filePath?: string
  }) => Promise<void>
  deleteDoc: (docId: string) => Promise<void>
  scanDocs: () => Promise<void>

  // ============ 위키 (Wiki) ============
  wikiPages: WikiPage[]
  activeWikiPath: string | null
  wikiSyncState: WikiSyncState | null
  wikiSearchHits: WikiSearchHit[]
  wikiSearchQuery: string
  loadWiki: () => Promise<void>
  selectWikiPage: (path: string | null) => void
  searchWiki: (query: string) => Promise<void>
  loadWikiSyncState: () => Promise<void>
  setWikiSearchQuery: (query: string) => void

  // ============ 에이전트 채팅 ============
  messages: ChatMessage[]
  addMessage: (message: ChatMessage) => void
  clearMessages: () => void
  // WebSocket 기반 에이전트 액션
  agentRunning: boolean
  agentStreamingMessageId: string | null
  wsConnected: boolean
  sendMessage: (content: string) => void
  abortAgent: () => void
  connectWebSocket: (projectId: string) => void
  disconnectWebSocket: () => void
  handleServerMessage: (message: ServerMessage) => void
  loadMessages: () => Promise<void>

  // ============ 터미널 & 코드 실행 ============
  terminalVisible: boolean
  toggleTerminal: () => void
  setTerminalVisible: (visible: boolean) => void
  runPresets: RunPreset[]
  loadRunPresets: () => Promise<void>
  runFile: (input: {
    file?: string
    command?: string
    args?: string[]
    cwd?: string
    timeout?: number
  }) => Promise<RunResult | null>
  createRunPreset: (input: {
    name: string
    command: string
    cwd?: string
    shortcut?: string
  }) => Promise<void>
  deleteRunPreset: (presetId: string) => Promise<void>
}

// 작업 공간 초기화 헬퍼
const emptyWorkspace = {
  fileTree: [] as FileNode[],
  activeFilePath: null as string | null,
  openTabs: [] as string[],
  fileContents: {} as Record<string, string>,
  fileLanguages: {} as Record<string, string>,
  fileBinary: {} as Record<string, boolean>,
  tasks: [] as Task[],
  plans: [] as Plan[],
  activePlanId: null as string | null,
  docs: [] as Doc[],
  wikiPages: [] as WikiPage[],
  activeWikiPath: null as string | null,
  wikiSyncState: null as WikiSyncState | null,
  wikiSearchHits: [] as WikiSearchHit[],
  wikiSearchQuery: '',
  messages: [] as ChatMessage[],
  activePanel: null as SidePanelType,
  gitInfo: null as GitInfo | null,
  agentRunning: false,
  agentStreamingMessageId: null as string | null,
  wsConnected: false,
  terminalVisible: false,
  runPresets: [] as RunPreset[],
}

// device-code OAuth 폴링 핸들 — zustand 상태가 아닌 모듈 스코프에서 관리.
// 성공/실패/취소 또는 오버레이 닫힘 시 반드시 clearOAuthPoll()로 정리한다.
let oauthPollHandle: ReturnType<typeof setInterval> | null = null

function clearOAuthPoll(): void {
  if (oauthPollHandle !== null) {
    clearInterval(oauthPollHandle)
    oauthPollHandle = null
  }
}

export const useStore = create<AppState>((set) => ({
  // ============ 로딩 / 에러 ============
  loading: false,
  error: null,
  setError: (error) => set({ error }),

  view: 'launcher',
  setView: (view) => set({ view }),

  // ============ LLM 프로바이더 (서버-레벨 설정) ============
  availableProviders: [],
  providers: [],
  providerSettingsOpen: false,
  providersLoading: false,
  oauthProviders: [],
  oauthPending: null,
  roleMappings: [],

  openProviderSettings: () => {
    set({ providerSettingsOpen: true })
    void useStore.getState().loadAvailableProviders()
    void useStore.getState().loadProviders()
    void useStore.getState().loadOAuthProviders()
    void useStore.getState().loadRoleMappings()
  },

  closeProviderSettings: () => set({ providerSettingsOpen: false }),

  loadAvailableProviders: async () => {
    try {
      const available = await api.listAvailableProviders()
      set({ availableProviders: available })
    } catch {
      // 조용히 실패
    }
  },

  loadProviders: async () => {
    set({ providersLoading: true })
    try {
      const providers = await api.listProviders()
      set({ providers, providersLoading: false })
    } catch {
      set({ providersLoading: false })
    }
  },

  saveProvider: async (input) => {
    try {
      await api.saveProvider(input)
      await useStore.getState().loadProviders()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '프로바이더 저장 중 오류가 발생했습니다' })
      throw e
    }
  },

  setDefaultProvider: async (id) => {
    try {
      await api.setDefaultProvider(id)
      await useStore.getState().loadProviders()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '기본 프로바이더 설정 중 오류가 발생했습니다' })
      throw e
    }
  },

  deleteProvider: async (id) => {
    try {
      await api.deleteProvider(id)
      await useStore.getState().loadProviders()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '프로바이더 삭제 중 오류가 발생했습니다' })
      throw e
    }
  },

  loadRoleMappings: async () => {
    try {
      const roleMappings = await api.getRoleMappings()
      set({ roleMappings })
    } catch {
      // 조용히 실패
    }
  },

  saveRoleMappings: async (roles) => {
    try {
      await api.saveRoleMappings(roles)
      await useStore.getState().loadRoleMappings()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '역할 매핑 저장 중 오류가 발생했습니다' })
      throw e
    }
  },
  loadOAuthProviders: async () => {
    try {
      const oauthProviders = await api.listOAuthProviders()
      set({ oauthProviders })
    } catch {
      // 조용히 실패
    }
  },

  startOAuthLogin: async (provider) => {
    // 기존 진행 중인 폴링 정리
    clearOAuthPoll()
    set({ oauthPending: null })
    try {
      const result = await api.startOAuth(provider)
      if (result.flowType === 'device-code') {
        set({
          oauthPending: {
            provider,
            flowType: 'device-code',
            userCode: result.userCode,
            verificationUri: result.verificationUri,
            interval: result.interval,
          },
        })
        // device-code: 반환된 interval(초) 주기로 폴링 시작
        const intervalMs = Math.max(result.interval, 1) * 1000
        oauthPollHandle = setInterval(() => {
          void useStore.getState().pollOAuthOnce(provider)
        }, intervalMs)
      } else {
        // pkce: 브라우저 창에서 인증 진행
        window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer')
        set({ oauthPending: { provider, flowType: 'pkce' } })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'OAuth 로그인 시작 중 오류가 발생했습니다' })
    }
  },

  pollOAuthOnce: async (provider) => {
    try {
      const result = await api.pollOAuth(provider)
      if (result.status === 'success') {
        clearOAuthPoll()
        set({ oauthPending: null })
        await useStore.getState().loadProviders()
      } else if (result.status === 'error') {
        clearOAuthPoll()
        set({ oauthPending: null, error: result.error ?? 'OAuth 인증에 실패했습니다' })
      }
      // pending → oauthPending 유지, 호출자가 다시 폴링
    } catch (e) {
      clearOAuthPoll()
      set({ oauthPending: null, error: e instanceof Error ? e.message : 'OAuth 폴링 중 오류가 발생했습니다' })
    }
  },

  cancelOAuthLogin: () => {
    clearOAuthPoll()
    set({ oauthPending: null })
  },

  // ============ 프로젝트 관리 ============
  projects: [],
  activeProjectId: null,

  loadProjects: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await api.listProjects()
      set({ projects, loading: false })
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : '프로젝트 목록을 불러오지 못했습니다',
      })
    }
  },

  openProject: async (project) => {
    set({ loading: true, error: null })
    try {
      const updated = await api.openProject(project.id)
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === project.id ? updated : p
        ),
        activeProjectId: project.id,
        view: 'project',
        loading: false,
        ...emptyWorkspace,
      }))
      // 파일 트리 자동 로드
      await useStore.getState().loadFileTree()
      // git 상태 자동 로드 (실패해도 무시)
      await useStore.getState().loadGitStatus().catch(() => {})
      // 할 일 / 계획 / 문서 자동 로드 (실패해도 무시)
      await Promise.all([
        useStore.getState().loadTasks().catch(() => {}),
        useStore.getState().loadPlans().catch(() => {}),
        useStore.getState().loadDocs().catch(() => {}),
        useStore.getState().loadRunPresets().catch(() => {}),
        useStore.getState().loadWiki().catch(() => {}),
      ])
      // WebSocket 연결
      useStore.getState().connectWebSocket(project.id)
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : '프로젝트를 여는 중 오류가 발생했습니다',
      })
    }
  },

  closeProject: () => {
    wsClient.disconnect()
    set({
      activeProjectId: null,
      view: 'launcher',
      ...emptyWorkspace,
    })
  },

  createProject: async (input) => {
    set({ loading: true, error: null })
    try {
      const project = await api.createProject(input)
      set((state) => ({
        projects: [...state.projects, project],
        loading: false,
      }))
      return project
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : '프로젝트 생성 중 오류가 발생했습니다',
      })
      throw e
    }
  },

  removeProject: async (projectId, deleteFiles = false) => {
    set({ loading: true, error: null })
    try {
      await api.deleteProject(projectId, deleteFiles)
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== projectId),
        activeProjectId:
          state.activeProjectId === projectId ? null : state.activeProjectId,
        loading: false,
        ...(state.activeProjectId === projectId ? emptyWorkspace : {}),
      }))
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : '프로젝트 삭제 중 오류가 발생했습니다',
      })
    }
  },

  // ============ 작업 모드 ============
  workMode: 'developer',
  setWorkMode: (mode) => set({ workMode: mode }),
  toggleWorkMode: () =>
    set((state) => ({
      workMode: state.workMode === 'developer' ? 'vibe' : 'developer',
    })),

  // ============ 사이드 패널 ============
  activePanel: null,
  setActivePanel: (panel) => set({ activePanel: panel }),
  togglePanel: (panel) =>
    set((state) => ({
      activePanel: state.activePanel === panel ? null : panel,
    })),

  // ============ 파일 시스템 ============
  fileTree: [],
  fileTreeLoading: false,
  loadFileTree: async (subPath = '.') => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ fileTreeLoading: true })
    try {
      const tree = await api.getFileTree(projectId, subPath)
      set({ fileTree: tree, fileTreeLoading: false })
    } catch (e) {
      set({
        fileTreeLoading: false,
        error: e instanceof Error ? e.message : '파일 트리를 불러오지 못했습니다',
      })
    }
  },
  setFileTree: (tree) => set({ fileTree: tree }),
  activeFilePath: null,
  setActiveFile: (path) => set({ activeFilePath: path }),
  openTabs: [],
  openTab: (path) =>
    set((state) => ({
      openTabs: state.openTabs.includes(path)
        ? state.openTabs
        : [...state.openTabs, path],
      activeFilePath: path,
    })),
  closeTab: (path) =>
    set((state) => {
      const newTabs = state.openTabs.filter((t) => t !== path)
      const newActive =
        state.activeFilePath === path
          ? newTabs[newTabs.length - 1] ?? null
          : state.activeFilePath
      const newContents = { ...state.fileContents }
      delete newContents[path]
      const newLanguages = { ...state.fileLanguages }
      delete newLanguages[path]
      const newBinary = { ...state.fileBinary }
      delete newBinary[path]
      return {
        openTabs: newTabs,
        activeFilePath: newActive,
        fileContents: newContents,
        fileLanguages: newLanguages,
        fileBinary: newBinary,
      }
    }),
  fileContents: {},
  fileLanguages: {},
  fileBinary: {},
  setFileContent: (path, content) =>
    set((state) => ({
      fileContents: { ...state.fileContents, [path]: content },
    })),

  openFile: async (filePath) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    // 이미 로드된 경우 스킵
    const state = useStore.getState()
    if (state.fileContents[filePath] !== undefined) {
      set({
        openTabs: state.openTabs.includes(filePath)
          ? state.openTabs
          : [...state.openTabs, filePath],
        activeFilePath: filePath,
      })
      return
    }
    try {
      const file = await api.readFile(projectId, filePath)
      set((s) => ({
        fileContents: { ...s.fileContents, [filePath]: file.content },
        fileLanguages: { ...s.fileLanguages, [filePath]: file.language ?? 'plaintext' },
        fileBinary: { ...s.fileBinary, [filePath]: file.isBinary },
        openTabs: s.openTabs.includes(filePath)
          ? s.openTabs
          : [...s.openTabs, filePath],
        activeFilePath: filePath,
      }))
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '파일을 열 수 없습니다',
      })
    }
  },

  saveFile: async (filePath, content) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.writeFile(projectId, filePath, content, true)
      set((s) => ({
        fileContents: { ...s.fileContents, [filePath]: content },
      }))
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '파일 저장에 실패했습니다',
      })
      throw e
    }
  },

  createFile: async (filePath, content = '') => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.writeFile(projectId, filePath, content, false)
      // 트리 새로고침
      await useStore.getState().loadFileTree()
      // 새 파일 열기
      await useStore.getState().openFile(filePath)
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '파일 생성에 실패했습니다',
      })
      throw e
    }
  },

  deleteFile: async (filePath) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.deleteFile(projectId, filePath)
      // 탭에서 제거
      useStore.getState().closeTab(filePath)
      // 트리 새로고침
      await useStore.getState().loadFileTree()
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '파일 삭제에 실패했습니다',
      })
      throw e
    }
  },

  renameFile: async (oldPath, newPath) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.renameFile(projectId, oldPath, newPath)
      // 트리 새로고침
      await useStore.getState().loadFileTree()
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '이름 변경에 실패했습니다',
      })
      throw e
    }
  },

  createDirectory: async (dirPath) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.mkdir(projectId, dirPath)
      await useStore.getState().loadFileTree()
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : '폴더 생성에 실패했습니다',
      })
      throw e
    }
  },

  // ============ Git ============
  gitInfo: null,
  gitLoading: false,

  loadGitStatus: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ gitLoading: true })
    try {
      const info = await api.getGitStatus(projectId)
      set({ gitInfo: info, gitLoading: false })
    } catch {
      // git 저장소가 아닌 경우 조용히 무시
      set({ gitInfo: null, gitLoading: false })
    }
  },

  checkoutBranch: async (branch, create) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ gitLoading: true })
    try {
      const info = await api.checkoutBranch(projectId, branch, create)
      set({ gitInfo: info, gitLoading: false })
      // 브랜치 전환 후 파일 트리 새로고침
      await useStore.getState().loadFileTree()
    } catch (e) {
      set({ gitLoading: false })
      set({ error: e instanceof Error ? e.message : '브랜치 전환에 실패했습니다' })
      throw e
    }
  },

  commit: async (message, files, amend) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ gitLoading: true })
    try {
      const info = await api.commit(projectId, message, files, amend)
      set({ gitInfo: info, gitLoading: false })
      // 커밋 후 파일 트리 새로고침 (gitStatus 갱신)
      await useStore.getState().loadFileTree()
    } catch (e) {
      set({ gitLoading: false })
      set({ error: e instanceof Error ? e.message : '커밋에 실패했습니다' })
      throw e
    }
  },

  push: async (force) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ gitLoading: true })
    try {
      await api.push(projectId, force)
      // push 후 상태 갱신 (ahead 카운트 감소)
      await useStore.getState().loadGitStatus()
      set({ gitLoading: false })
    } catch (e) {
      set({ gitLoading: false })
      set({ error: e instanceof Error ? e.message : 'push에 실패했습니다' })
      throw e
    }
  },

  pull: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ gitLoading: true })
    try {
      const info = await api.pull(projectId)
      set({ gitInfo: info, gitLoading: false })
      // pull 후 파일 트리 새로고침
      await useStore.getState().loadFileTree()
    } catch (e) {
      set({ gitLoading: false })
      set({ error: e instanceof Error ? e.message : 'pull에 실패했습니다' })
      throw e
    }
  },

  // ============ 할 일 (Tasks) ============
  tasks: [],

  loadTasks: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const tasks = await api.listTasks(projectId)
      set({ tasks })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '할 일을 불러오지 못했습니다' })
    }
  },

  createTask: async (input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const task = await api.createTask(projectId, input)
      set((state) => ({ tasks: [...state.tasks, task] }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '할 일 생성에 실패했습니다' })
      throw e
    }
  },

  updateTask: async (taskId, input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const updated = await api.updateTask(projectId, taskId, input)
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '할 일 수정에 실패했습니다' })
      throw e
    }
  },

  deleteTask: async (taskId) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.deleteTask(projectId, taskId)
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '할 일 삭제에 실패했습니다' })
      throw e
    }
  },

  updateTaskStatus: async (taskId, status) => {
    await useStore.getState().updateTask(taskId, { status })
  },

  // ============ 계획 (Plans) ============
  plans: [],
  activePlanId: null,

  loadPlans: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const plans = await api.listPlans(projectId)
      set({ plans })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '계획을 불러오지 못했습니다' })
    }
  },

  createPlan: async (input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const plan = await api.createPlan(projectId, input)
      set((state) => ({ plans: [...state.plans, plan] }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '계획 생성에 실패했습니다' })
      throw e
    }
  },

  updatePlan: async (planId, input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const updated = await api.updatePlan(projectId, planId, input)
      set((state) => ({
        plans: state.plans.map((p) => (p.id === planId ? updated : p)),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '계획 수정에 실패했습니다' })
      throw e
    }
  },

  deletePlan: async (planId) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.deletePlan(projectId, planId)
      set((state) => ({
        plans: state.plans.filter((p) => p.id !== planId),
        activePlanId: state.activePlanId === planId ? null : state.activePlanId,
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '계획 삭제에 실패했습니다' })
      throw e
    }
  },

  setActivePlan: (planId) => set({ activePlanId: planId }),

  // ============ 문서 (Docs) ============
  docs: [],

  loadDocs: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const docs = await api.listDocs(projectId)
      set({ docs })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '문서를 불러오지 못했습니다' })
    }
  },

  createDoc: async (input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const doc = await api.createDoc(projectId, input)
      set((state) => ({ docs: [...state.docs, doc] }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '문서 생성에 실패했습니다' })
      throw e
    }
  },

  deleteDoc: async (docId) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.deleteDoc(projectId, docId)
      set((state) => ({
        docs: state.docs.filter((d) => d.id !== docId),
      }))
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '문서 삭제에 실패했습니다' })
      throw e
    }
  },

  scanDocs: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const docs = await api.scanDocs(projectId)
      set({ docs })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '문서 스캔에 실패했습니다' })
      throw e
    }
  },

  // ============ 위키 (Wiki) ============
  wikiPages: [],
  activeWikiPath: null,
  wikiSyncState: null,
  wikiSearchHits: [],
  wikiSearchQuery: '',

  loadWiki: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const [pages, syncState] = await Promise.all([
        api.listWikiPages(projectId),
        api.getWikiSyncState(projectId).catch(() => null),
      ])
      const state = useStore.getState()
      // Keep activeWikiPath valid; default to the first page.
      const activePath = state.activeWikiPath && pages.some(p => p.path === state.activeWikiPath)
        ? state.activeWikiPath
        : (pages[0]?.path ?? null)
      set({ wikiPages: pages, wikiSyncState: syncState, activeWikiPath: activePath })
    } catch {
      // ignore — wiki may not be bootstrapped yet
    }
  },

  selectWikiPage: (path) => set({ activeWikiPath: path }),

  setWikiSearchQuery: (query) => set({ wikiSearchQuery: query }),

  searchWiki: async (query) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    set({ wikiSearchQuery: query })
    if (!query.trim()) { set({ wikiSearchHits: [] }); return }
    try {
      const hits = await api.searchWiki(projectId, query)
      set({ wikiSearchHits: hits })
    } catch {
      // ignore
    }
  },

  loadWikiSyncState: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const syncState = await api.getWikiSyncState(projectId)
      set({ wikiSyncState: syncState })
    } catch {
      // ignore
    }
  },

  // ============ 에이전트 채팅 ============
  messages: [],
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  agentRunning: false,
  agentStreamingMessageId: null,
  wsConnected: false,

  loadMessages: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const messages = await api.getMessages(projectId)
      set({ messages })
    } catch {
      // Ignore - start with empty messages
    }
  },

  connectWebSocket: (projectId) => {
    // Disconnect previous connection
    wsClient.disconnect()

    // Load message history from API
    void useStore.getState().loadMessages()

    // Connect WebSocket
    wsClient.connect(projectId)

    // Set up event handlers
    wsClient.on('connected', () => {
      set({ wsConnected: true })
      // Subscribe to file changes for auto-refresh
      wsClient.send({ type: 'subscribe_file_changes' })
    })

    wsClient.on('agent_event', (msg) => {
      useStore.getState().handleServerMessage(msg)
    })

    wsClient.on('file_changed', () => {
      // Refresh file tree on external changes
      void useStore.getState().loadFileTree()
    })

    wsClient.on('file_created', () => {
      void useStore.getState().loadFileTree()
    })

    wsClient.on('file_deleted', (msg) => {
      const path = (msg as { path: string }).path
      useStore.getState().closeTab(path)
      void useStore.getState().loadFileTree()
    })

    wsClient.on('todo_updated', () => {
      // 에이전트가 todo_write 도구로 할 일을 변경했으므로 API에서 재로드
      void useStore.getState().loadTasks()
    })

    wsClient.on('plan_updated', () => {
      // 에이전트가 plan_create 도구로 계획을 생성했으므로 API에서 재로드
      void useStore.getState().loadPlans()
    })

    wsClient.on('doc_updated', () => {
      // 에이전트가 문서를 생성했으므로 API에서 재로드
      void useStore.getState().loadDocs()
    })

    wsClient.on('wiki_updated', () => {
      // 에이전트/유지보수가 위키 페이지를 썼으므로 API에서 재로드
      void useStore.getState().loadWiki()
    })

    wsClient.on('error', (msg) => {
      const message = (msg as { message: string }).message
      set({ error: message })
    })

    // Track connection state
    wsClient.onStateChange((state) => {
      set({ wsConnected: state === 'connected' })
    })
  },

  disconnectWebSocket: () => {
    wsClient.disconnect()
    set({ wsConnected: false, agentRunning: false, agentStreamingMessageId: null })
  },

  sendMessage: (content) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return

    // Add user message immediately to UI
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      projectId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({ messages: [...state.messages, userMessage] }))

    // Send via WebSocket
    wsClient.send({ type: 'send_message', content })
  },

  abortAgent: () => {
    wsClient.send({ type: 'abort_agent' })
  },

  handleServerMessage: (message) => {
    if (message.type !== 'agent_event') return

    const event = message.event as AgentEvent
    const state = useStore.getState()

    switch (event.type) {
      case 'agent_start': {
        set({ agentRunning: true })
        break
      }

      case 'message_start': {
        // Create a placeholder agent message for streaming
        const msg = event.message as { id?: string } | undefined
        const messageId = msg?.id ?? `agent-${Date.now()}`
        const agentMessage: ChatMessage = {
          id: messageId,
          projectId: state.activeProjectId ?? '',
          role: 'agent',
          content: '',
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          messages: [...s.messages, agentMessage],
          agentStreamingMessageId: messageId,
        }))
        break
      }

      case 'message_update': {
        const streamingId = state.agentStreamingMessageId
        if (streamingId && event.delta) {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === streamingId
                ? { ...m, content: m.content + event.delta }
                : m
            ),
          }))
        }
        break
      }

      case 'message_end': {
        // Update with final content
        const streamingId = state.agentStreamingMessageId
        if (streamingId) {
          const msg = event.message as { content?: Array<{ type: string; text?: string }> } | undefined
          const textContent = msg?.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('') ?? ''

          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === streamingId
                ? { ...m, content: textContent || m.content }
                : m
            ),
          }))
        }
        break
      }

      case 'tool_execution_start': {
        // Show tool execution status in the streaming message
        const streamingId = state.agentStreamingMessageId
        if (streamingId && event.toolName) {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === streamingId
                ? { ...m, content: m.content + `\n\n*도구 실행 중: ${event.toolName}*` }
                : m
            ),
          }))
        }
        break
      }

      case 'tool_execution_end': {
        // Refresh file tree if a file-modifying tool was used
        if (['write', 'edit', 'multi_edit', 'remove', 'bash'].includes(event.toolName ?? '')) {
          void useStore.getState().loadFileTree()
        }
        break
      }

      case 'agent_end': {
        set({ agentRunning: false, agentStreamingMessageId: null })
        // Reload messages from DB to get the persisted version
        void useStore.getState().loadMessages()
        break
      }

      case 'error': {
        set({ agentRunning: false, agentStreamingMessageId: null })
        const errMsg = typeof event.message === 'string'
          ? event.message
          : (event.message as { content?: string })?.content
            ?? '알 수 없는 오류가 발생했습니다'
        set({ error: errMsg })
        break
      }
    }
  },

  // ============ 터미널 & 코드 실행 ============
  terminalVisible: false,
  toggleTerminal: () => set((state) => ({ terminalVisible: !state.terminalVisible })),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),

  runPresets: [],
  loadRunPresets: async () => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      const presets = await api.getRunPresets(projectId)
      set({ runPresets: presets })
    } catch {
      // 조용히 실패
    }
  },

  runFile: async (input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return null
    try {
      const result = await api.runFile(projectId, input)
      return result
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '실행 실패' })
      return null
    }
  },

  createRunPreset: async (input) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.createRunPreset(projectId, input)
      void useStore.getState().loadRunPresets()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '프리셋 생성 실패' })
    }
  },

  deleteRunPreset: async (presetId) => {
    const projectId = useStore.getState().activeProjectId
    if (!projectId) return
    try {
      await api.deleteRunPreset(projectId, presetId)
      void useStore.getState().loadRunPresets()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '프리셋 삭제 실패' })
    }
  },
}))
