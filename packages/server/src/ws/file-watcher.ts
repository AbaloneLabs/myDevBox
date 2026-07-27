/**
 * File Watcher
 *
 * Watches project directories for file changes using chokidar.
 * When changes are detected, broadcasts events via the connection manager.
 *
 * Plan 3 integration: file_changed/file_created/file_deleted events
 */

import path from 'node:path'
import type { FSWatcher } from 'chokidar'
import { connectionManager } from './connection.js'
import { DEFAULT_IGNORE_PATTERNS } from '../services/file-utils.js'

interface WatcherEntry {
  watcher: FSWatcher
  projectPath: string
}

class FileWatcherManager {
  private watchers = new Map<string, WatcherEntry>()

  /**
   * Start watching a project directory.
   * If already watching, this is a no-op.
   */
  watch(projectId: string, projectPath: string): void {
    if (this.watchers.has(projectId)) return

    // Lazy import chokidar (it's an ESM package)
    import('chokidar').then(({ default: chokidar }) => {
      // Ignore patterns (same as file tree)
      const ignored = DEFAULT_IGNORE_PATTERNS.map(p =>
        new RegExp(p.replace(/\*/g, '.*').replace(/\./g, '\\.'))
      )

      const watcher = chokidar.watch(projectPath, {
        ignored,
        persistent: true,
        ignoreInitial: true,
        depth: 20,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      })

      const getRelativePath = (filePath: string): string => {
        return path.relative(projectPath, filePath)
      }

      watcher.on('change', (filePath) => {
        const relPath = getRelativePath(filePath)
        connectionManager.broadcastFileChange(projectId, {
          type: 'file_changed',
          path: relPath,
        })
      })

      watcher.on('add', (filePath) => {
        const relPath = getRelativePath(filePath)
        connectionManager.broadcastFileChange(projectId, {
          type: 'file_created',
          path: relPath,
        })
      })

      watcher.on('unlink', (filePath) => {
        const relPath = getRelativePath(filePath)
        connectionManager.broadcastFileChange(projectId, {
          type: 'file_deleted',
          path: relPath,
        })
      })

      // Also watch directory add/unlink
      watcher.on('addDir', (dirPath) => {
        const relPath = getRelativePath(dirPath)
        connectionManager.broadcastFileChange(projectId, {
          type: 'file_created',
          path: relPath,
        })
      })

      watcher.on('unlinkDir', (dirPath) => {
        const relPath = getRelativePath(dirPath)
        connectionManager.broadcastFileChange(projectId, {
          type: 'file_deleted',
          path: relPath,
        })
      })

      this.watchers.set(projectId, { watcher, projectPath })
    }).catch(() => {
      // chokidar not available - file watching disabled
    })
  }

  /**
   * Stop watching a project directory.
   */
  unwatch(projectId: string): void {
    const entry = this.watchers.get(projectId)
    if (entry) {
      entry.watcher.close()
      this.watchers.delete(projectId)
    }
  }

  /**
   * Stop all watchers.
   */
  closeAll(): void {
    for (const [, entry] of this.watchers) {
      entry.watcher.close()
    }
    this.watchers.clear()
  }
}

export const fileWatcher = new FileWatcherManager()
