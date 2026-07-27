import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './Terminal.css'

interface TerminalPanelProps {
  projectId: string
  visible: boolean
}

/**
 * 터미널 패널 컴포넌트
 * xterm.js + WebSocket 기반 인터랙티브 터미널
 */
export function TerminalPanel({ projectId, visible }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // xterm 인스턴스 생성
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#11111b',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    // WebSocket 연결
    const wsUrl = `ws://${window.location.host}/ws/terminal?projectId=${projectId}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    let created = false

    ws.onopen = () => {
      // 터미널 세션 생성
      ws.send(
        JSON.stringify({
          type: 'create',
          cols: term.cols,
          rows: term.rows,
        }),
      )
      created = true
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'output') {
          term.write(msg.data)
        } else if (msg.type === 'exited') {
          term.write(`\r\n\x1b[90m[process exited with code ${msg.exitCode}]\x1b[0m\r\n`)
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`)
        }
      } catch {
        // 파싱 에러 무시
      }
    }

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[WebSocket connection error]\x1b[0m\r\n')
    }

    // 터미널 입력 → WebSocket
    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // 리사이즈 → WebSocket
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // 창 크기 변경 시 자동 맞춤
    const handleResize = () => {
      if (visible) {
        fitAddon.fit()
      }
    }
    window.addEventListener('resize', handleResize)

    // 정리
    return () => {
      window.removeEventListener('resize', handleResize)
      inputDisposable.dispose()
      resizeDisposable.dispose()
      if (created && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'kill' }))
      }
      ws.close()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [projectId])

  // visible 토글 시 다시 fit
  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      setTimeout(() => fitRef.current?.fit(), 50)
    }
  }, [visible])

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <div className="terminal-actions">
          <button
            className="terminal-btn"
            title="Clear"
            onClick={() => termRef.current?.clear()}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="terminal-container" ref={containerRef} />
    </div>
  )
}
