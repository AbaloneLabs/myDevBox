/**
 * WikiPanel — read-only project wiki viewer.
 *
 * List + search + selected-page markdown render (GFM + [[wikilinks]]) +
 * backlinks + commit watermark. No editor / edit buttons: the wiki is
 * agent-maintained; humans edit it via chat or code changes.
 */

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store/useStore'
import { api } from '../api/client'
import { LinkIcon, BookIcon } from './Icons'
import { remarkWikilink } from '../remark/wikilink'
import type { WikiBacklink } from '@mydevbox/shared'

const REMARK_PLUGINS = [remarkGfm, remarkWikilink]

export function WikiPanel() {
  const wikiPages = useStore((s) => s.wikiPages)
  const activeWikiPath = useStore((s) => s.activeWikiPath)
  const selectWikiPage = useStore((s) => s.selectWikiPage)
  const wikiSyncState = useStore((s) => s.wikiSyncState)
  const wikiSearchQuery = useStore((s) => s.wikiSearchQuery)
  const wikiSearchHits = useStore((s) => s.wikiSearchHits)
  const searchWiki = useStore((s) => s.searchWiki)
  const setWikiSearchQuery = useStore((s) => s.setWikiSearchQuery)

  const [backlinks, setBacklinks] = useState<WikiBacklink[]>([])

  const active = wikiPages.find((p) => p.path === activeWikiPath) ?? wikiPages[0] ?? null

  // Load backlinks for the active page.
  useEffect(() => {
    let cancelled = false
    if (!active) { setBacklinks([]); return }
    api.getWikiBacklinks(useStore.getState().activeProjectId ?? '', active.path)
      .then((bl) => { if (!cancelled) setBacklinks(bl) })
      .catch(() => { if (!cancelled) setBacklinks([]) })
    return () => { cancelled = true }
  }, [active])

  // Intercept [[wikilink]] anchor clicks → select the matching page.
  const handleMarkdownClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (!href.startsWith('#wiki/')) return
    e.preventDefault()
    const target = decodeURIComponent(href.slice('#wiki/'.length))
    const match = wikiPages.find((p) => p.path.replace(/\.md$/i, '').split('/').pop() === target)
      ?? wikiPages.find((p) => p.title === target)
    if (match) selectWikiPage(match.path)
  }

  if (wikiPages.length === 0) {
    return (
      <div className="docs-panel-empty">
        <div className="panel-empty">
          <BookIcon size={32} className="empty-panel-icon" />
          <p className="empty-title">위키가 비어 있습니다</p>
          <p className="empty-hint">에이전트가 위키를 생성 중입니다. 잠시 후 자동으로 표시됩니다.</p>
        </div>
      </div>
    )
  }

  const sha = wikiSyncState?.lastCommitSha
  const shaShort = sha ? sha.slice(0, 7) : null

  return (
    <div className="docs-panel">
      <div className="docs-toolbar">
        <input
          className="wiki-search-input"
          placeholder="위키 검색…"
          value={wikiSearchQuery}
          onChange={(e) => { setWikiSearchQuery(e.target.value); void searchWiki(e.target.value) }}
        />
      </div>

      <div className="docs-list">
        {(wikiSearchQuery.trim() ? wikiSearchHits.map((h) => ({ path: h.path, title: h.title })) : wikiPages.map((p) => ({ path: p.path, title: p.title })))
          .map((item) => (
            <div
              key={item.path}
              className={`doc-item ${active?.path === item.path ? 'active' : ''}`}
              onClick={() => selectWikiPage(item.path)}
            >
              <div className="doc-info">
                <div className="doc-title">{item.title}</div>
                <div className="doc-path">{item.path}</div>
              </div>
            </div>
          ))}
      </div>

      {active && (
        <div className="doc-detail">
          <div className="wiki-meta">
            <span className="wiki-type">{active.type}</span>
            {shaShort && <span className="wiki-sha" title={sha ?? ''}>@ {shaShort}</span>}
          </div>
          <div className="markdown-body" onClick={handleMarkdownClick}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{active.content}</ReactMarkdown>
          </div>

          {backlinks.length > 0 && (
            <div className="wiki-backlinks">
              <div className="wiki-backlinks-title">
                <LinkIcon size={14} /> 백링크 ({backlinks.length})
              </div>
              {backlinks.map((bl) => (
                <div
                  key={bl.fromPath}
                  className="wiki-backlink-item"
                  onClick={() => selectWikiPage(bl.fromPath)}
                >
                  <div className="doc-title">{bl.fromTitle}</div>
                  <div className="doc-path">{bl.fromPath}</div>
                  <div className="wiki-backlink-context">{bl.context}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
