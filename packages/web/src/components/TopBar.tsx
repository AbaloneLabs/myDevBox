import { useStore } from '../store/useStore'
import {
  CodeIcon,
  ChatIcon,
  CheckSquareIcon,
  DocumentIcon,
  BookIcon,
  GlobeIcon,
  HomeIcon,
  GitBranchIcon,
  TerminalIcon,
} from './Icons'
import type { SidePanelType } from '../types'
import './TopBar.css'

export function TopBar() {
  const workMode = useStore((s) => s.workMode)
  const toggleWorkMode = useStore((s) => s.toggleWorkMode)
  const activePanel = useStore((s) => s.activePanel)
  const togglePanel = useStore((s) => s.togglePanel)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const closeProject = useStore((s) => s.closeProject)
  const gitInfo = useStore((s) => s.gitInfo)
  const terminalVisible = useStore((s) => s.terminalVisible)
  const toggleTerminal = useStore((s) => s.toggleTerminal)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  const panelButtons: { type: SidePanelType; label: string; icon: typeof CodeIcon }[] = [
    { type: 'tasks', label: '할 일', icon: CheckSquareIcon },
    { type: 'plans', label: '계획', icon: DocumentIcon },
    { type: 'docs', label: '문서', icon: BookIcon },
    { type: 'preview', label: '미리보기', icon: GlobeIcon },
  ]

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="home-btn"
          onClick={closeProject}
          title="프로젝트 목록으로"
        >
          <HomeIcon size={16} />
        </button>
        {activeProject && (
          <div className="project-info">
            <span className="project-info-name">{activeProject.name}</span>
            {gitInfo && (
              <div className="project-info-git">
                <span className="project-info-branch">
                  <GitBranchIcon size={12} />
                  <span>{gitInfo.branch}</span>
                </span>
                <div className="git-changes">
                  {gitInfo.modified > 0 && (
                    <span className="git-badge modified" title="수정됨">
                      M{gitInfo.modified}
                    </span>
                  )}
                  {gitInfo.staged > 0 && (
                    <span className="git-badge staged" title="스테이지됨">
                      S{gitInfo.staged}
                    </span>
                  )}
                  {gitInfo.untracked > 0 && (
                    <span className="git-badge untracked" title="추적 안 됨">
                      U{gitInfo.untracked}
                    </span>
                  )}
                  {gitInfo.ahead > 0 && (
                    <span className="git-badge ahead" title="push 안 된 커밋">
                      ↑{gitInfo.ahead}
                    </span>
                  )}
                  {gitInfo.behind > 0 && (
                    <span className="git-badge behind" title="pull 필요">
                      ↓{gitInfo.behind}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="topbar-center">
        <div className="mode-toggle">
          <button
            className={`mode-btn ${workMode === 'developer' ? 'active' : ''}`}
            onClick={() => workMode !== 'developer' && toggleWorkMode()}
            title="Developer Mode (에디터 + 채팅)"
          >
            <CodeIcon size={14} />
            <span>Developer</span>
          </button>
          <button
            className={`mode-btn ${workMode === 'vibe' ? 'active' : ''}`}
            onClick={() => workMode !== 'vibe' && toggleWorkMode()}
            title="Vibe Mode (바이브 코딩)"
          >
            <ChatIcon size={14} />
            <span>Vibe</span>
          </button>
        </div>
      </div>

      <div className="topbar-right">
        <div className="panel-buttons">
          {panelButtons.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              className={`panel-btn ${activePanel === type ? 'active' : ''}`}
              onClick={() => togglePanel(type)}
              title={label}
            >
              <Icon size={16} />
            </button>
          ))}
          <button
            className={`panel-btn ${terminalVisible ? 'active' : ''}`}
            onClick={toggleTerminal}
            title="터미널"
          >
            <TerminalIcon size={16} />
          </button>
        </div>
      </div>
    </header>
  )
}
