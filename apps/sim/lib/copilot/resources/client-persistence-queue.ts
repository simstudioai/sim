import type { MothershipResource, MothershipResourceUpdate } from '@/lib/copilot/resources/types'
import { mergePendingChatResourceUpdate } from '@/lib/copilot/resources/types'

interface ResourcePersistenceQueueOptions {
  persist: (chatId: string, update: MothershipResourceUpdate) => Promise<unknown>
  onError: (error: unknown) => void
}

export interface RemovedResourcePersistence {
  inFlight: Promise<unknown> | undefined
  wasPending: boolean
}

/**
 * Serializes writes per resource while allowing unrelated resources to persist
 * concurrently. Each key holds the newest desired state until its write
 * succeeds, so an update arriving in flight is drained immediately afterward
 * and a failed write remains available for the next hydration retry.
 */
export class ResourcePersistenceQueue {
  readonly pendingKeys = new Set<string>()
  readonly inFlight = new Map<string, Promise<unknown>>()

  private readonly desiredUpdates = new Map<string, MothershipResourceUpdate>()
  private readonly failedKeys = new Set<string>()
  private readonly writeTokens = new Map<string, symbol>()
  private readonly persist: ResourcePersistenceQueueOptions['persist']
  private readonly onError: ResourcePersistenceQueueOptions['onError']

  constructor({ persist, onError }: ResourcePersistenceQueueOptions) {
    this.persist = persist
    this.onError = onError
  }

  enqueue(
    update: MothershipResourceUpdate,
    chatId: string | undefined,
    base?: MothershipResource
  ): void {
    const key = this.getKey(update)
    const previous = this.desiredUpdates.get(key) ?? base
    this.desiredUpdates.set(key, mergePendingChatResourceUpdate(previous, update))
    this.failedKeys.delete(key)

    if (!chatId || this.inFlight.has(key)) {
      this.pendingKeys.add(key)
      return
    }

    this.start(key, chatId)
  }

  async flush(chatId: string): Promise<void> {
    for (const key of this.pendingKeys) this.failedKeys.delete(key)
    this.startPending(chatId)

    while (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight.values()))
    }
  }

  remove(type: string, id: string): RemovedResourcePersistence {
    const key = `${type}:${id}`
    const wasPending = this.pendingKeys.delete(key)
    const inFlight = this.inFlight.get(key)
    this.inFlight.delete(key)
    this.writeTokens.delete(key)
    this.desiredUpdates.delete(key)
    this.failedKeys.delete(key)
    return { inFlight, wasPending }
  }

  getPendingUpdates(): MothershipResourceUpdate[] {
    return Array.from(this.pendingKeys).flatMap((key) => {
      const update = this.desiredUpdates.get(key)
      return update ? [update] : []
    })
  }

  clear(): void {
    this.pendingKeys.clear()
    this.inFlight.clear()
    this.desiredUpdates.clear()
    this.failedKeys.clear()
    this.writeTokens.clear()
  }

  private startPending(chatId: string): void {
    for (const key of this.pendingKeys) {
      if (!this.failedKeys.has(key) && !this.inFlight.has(key)) this.start(key, chatId)
    }
  }

  private start(key: string, chatId: string): void {
    const update = this.desiredUpdates.get(key)
    if (!update) {
      this.pendingKeys.delete(key)
      return
    }

    this.pendingKeys.delete(key)
    let succeeded = false
    const token = Symbol(key)
    const tracked = Promise.resolve()
      .then(() => this.persist(chatId, update))
      .then((result) => {
        succeeded = true
        return result
      })
      .catch((error) => {
        if (this.writeTokens.get(key) !== token) return
        this.pendingKeys.add(key)
        this.failedKeys.add(key)
        this.onError(error)
      })
      .finally(() => {
        if (this.writeTokens.get(key) !== token) return
        this.writeTokens.delete(key)
        this.inFlight.delete(key)
        if (!succeeded) return
        if (this.pendingKeys.has(key)) {
          this.start(key, chatId)
          return
        }
        if (this.desiredUpdates.get(key) === update) this.desiredUpdates.delete(key)
      })
    this.writeTokens.set(key, token)
    this.inFlight.set(key, tracked)
  }

  private getKey(resource: Pick<MothershipResource, 'type' | 'id'>): string {
    return `${resource.type}:${resource.id}`
  }
}
