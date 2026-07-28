import { useState } from 'react'
import { useStore } from '../store/useStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { TaskStatus, TaskPriority } from '../types'
import {
  CloseIcon,
  PlusIcon,
  CheckSquareIcon,
  DocumentIcon,
  BookIcon,
  GlobeIcon,
  TrashIcon,
  ScanIcon,
} from './Icons'
import { WikiPanel } from './WikiPanel'
import { remarkWikilink } from '../remark/wikilink'
import './SidePanel.css'

export function SidePanel() {
  const activePanel = useStore((s) => s.activePanel)
  const setActivePanel = useStore((s) => s.setActivePanel)

  if (!activePanel) return null

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <span className="side-panel-title">
          {activePanel === 'tasks' && '할 일'}
          {activePanel === 'plans' && '계획'}
          {activePanel === 'docs' && '문서'}
          {activePanel === 'preview' && '미리보기'}
          {activePanel === 'wiki' && '위키'}
        </span>
        <button className="side-panel-close" onClick={() => setActivePanel(null)}>
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="side-panel-body">
        {activePanel === 'tasks' && <TasksPanel />}
        {activePanel === 'plans' && <PlansPanel />}
        {activePanel === 'docs' && <DocsPanel />}
        {activePanel === 'preview' && <PreviewPanel />}
        {activePanel === 'wiki' && <WikiPanel />}
      </div>
    </div>
  )
}

// ============ Tasks ============
function TasksPanel() {
  const tasks = useStore((s) => s.tasks)
  const updateTaskStatus = useStore((s) => s.updateTaskStatus)
  const deleteTask = useStore((s) => s.deleteTask)
  const createTask = useStore((s) => s.createTask)
  const [showForm, setShowForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const statusLabels: Record<TaskStatus, string> = {
    pending: '대기',
    in_progress: '진행 중',
    completed: '완료',
  }

  const priorityColors: Record<TaskPriority, string> = {
    high: 'var(--red)',
    medium: 'var(--yellow)',
    low: 'var(--green)',
  }

  const nextStatus: Record<TaskStatus, TaskStatus> = {
    pending: 'in_progress',
    in_progress: 'completed',
    completed: 'pending',
  }

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    await createTask({ title: newTitle.trim() })
    setNewTitle('')
    setShowForm(false)
  }

  return (
    <div className="tasks-panel">
      <button className="add-btn" onClick={() => setShowForm(!showForm)}>
        <PlusIcon size={14} />
        <span>새 할 일</span>
      </button>
      {showForm && (
        <div className="task-form">
          <input
            className="task-form-input"
            type="text"
            placeholder="할 일 제목"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') {
                setShowForm(false)
                setNewTitle('')
              }
            }}
            autoFocus
          />
          <div className="task-form-actions">
            <button className="task-form-cancel" onClick={() => setShowForm(false)}>
              취소
            </button>
            <button className="task-form-add" onClick={() => void handleCreate()}>
              추가
            </button>
          </div>
        </div>
      )}
      <div className="tasks-list">
        {tasks.length === 0 ? (
          <div className="panel-empty">
            <CheckSquareIcon size={32} className="empty-panel-icon" />
            <p className="empty-title">할 일이 없습니다</p>
            <p className="empty-hint">에이전트가 작업을 계획하면 이곳에 표시됩니다</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={`task-item ${task.status}`}>
              <button
                className="task-checkbox"
                onClick={() => void updateTaskStatus(task.id, nextStatus[task.status])}
                title={statusLabels[task.status]}
              >
                {task.status === 'completed' && '✓'}
                {task.status === 'in_progress' && '◐'}
              </button>
              <div className="task-content">
                <div className="task-title">{task.title}</div>
                {task.description && (
                  <div className="task-desc">{task.description}</div>
                )}
                <div className="task-meta">
                  <span
                    className="task-priority"
                    style={{ color: priorityColors[task.priority] }}
                  >
                    ● {task.priority}
                  </span>
                  <span className="task-status-label">
                    {statusLabels[task.status]}
                  </span>
                </div>
              </div>
              <button
                className="task-delete"
                onClick={() => void deleteTask(task.id)}
                title="삭제"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ============ Plans ============
function PlansPanel() {
  const plans = useStore((s) => s.plans)
  const activePlanId = useStore((s) => s.activePlanId)
  const setActivePlan = useStore((s) => s.setActivePlan)
  const deletePlan = useStore((s) => s.deletePlan)

  const selected = plans.find((p) => p.id === activePlanId) ?? plans[0]

  if (plans.length === 0) {
    return (
      <div className="panel-empty">
        <DocumentIcon size={32} className="empty-panel-icon" />
        <p className="empty-title">계획이 없습니다</p>
        <p className="empty-hint">에이전트가 프로젝트 계획을 생성하면 이곳에 표시됩니다</p>
      </div>
    )
  }

  return (
    <div className="plans-panel">
      <div className="plans-list">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`plan-item ${selected?.id === plan.id ? 'active' : ''}`}
            onClick={() => setActivePlan(plan.id)}
          >
            <div className="plan-info">
              <div className="plan-title">{plan.title}</div>
              <div className="plan-version">{plan.version}</div>
            </div>
            <button
              className="plan-delete"
              onClick={(e) => {
                e.stopPropagation()
                void deletePlan(plan.id)
              }}
              title="삭제"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>
      {selected && (
        <div className="plan-detail">
          <ReactMarkdown>{selected.content}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// ============ Docs ============
function DocsPanel() {
  const docs = useStore((s) => s.docs)
  const [selectedId, setSelectedId] = useState<string | null>(docs[0]?.id ?? null)
  const deleteDoc = useStore((s) => s.deleteDoc)
  const scanDocs = useStore((s) => s.scanDocs)

  const selected = docs.find((d) => d.id === selectedId) ?? docs[0]

  if (docs.length === 0) {
    return (
      <div className="docs-panel-empty">
        <div className="panel-empty">
          <BookIcon size={32} className="empty-panel-icon" />
          <p className="empty-title">문서가 없습니다</p>
          <p className="empty-hint">코드 분석 후 자동 생성된 문서가 이곳에 표시됩니다</p>
        </div>
        <button className="scan-btn" onClick={() => void scanDocs()}>
          <ScanIcon size={14} />
          <span>기존 문서 스캔</span>
        </button>
      </div>
    )
  }

  return (
    <div className="docs-panel">
      <div className="docs-toolbar">
        <button className="scan-btn" onClick={() => void scanDocs()}>
          <ScanIcon size={14} />
          <span>스캔</span>
        </button>
      </div>
      <div className="docs-list">
        {docs.map((doc) => (
          <div
            key={doc.id}
            className={`doc-item ${selected?.id === doc.id ? 'active' : ''}`}
            onClick={() => setSelectedId(doc.id)}
          >
            <div className="doc-info">
              <div className="doc-title">{doc.title}</div>
              {doc.filePath && <div className="doc-path">{doc.filePath}</div>}
            </div>
            <button
              className="doc-delete"
              onClick={(e) => {
                e.stopPropagation()
                void deleteDoc(doc.id)
              }}
              title="삭제"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>
      {selected && (
        <div className="doc-detail">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkWikilink]}>{selected.content}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}

// ============ Preview ============
function PreviewPanel() {
  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="preview-url-bar">
          <span className="preview-url">localhost:35000</span>
        </div>
      </div>
      <div className="preview-content">
        <div className="preview-placeholder">
          <GlobeIcon size={32} className="empty-panel-icon" />
          <p>미리보기 브라우저</p>
          <p className="preview-hint">
            샌드박스에서 실행 중인 앱이 이곳에 표시됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
