import { useStore } from './store/useStore'
import { ProjectLauncher } from './components/ProjectLauncher'
import { GlobalDashboard } from './components/GlobalDashboard'
import { TopBar } from './components/TopBar'
import { FileTree } from './components/FileTree'
import { EditorPanel } from './components/EditorPanel'
import { ChatPanel } from './components/ChatPanel'
import { SidePanel } from './components/SidePanel'
import { TerminalPanel } from './components/Terminal'
import { ProviderSettings } from './components/ProviderSettings'
import './App.css'

export default function App() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)

  return (
    <>
      {view === 'dashboard' ? (
        <GlobalDashboard onBack={() => setView('launcher')} />
      ) : view === 'launcher' ? (
        <ProjectLauncher onOpenDashboard={() => setView('dashboard')} />
      ) : (
        <ProjectWorkspace />
      )}
      {/* LLM 프로바이더 설정 — 모든 뷰 위에 오버레이 */}
      <ProviderSettings />
    </>
  )
}

function ProjectWorkspace() {
  const workMode = useStore((s) => s.workMode)
  const terminalVisible = useStore((s) => s.terminalVisible)
  const activeProjectId = useStore((s) => s.activeProjectId)

  // view === 'project' implies a project is open; guard for type narrowing.
  if (!activeProjectId) return null
  // 프로젝트가 열린 경우 - 작업 공간 표시
  const isEditorVisible = workMode === 'developer'

  return (
    <div className="app">
      <TopBar />
      <div className="app-body">
        {isEditorVisible && (
          <>
            <SidePanel />
            <div className={`editor-section ${terminalVisible ? 'with-terminal' : ''}`}>
              <FileTree />
              <EditorPanel />
              {terminalVisible && (
                <div className="terminal-wrapper">
                  <TerminalPanel projectId={activeProjectId} visible={terminalVisible} />
                </div>
              )}
            </div>
          </>
        )}
        <ChatPanel />
      </div>
      <StatusBar />
    </div>
  )
}

function StatusBar() {
  const workMode = useStore((s) => s.workMode)
  const activeFilePath = useStore((s) => s.activeFilePath)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const activeProject = projects.find((p) => p.id === activeProjectId)

  return (
    <footer className="status-bar">
      <div className="status-left">
        <span className="status-item">
          {workMode === 'developer' ? 'Developer Mode' : 'Vibe Mode'}
        </span>
        {activeProject && (
          <span className="status-item mono">{activeProject.path}</span>
        )}
        {activeFilePath && (
          <span className="status-item mono">{activeFilePath}</span>
        )}
      </div>
      <div className="status-right">
        <span className="status-item">UTF-8</span>
        <span className="status-item">TypeScript</span>
        <span className="status-item">Ln 1, Col 1</span>
      </div>
    </footer>
  )
}
