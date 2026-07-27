import { useState } from 'react'
import type { FileNode } from '../types'
import { useStore } from '../store/useStore'
import {
  ChevronRightIcon,
  ChevronDownIcon,
  FolderIcon,
  FileIcon,
  RefreshIcon,
  LoaderIcon,
} from './Icons'
import './FileTree.css'

export function FileTree() {
  const fileTree = useStore((s) => s.fileTree)
  const fileTreeLoading = useStore((s) => s.fileTreeLoading)
  const openFile = useStore((s) => s.openFile)
  const loadFileTree = useStore((s) => s.loadFileTree)
  const activeFilePath = useStore((s) => s.activeFilePath)

  const handleFileClick = (node: FileNode) => {
    if (node.type === 'file') {
      openFile(node.path)
    }
  }

  const handleRefresh = () => {
    loadFileTree()
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>탐색기</span>
        <button
          className="tree-refresh-btn"
          onClick={handleRefresh}
          title="새로고침"
          disabled={fileTreeLoading}
        >
          {fileTreeLoading ? (
            <LoaderIcon size={14} className="spin" />
          ) : (
            <RefreshIcon size={14} />
          )}
        </button>
      </div>
      <div className="file-tree-body">
        {fileTreeLoading && fileTree.length === 0 ? (
          <div className="file-tree-loading">
            <LoaderIcon size={24} className="spin" />
            <p>불러오는 중...</p>
          </div>
        ) : fileTree.length === 0 ? (
          <div className="file-tree-empty">
            <FolderIcon size={32} className="empty-folder-icon" />
            <p>파일이 없습니다</p>
            <p className="empty-hint">프로젝트 폴더의 파일이 여기에 표시됩니다</p>
          </div>
        ) : (
          fileTree.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              level={0}
              activeFilePath={activeFilePath}
              onFileClick={handleFileClick}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface FileTreeNodeProps {
  node: FileNode
  level: number
  activeFilePath: string | null
  onFileClick: (node: FileNode) => void
}

function FileTreeNode({ node, level, activeFilePath, onFileClick }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true)

  if (node.type === 'directory') {
    return (
      <div>
        <button
          className="tree-node directory"
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDownIcon size={14} className="tree-chevron" />
          ) : (
            <ChevronRightIcon size={14} className="tree-chevron" />
          )}
          <FolderIcon size={14} className="tree-icon folder" />
          <span className="tree-label">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.id}
                node={child}
                level={level + 1}
                activeFilePath={activeFilePath}
                onFileClick={onFileClick}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      className={`tree-node file ${activeFilePath === node.path ? 'active' : ''}`}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={() => onFileClick(node)}
    >
      <span style={{ width: 14 }} />
      <FileIcon size={14} className="tree-icon file" />
      <span className="tree-label">{node.name}</span>
      {node.gitStatus && node.gitStatus !== 'unmodified' && (
        <span className={`tree-git-status ${node.gitStatus}`}>
          {node.gitStatus === 'modified' ? 'M' : node.gitStatus === 'staged' ? 'S' : 'U'}
        </span>
      )}
    </button>
  )
}
