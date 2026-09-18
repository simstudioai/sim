import { DB_POOL_PROFILES } from '@sim/db/pool-profiles'
import {
  FILE_SEARCH_QUEUE_MAX_PENDING,
  FILE_SEARCH_QUEUE_TIMEOUT_MS,
} from '@/lib/workspace-files/search/constants'
import { WorkspaceFileSearchUnavailableError } from '@/lib/workspace-files/search/errors'

interface Waiter {
  grant: () => void
}

/**
 * Bounds search work before it reaches the database pool. Waiting workspaces
 * rotate after each grant; cancellation and expiry remove waiters immediately.
 */
export class FileSearchAdmission {
  private active = 0
  private pending = 0
  private readonly workspaces = new Map<string, Set<Waiter>>()

  constructor(
    private readonly options: { concurrency: number; maxPending: number; timeoutMs: number }
  ) {}

  async acquire(workspaceId: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    if (this.active < this.options.concurrency) return this.claim()
    if (this.pending >= this.options.maxPending) {
      throw new WorkspaceFileSearchUnavailableError('Workspace file search is busy. Retry shortly.')
    }

    return new Promise((resolve, reject) => {
      const deadline = Date.now() + this.options.timeoutMs
      let settled = false
      const remove = () => {
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        const waiting = this.workspaces.get(workspaceId)
        waiting?.delete(waiter)
        if (waiting?.size === 0) this.workspaces.delete(workspaceId)
        this.pending--
      }
      const fail = (error: unknown) => {
        if (settled) return
        remove()
        reject(error)
      }
      const expire = () =>
        fail(
          new WorkspaceFileSearchUnavailableError('Workspace file search is busy. Retry shortly.')
        )
      const abort = () => fail(signal?.reason)
      const waiter: Waiter = {
        grant: () => {
          if (settled) return
          if (signal?.aborted) return abort()
          if (Date.now() >= deadline) return expire()
          remove()
          resolve(this.claim())
        },
      }
      const timer = setTimeout(expire, this.options.timeoutMs)
      const waiting = this.workspaces.get(workspaceId) ?? new Set<Waiter>()
      waiting.add(waiter)
      this.workspaces.set(workspaceId, waiting)
      this.pending++
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  private claim(): () => void {
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      while (this.active < this.options.concurrency && this.workspaces.size > 0) {
        const [workspaceId, waiters] = this.workspaces.entries().next().value!
        const waiter = waiters.values().next().value!
        waiter.grant()
        if (this.workspaces.has(workspaceId)) {
          this.workspaces.delete(workspaceId)
          this.workspaces.set(workspaceId, waiters)
        }
      }
    }
  }
}

export const fileSearchAdmission = new FileSearchAdmission({
  concurrency: DB_POOL_PROFILES.search.primaryMax,
  maxPending: FILE_SEARCH_QUEUE_MAX_PENDING,
  timeoutMs: FILE_SEARCH_QUEUE_TIMEOUT_MS,
})
