/**
 * File Snapshot Manager
 *
 * Manages file snapshots for undo support.
 * Before any write/edit/remove operation, a snapshot is saved
 * so the agent can undo its changes.
 *
 * Based on forgecode's undo mechanism.
 */

import fs from 'node:fs'

interface FileSnapshot {
  content: string | null   // null = file didn't exist (for undo of create)
  timestamp: number
}

class SnapshotManager {
  private snapshots = new Map<string, FileSnapshot[]>()

  /**
   * Save a snapshot of the file before modification.
   * If the file doesn't exist, content is null (for undo of create).
   */
  saveSnapshot(filePath: string): void {
    let content: string | null = null
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf-8')
    }

    const snapshots = this.snapshots.get(filePath) ?? []
    snapshots.push({ content, timestamp: Date.now() })
    this.snapshots.set(filePath, snapshots)
  }

  /**
   * Restore the most recent snapshot for a file.
   * Returns true if restored, false if no snapshot exists.
   */
  restore(filePath: string): boolean {
    const snapshots = this.snapshots.get(filePath)
    if (!snapshots || snapshots.length === 0) return false

    const snapshot = snapshots.pop()!

    if (snapshot.content === null) {
      // File didn't exist before → delete it
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } else {
      // Restore content
      fs.writeFileSync(filePath, snapshot.content, 'utf-8')
    }

    // Clean up if no more snapshots
    if (snapshots.length === 0) {
      this.snapshots.delete(filePath)
    }

    return true
  }

  /**
   * Get the number of snapshots for a file.
   */
  getSnapshotCount(filePath: string): number {
    return this.snapshots.get(filePath)?.length ?? 0
  }

  /**
   * Clear all snapshots.
   */
  clear(): void {
    this.snapshots.clear()
  }
}

export const snapshotManager = new SnapshotManager()
