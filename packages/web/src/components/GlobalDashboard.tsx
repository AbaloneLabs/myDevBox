/**
 * GlobalDashboard — cross-project overview (no active project).
 *
 * Shows all tasks grouped by status, the roadmap (plans), the master wiki
 * pages, and a recent wiki-log timeline. Data is loaded from GET /api/dashboard
 * and polled every 30s (project-scoped WebSocket can't be used here).
 */

import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { HomeIcon, CheckSquareIcon, DocumentIcon, BookIcon } from './Icons'
import './GlobalDashboard.css'

interface DashboardData {
  projects: Array<{ id: string; name: string }>
  tasksByStatus: Record<string, Array<{ id: string; projectId: string; name: string; title: string; priority: string }>>
  plans: Array<{ id: string; projectId: string; name: string; title: string; version: string; createdAt: string }>
  masterPages: Array<{ id: string; path: string; title: string; type: string }>
  recentLog: Array<{ id: string; projectId: string | null; op: string; summary: string; createdAt: string }>
}

const POLL_MS = 30_000

export function GlobalDashboard({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await api.getDashboard()
        if (!cancelled) { setData(d as DashboardData); setError(null) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '대시보드 로드 실패')
      }
    }
    void load()
    const t = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (error && !data) {
    return (
      <div className="dashboard">
        <div className="dashboard-error">{error}</div>
        <button className="dashboard-back" onClick={onBack}>← 돌아가기</button>
      </div>
    )
  }

  const tasks = data?.tasksByStatus ?? { pending: [], in_progress: [], completed: [] }
  const projects = data?.projects ?? []
  const nameById = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <button className="dashboard-back" onClick={onBack}>
          <HomeIcon size={16} /> 홈
        </button>
        <h1>글로벌 대시보드</h1>
        <span className="dashboard-sub">{projects.length}개 프로젝트</span>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card">
          <h2><CheckSquareIcon size={15} /> 태스크</h2>
          {(['pending', 'in_progress', 'completed'] as const).map((status) => (
            <div key={status} className="dashboard-task-group">
              <div className="dashboard-task-status">
                {status === 'pending' ? '대기' : status === 'in_progress' ? '진행 중' : '완료'}
                <span className="dashboard-count">{tasks[status]?.length ?? 0}</span>
              </div>
              <ul className="dashboard-task-list">
                {(tasks[status] ?? []).map((t) => (
                  <li key={t.id}>
                    <span className="dashboard-task-project">{nameById.get(t.projectId) ?? '?'}</span>
                    <span className="dashboard-task-title">{t.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="dashboard-card">
          <h2><DocumentIcon size={15} /> 로드맵 (플랜)</h2>
          <ul className="dashboard-plan-list">
            {(data?.plans ?? []).map((p) => (
              <li key={p.id}>
                <span className="dashboard-task-project">{nameById.get(p.projectId) ?? p.name}</span>
                <span className="dashboard-task-title">{p.title}</span>
                <span className="dashboard-version">{p.version}</span>
              </li>
            ))}
            {(data?.plans ?? []).length === 0 && <li className="dashboard-empty">플랜 없음</li>}
          </ul>
        </section>

        <section className="dashboard-card">
          <h2><BookIcon size={15} /> 마스터 위키</h2>
          <ul className="dashboard-master-list">
            {(data?.masterPages ?? []).map((p) => (
              <li key={p.id}>
                <span className="dashboard-master-type">{p.type}</span>
                <span className="dashboard-task-title">{p.title}</span>
                <span className="dashboard-master-path">{p.path}</span>
              </li>
            ))}
            {(data?.masterPages ?? []).length === 0 && (
              <li className="dashboard-empty">마스터 위키가 아직 집계되지 않았습니다</li>
            )}
          </ul>
        </section>

        <section className="dashboard-card">
          <h2>최근 위키 활동</h2>
          <ul className="dashboard-log-list">
            {(data?.recentLog ?? []).map((l) => (
              <li key={l.id}>
                <span className="dashboard-log-op">[{l.op}]</span>
                <span className="dashboard-log-project">
                  {l.projectId ? (nameById.get(l.projectId) ?? 'master') : 'master'}
                </span>
                <span className="dashboard-log-summary">{l.summary}</span>
                <span className="dashboard-log-time">{new Date(l.createdAt).toLocaleString()}</span>
              </li>
            ))}
            {(data?.recentLog ?? []).length === 0 && (
              <li className="dashboard-empty">활동 내역 없음</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
