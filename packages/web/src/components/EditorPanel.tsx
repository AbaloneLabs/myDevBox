import { useState, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { useStore } from '../store/useStore'
import { CloseIcon, FileIcon, LoaderIcon, PlayIcon } from './Icons'
import './EditorPanel.css'

export function EditorPanel() {
  const openTabs = useStore((s) => s.openTabs)
  const activeFilePath = useStore((s) => s.activeFilePath)
  const setActiveFile = useStore((s) => s.setActiveFile)
  const closeTab = useStore((s) => s.closeTab)
  const fileContents = useStore((s) => s.fileContents)
  const fileLanguages = useStore((s) => s.fileLanguages)
  const fileBinary = useStore((s) => s.fileBinary)
  const saveFile = useStore((s) => s.saveFile)
  const runFile = useStore((s) => s.runFile)
  const toggleTerminal = useStore((s) => s.toggleTerminal)

  // 로컬 편집 버퍼: 저장되지 않은 변경사항 추적
  const [dirtyBuffer, setDirtyBuffer] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [running, setRunning] = useState(false)

  const isBinary = activeFilePath ? fileBinary[activeFilePath] : false
  const language = activeFilePath
    ? (fileLanguages[activeFilePath] ?? 'plaintext')
    : 'plaintext'

  // 실제 표시할 내용: 더티 버퍼 > 저장된 내용
  const content = activeFilePath
    ? (dirtyBuffer[activeFilePath] ?? fileContents[activeFilePath] ?? '')
    : ''

  const isDirty = activeFilePath
    ? dirtyBuffer[activeFilePath] !== undefined &&
      dirtyBuffer[activeFilePath] !== (fileContents[activeFilePath] ?? '')
    : false

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeFilePath) return
      setDirtyBuffer((prev) => ({
        ...prev,
        [activeFilePath]: value ?? '',
      }))
    },
    [activeFilePath]
  )

  const handleSave = useCallback(async () => {
    if (!activeFilePath || !isDirty || saving) return
    setSaving(true)
    try {
      await saveFile(activeFilePath, dirtyBuffer[activeFilePath])
      // 더티 버퍼에서 제거 (저장된 상태로 전환)
      setDirtyBuffer((prev) => {
        const next = { ...prev }
        delete next[activeFilePath]
        return next
      })
      // 저장 완료 플래시
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch {
      // 에러는 store에서 처리
    } finally {
      setSaving(false)
    }
  }, [activeFilePath, isDirty, saving, saveFile, dirtyBuffer])

  const handleEditorMount = useCallback((editor: any, monaco: any) => {
    // Ctrl+S / Cmd+S 로 저장
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        handleSave()
      }
    )
  }, [handleSave])

  const getFileName = (path: string): string => {
    const parts = path.split('/')
    return parts[parts.length - 1]
  }

  // 실행 가능한 파일 확장자인지 확인
  const runnableExtensions = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.py', '.sh', '.rb', '.go', '.rs']
  const isRunnable = activeFilePath
    ? runnableExtensions.some((ext) => activeFilePath.endsWith(ext))
    : false

  const handleRun = useCallback(async () => {
    if (!activeFilePath || running) return
    setRunning(true)
    // 터미널 패널 열기 (결과가 표시됨)
    toggleTerminal()
    try {
      await runFile({ file: activeFilePath })
    } finally {
      setRunning(false)
    }
  }, [activeFilePath, running, runFile, toggleTerminal])

  return (
    <div className="editor-panel">
      <div className="editor-tabs">
        {openTabs.map((path) => {
          const tabDirty = dirtyBuffer[path] !== undefined &&
            dirtyBuffer[path] !== (fileContents[path] ?? '')
          return (
            <div
              key={path}
              className={`editor-tab ${activeFilePath === path ? 'active' : ''}`}
              onClick={() => setActiveFile(path)}
            >
              <span className="tab-name">{getFileName(path)}</span>
              {tabDirty && <span className="tab-dirty-dot" />}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(path)
                }}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )
        })}
        {isRunnable && (
          <button
            className="editor-run-btn"
            onClick={handleRun}
            disabled={running}
            title="현재 파일 실행"
          >
            {running ? <LoaderIcon size={12} className="spin" /> : <PlayIcon size={12} />}
            {running ? '실행 중...' : '실행'}
          </button>
        )}
      </div>
      <div className="editor-container">
        {activeFilePath ? (
          isBinary ? (
            <div className="editor-empty">
              <FileIcon size={48} className="empty-editor-icon" />
              <p className="empty-title">바이너리 파일입니다</p>
              <p className="empty-hint">
                이 파일은 텍스트 편집기에서 열 수 없습니다
              </p>
            </div>
          ) : (
            <>
              <Editor
                height="100%"
                theme="vs-dark"
                language={language}
                value={content}
                onChange={handleChange}
                onMount={handleEditorMount}
                loading={<LoaderIcon size={32} className="spin" />}
                options={{
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                  lineNumbersMinChars: 3,
                  automaticLayout: true,
                  readOnly: false,
                  tabSize: 2,
                  wordWrap: 'on',
                }}
              />
              <div className="editor-status-bar">
                {saving ? (
                  <span className="status-saving">
                    <LoaderIcon size={12} className="spin" /> 저장 중...
                  </span>
                ) : savedFlash ? (
                  <span className="status-saved">저장됨</span>
                ) : isDirty ? (
                  <span className="status-dirty">
                    저장되지 않은 변경사항 • Ctrl+S로 저장
                  </span>
                ) : (
                  <span className="status-clean">{language}</span>
                )}
              </div>
            </>
          )
        ) : (
          <div className="editor-empty">
            <FileIcon size={48} className="empty-editor-icon" />
            <p className="empty-title">파일을 열어보세요</p>
            <p className="empty-hint">
              왼쪽 탐색기에서 파일을 클릭하면 이곳에 표시됩니다
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
