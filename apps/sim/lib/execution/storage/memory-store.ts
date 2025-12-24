import type { CancellationStorageAdapter } from './adapter'

const TTL_MS = 5 * 60 * 1000

export class MemoryCancellationStore implements CancellationStorageAdapter {
  private store = new Map<string, number>()

  async requestCancellation(executionId: string): Promise<boolean> {
    this.store.set(executionId, Date.now() + TTL_MS)
    return true
  }

  async isCancellationRequested(executionId: string): Promise<boolean> {
    const expiry = this.store.get(executionId)
    if (!expiry) return false
    if (Date.now() > expiry) {
      this.store.delete(executionId)
      return false
    }
    return true
  }

  async clearCancellation(executionId: string): Promise<void> {
    this.store.delete(executionId)
  }

  dispose(): void {
    this.store.clear()
  }
}
