import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { useStore } from '../store/useStore'
import type { ChatMessage } from '@mydevbox/shared'
import { SendIcon, ChatIcon, StopIcon } from './Icons'
import './ChatPanel.css'

export function ChatPanel() {
  const messages = useStore((s) => s.messages)
  const sendMessage = useStore((s) => s.sendMessage)
  const abortAgent = useStore((s) => s.abortAgent)
  const workMode = useStore((s) => s.workMode)
  const agentRunning = useStore((s) => s.agentRunning)
  const wsConnected = useStore((s) => s.wsConnected)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || agentRunning) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`chat-panel ${workMode === 'vibe' ? 'vibe-mode' : ''}`}>
      <div className="chat-header">
        <span className="chat-title">에이전트</span>
        <span className="chat-status">
          <span className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`} />
          {agentRunning ? '작업 중...' : wsConnected ? '대기 중' : '연결 끊김'}
        </span>
      </div>
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <ChatIcon size={48} className="empty-chat-icon" />
            <p className="empty-title">에이전트와 대화를 시작하세요</p>
            <p className="empty-hint">
              코드 작성, 리팩토링, 질문 등 무엇이든 물어보세요
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder={
            agentRunning
              ? '에이전트가 응답 중입니다...'
              : '메시지를 입력하세요... (Enter: 전송, Shift+Enter: 줄바꿈)'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={agentRunning}
        />
        {agentRunning ? (
          <button className="chat-stop-btn" onClick={abortAgent} title="중단">
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || !wsConnected}
          >
            <SendIcon size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isAgent = message.role === 'agent'

  return (
    <div className={`message ${message.role}`}>
      <div className="message-avatar">
        {isUser ? '나' : isAgent ? 'AI' : 'SYS'}
      </div>
      <div className="message-body">
        <div className="message-content">
          {isAgent ? (
            <ReactMarkdown>{message.content || '...'}</ReactMarkdown>
          ) : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
        </div>
        {message.fileChanges && message.fileChanges.length > 0 && (
          <div className="message-file-changes">
            {message.fileChanges.map((change, i) => (
              <div key={i} className="file-change-item">
                <div className="file-change-header">
                  <span className={`change-badge ${change.changeType}`}>
                    {change.changeType === 'create' ? '생성' : change.changeType === 'modify' ? '수정' : '삭제'}
                  </span>
                  <span className="change-path">{change.filePath}</span>
                </div>
                {change.diff && (
                  <pre className="change-diff">
                    <code>{change.diff}</code>
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
