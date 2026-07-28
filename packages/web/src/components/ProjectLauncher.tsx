import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { Project } from '../types'
import {
  GitIcon,
  FolderOpenIcon,
  ArrowRightIcon,
  TrashIcon,
  GitBranchIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderIcon,
} from './Icons'
import './ProjectLauncher.css'

export function ProjectLauncher({ onOpenDashboard }: { onOpenDashboard: () => void }) {
  const projects = useStore((s) => s.projects)
  const loadProjects = useStore((s) => s.loadProjects)
  const openProject = useStore((s) => s.openProject)
  const removeProject = useStore((s) => s.removeProject)
  const loading = useStore((s) => s.loading)
  const error = useStore((s) => s.error)
  const [showAddForm, setShowAddForm] = useState(false)

  // 마운트 시 프로젝트 목록 로드
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <div className="launcher">
      <div className="launcher-header">
        <div className="launcher-logo">
          <span className="launcher-logo-icon">[]</span>
          <span className="launcher-logo-text">MyDevBox</span>
        </div>
        <p className="launcher-tagline">
          샌드박스 내에서 AI 에이전트와 함께 개발하는 환경
        </p>
        <button className="launcher-dashboard-btn" onClick={onOpenDashboard}>
          대시보드
        </button>
      </div>

      <div className="launcher-content">
        <div className="launcher-section-header">
          <h2>프로젝트</h2>
          <button
            className="launcher-add-btn"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <PlusIcon size={14} />
            <span>프로젝트 추가</span>
          </button>
        </div>

        {error && (
          <div className="launcher-error">
            {error}
            <button onClick={() => loadProjects()}>재시도</button>
          </div>
        )}

        {showAddForm && (
          <AddProjectForm
            onAdded={(project) => {
              openProject(project)
              setShowAddForm(false)
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {loading && projects.length === 0 && !showAddForm ? (
          <div className="launcher-loading">
            <LoaderIcon size={32} className="spin" />
            <p>불러오는 중...</p>
          </div>
        ) : projects.length === 0 && !showAddForm ? (
          <div className="launcher-empty">
            <FolderOpenIcon size={48} className="empty-icon" />
            <p className="empty-title">프로젝트가 없습니다</p>
            <p className="empty-desc">
              프로젝트 이름을 입력해 생성하세요. git 원격 저장소 연결은 선택 사항입니다.
            </p>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => openProject(project)}
                onRemove={() => removeProject(project.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 프로젝트 카드 ============
function ProjectCard({
  project,
  onOpen,
  onRemove,
}: {
  project: Project
  onOpen: () => void
  onRemove: () => void
}) {
  const isGit = !!project.gitConfig

  return (
    <div className="project-card" onClick={onOpen}>
      <div className="project-card-header">
        <div className={`project-type-badge ${isGit ? 'git' : 'local'}`}>
          {isGit ? <GitIcon size={14} /> : <FolderOpenIcon size={14} />}
          <span>{isGit ? 'Git' : 'Local'}</span>
        </div>
        <button
          className="project-remove-btn"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          title="프로젝트 제거"
        >
          <TrashIcon size={14} />
        </button>
      </div>

      <div className="project-card-body">
        <h3 className="project-name">{project.name}</h3>
        {project.description && (
          <p className="project-desc">{project.description}</p>
        )}
        <p className="project-path">{project.path}</p>
        {isGit && project.gitConfig?.remoteUrl && (
          <p className="project-remote">{project.gitConfig.remoteUrl}</p>
        )}
      </div>

      {project.gitInfo && (
        <div className="project-card-footer">
          <div className="git-branch-info">
            <GitBranchIcon size={12} />
            <span className="branch-name">{project.gitInfo.branch}</span>
          </div>
          {(project.gitInfo.modified > 0 ||
            project.gitInfo.staged > 0 ||
            project.gitInfo.untracked > 0) && (
            <div className="git-changes">
              {project.gitInfo.modified > 0 && (
                <span className="change-count modified" title="수정됨">
                  M {project.gitInfo.modified}
                </span>
              )}
              {project.gitInfo.staged > 0 && (
                <span className="change-count staged" title="스테이지됨">
                  S {project.gitInfo.staged}
                </span>
              )}
              {project.gitInfo.untracked > 0 && (
                <span className="change-count untracked" title="추적 안 됨">
                  U {project.gitInfo.untracked}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="project-card-open">
        <span>열기</span>
        <ArrowRightIcon size={14} />
      </div>
    </div>
  )
}

// ============ 프로젝트 추가 폼 ============
function AddProjectForm({
  onAdded,
  onCancel,
}: {
  onAdded: (project: Project) => void
  onCancel: () => void
}) {
  const createProject = useStore((s) => s.createProject)
  const loading = useStore((s) => s.loading)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [gitEnabled, setGitEnabled] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [token, setToken] = useState('')
  const [username, setUsername] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) return

    setFormError(null)
    try {
      const project = await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        gitConfig:
          gitEnabled && remoteUrl.trim()
            ? {
                remoteUrl: remoteUrl.trim(),
                token: token.trim() || undefined,
                username: username.trim() || undefined,
              }
            : undefined,
      })
      onAdded(project)
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : '프로젝트 생성 중 오류가 발생했습니다'
      )
    }
  }

  return (
    <div className="add-project-form">
      {formError && <div className="form-error">{formError}</div>}
      <div className="form-row">
        <label>프로젝트 이름</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-app"
          autoFocus
          disabled={loading}
        />
        <span className="form-hint">영문·숫자·대시·밑줄·점 (영문/숫자로 시작). 예: my-app, web_mario</span>
      </div>
      <div className="form-row">
        <label>설명 (선택)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="프로젝트에 대한 간단한 설명"
          disabled={loading}
        />
      </div>

      {/* Git 연동 섹션 (접기/펼치기) */}
      <div className="git-section">
        <button
          className="git-section-toggle"
          onClick={() => setGitEnabled(!gitEnabled)}
          type="button"
          disabled={loading}
        >
          {gitEnabled ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
          <GitIcon size={14} />
          <span>Git 원격 저장소 연동</span>
          {!gitEnabled && (
            <span className="git-section-hint">선택 사항</span>
          )}
        </button>

        {gitEnabled && (
          <div className="git-section-body">
            <div className="form-row">
              <label>원격 저장소 URL</label>
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="mono-input"
                disabled={loading}
              />
            </div>
            <div className="form-row">
              <label>사용자명 (선택)</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="git username"
                disabled={loading}
              />
            </div>
            <div className="form-row">
              <label>액세스 토큰 (선택)</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="GitHub PAT, GitLab token 등"
                className="mono-input"
                disabled={loading}
              />
              <span className="form-hint">
                비공개 저장소 접근이나 push 권한이 필요한 경우 입력하세요
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button
          className="form-cancel-btn"
          onClick={onCancel}
          disabled={loading}
        >
          취소
        </button>
        <button
          className="form-submit-btn"
          onClick={handleSubmit}
          disabled={!name.trim() || loading}
        >
          {loading ? (
            <>
              <LoaderIcon size={14} className="spin" />
              <span>생성 중...</span>
            </>
          ) : (
            <span>추가 및 열기</span>
          )}
        </button>
      </div>
    </div>
  )
}
