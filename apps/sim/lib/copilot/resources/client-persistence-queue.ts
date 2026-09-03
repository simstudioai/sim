import type { MothershipResource, MothershipResourceUpdate } from '@/lib/copilot/resources/types'
import { mergePendingChatResourceUpdate } from '@/lib/copilot/resources/types'

interface ResourcePersistenceQueueOptions {
  persist: (chatId: string, update: MothershipResourceUpdate) => Promise<unknown>
  onError: (error: unknown) => void
}

const QUEUE_KEY_SEPARATOR = '\u0000'

export interface RemovedResourcePersistence {
  inFlight: Promise<unknown> | undefined
  scheduleDelete: (chatId: string, remove: () => Promise<unknown>) => void
  wasPersisted: boolean
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
  private readonly pendingRemovals = new Map<string, () => Promise<unknown>>()
  private readonly persistedKeys = new Set<string>()
  private readonly removalTokens = new Map<string, symbol>()
  private readonly writeTokens = new Map<string, symbol>()
  private readonly persist: ResourcePersistenceQueueOptions['persist']
  private readonly onError: ResourcePersistenceQueueOptions['onError']

  constructor({ persist, onError }: ResourcePersistenceQueueOptions) {
    this.persist = persist
    this.onError = onError
  }

  /**
   * Records the newest desired state for a resource and starts writing it when
   * a chat id is known. `scopeId` buckets the write: it is the chat id once the
   * chat exists, and the provisional pending-chat key before that, which
   * {@link flush} later adopts. `base` is the resource as the server already
   * holds it, when the caller knows.
   */
  enqueue(
    update: MothershipResourceUpdate,
    chatId: string | undefined,
    scopeId: string,
    base?: MothershipResource
  ): void {
    const key = this.getKey(scopeId, update.type, update.id)
    const trackedLocally =
      this.desiredUpdates.has(key) || this.pendingKeys.has(key) || this.inFlight.has(key)
    if (base && !trackedLocally) this.persistedKeys.add(key)
    this.pendingRemovals.delete(key)
    this.removalTokens.delete(key)
    const previous = this.desiredUpdates.get(key) ?? base
    this.desiredUpdates.set(key, mergePendingChatResourceUpdate(previous, update))
    this.failedKeys.delete(key)

    if (!chatId || this.inFlight.has(key)) {
      this.pendingKeys.add(key)
      return
    }

    this.start(key, chatId)
  }

  async flush(chatId: string, sourceScopeId: string = chatId): Promise<void> {
    this.adoptScope(sourceScopeId, chatId)
    for (const key of this.getScopedKeys(this.pendingKeys, chatId)) this.failedKeys.delete(key)
    this.startPending(chatId)

    while (true) {
      const inFlight = this.getInFlightWrites(chatId)
      if (inFlight.length === 0) return
      await Promise.allSettled(inFlight)
    }
  }

  remove(
    type: string,
    id: string,
    scopeId: string,
    assumePersisted = false
  ): RemovedResourcePersistence {
    const key = this.getKey(scopeId, type, id)
    const trackedLocally =
      this.desiredUpdates.has(key) || this.pendingKeys.has(key) || this.inFlight.has(key)
    if (assumePersisted && !trackedLocally) this.persistedKeys.add(key)
    const wasPending = this.pendingKeys.delete(key)
    const inFlight = this.inFlight.get(key)
    const wasPersisted = this.persistedKeys.has(key)
    const removalToken = Symbol(key)
    this.pendingRemovals.delete(key)
    this.removalTokens.set(key, removalToken)
    this.desiredUpdates.delete(key)
    this.failedKeys.delete(key)
    return {
      inFlight,
      scheduleDelete: (chatId, remove) => {
        this.pendingRemovals.set(key, remove)
        const startRemoval = () => this.startRemoval(key, chatId, removalToken, remove)
        if (inFlight) {
          void inFlight.then(startRemoval, startRemoval)
          return
        }
        startRemoval()
      },
      wasPending,
      wasPersisted,
    }
  }

  /**
   * Whether a pending write would add a resource the server does not store yet.
   *
   * Only these may hold a reorder back — the server rejects an order naming a
   * resource it has never seen. A pending UPDATE to a resource it already
   * stores (a saved-view pin) must not: that write can fail indefinitely, and
   * gating on it would park tab ordering for the rest of the session.
   */
  hasUnpersistedWrites(scopeId: string): boolean {
    return this.getScopedKeys(this.pendingKeys, scopeId).some((key) => !this.persistedKeys.has(key))
  }

  getPendingResourceKeys(scopeId: string): Set<string> {
    const prefix = this.getScopePrefix(scopeId)
    return new Set(
      this.getScopedKeys(this.pendingKeys, scopeId).map((key) => key.slice(prefix.length))
    )
  }

  getInFlightWrites(scopeId: string): Promise<unknown>[] {
    return this.getScopedKeys(this.inFlight, scopeId).flatMap((key) => {
      const write = this.inFlight.get(key)
      return write ? [write] : []
    })
  }

  private startPending(chatId: string): void {
    for (const key of this.getScopedKeys(this.pendingKeys, chatId)) {
      if (this.failedKeys.has(key) || this.inFlight.has(key)) continue
      const pendingRemoval = this.pendingRemovals.get(key)
      const removalToken = this.removalTokens.get(key)
      if (pendingRemoval && removalToken) {
        this.startRemoval(key, chatId, removalToken, pendingRemoval)
        continue
      }
      this.start(key, chatId)
    }
  }

  private startRemoval(
    key: string,
    chatId: string,
    removalToken: symbol,
    remove: () => Promise<unknown>
  ): void {
    if (this.removalTokens.get(key) !== removalToken) return

    this.pendingKeys.delete(key)
    let succeeded = false
    const writeToken = Symbol(key)
    const tracked = Promise.resolve()
      .then(async () => {
        if (this.removalTokens.get(key) !== removalToken) return
        await remove()
        succeeded = true
      })
      .catch((error) => {
        if (this.removalTokens.get(key) !== removalToken) return
        this.pendingKeys.add(key)
        this.failedKeys.add(key)
        this.onError(error)
      })
      .finally(() => {
        if (this.writeTokens.get(key) !== writeToken) return
        this.writeTokens.delete(key)
        this.inFlight.delete(key)
        if (succeeded && this.removalTokens.get(key) === removalToken) {
          this.pendingRemovals.delete(key)
          this.removalTokens.delete(key)
          this.persistedKeys.delete(key)
        }
        if (this.removalTokens.get(key) !== removalToken && this.pendingKeys.has(key)) {
          this.start(key, chatId)
        }
      })
    this.writeTokens.set(key, writeToken)
    this.inFlight.set(key, tracked)
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
        this.persistedKeys.add(key)
        return result
      })
      .catch((error) => {
        // Superseded by a newer write for the same key, which owns the retry.
        if (this.writeTokens.get(key) !== token) return
        // The resource was removed while this write was in flight. Nothing is
        // left to retry, and `onError` would report a retry that never comes.
        if (!this.desiredUpdates.has(key)) return
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

  private adoptScope(sourceScopeId: string, targetScopeId: string): void {
    if (sourceScopeId === targetScopeId) return
    const sourcePrefix = this.getScopePrefix(sourceScopeId)
    for (const sourceKey of this.getScopedKeys(this.pendingKeys, sourceScopeId)) {
      const resourceKey = sourceKey.slice(sourcePrefix.length)
      const targetKey = `${this.getScopePrefix(targetScopeId)}${resourceKey}`
      const sourceUpdate = this.desiredUpdates.get(sourceKey)
      const targetUpdate = this.desiredUpdates.get(targetKey)
      if (sourceUpdate) {
        // The source scope is the provisional pre-chat-id bucket, so its update
        // is the OLDER of the two: it is `prev`, and the target's is `next`.
        this.desiredUpdates.set(
          targetKey,
          targetUpdate ? mergePendingChatResourceUpdate(sourceUpdate, targetUpdate) : sourceUpdate
        )
      }
      this.desiredUpdates.delete(sourceKey)
      this.pendingKeys.delete(sourceKey)
      this.pendingKeys.add(targetKey)
      if (this.failedKeys.delete(sourceKey)) this.failedKeys.add(targetKey)
      if (this.persistedKeys.delete(sourceKey)) this.persistedKeys.add(targetKey)
    }
  }

  private getScopedKeys(
    collection: ReadonlySet<string> | ReadonlyMap<string, unknown>,
    scopeId: string
  ): string[] {
    const prefix = this.getScopePrefix(scopeId)
    return Array.from(collection.keys()).filter((key) => key.startsWith(prefix))
  }

  private getScopePrefix(scopeId: string): string {
    return `${scopeId}${QUEUE_KEY_SEPARATOR}`
  }

  private getKey(scopeId: string, type: string, id: string): string {
    return `${this.getScopePrefix(scopeId)}${type}:${id}`
  }
}
