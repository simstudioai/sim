import { db } from '@sim/db'
import { copilotChats, mothershipResourceEffects } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  mergeChatResource,
  type MothershipResource,
  type MothershipResourceUpdate,
  sanitizeChatResources,
} from '@/lib/mothership/resources/types'

const CHAT_RESOURCE_STATEMENT_TIMEOUT_MS = 10_000
const CHAT_RESOURCE_LOCK_TIMEOUT_MS = 3_000
const CHAT_RESOURCE_IDLE_TIMEOUT_MS = 5_000

/**
 * Bounds the `copilot_chats` row-lock wait every resource writer takes.
 *
 * {@link serializeChatResourceWrite} only serializes writers inside one process.
 * Another pod's write — and `finalizeAssistantTurn`, which holds this same row
 * `FOR UPDATE` across an assistant-message append — are outside it. Without
 * `lock_timeout` a waiter inherits the full statement clock, which the
 * deployment does not set either, so one stuck holder can drain the pool.
 *
 * Safe under pgBouncer transaction pooling: `SET LOCAL` is transaction-scoped
 * and clears at COMMIT/ROLLBACK before the session returns to the pool.
 */
export async function setChatResourceTxTimeouts(trx: Pick<typeof db, 'execute'>): Promise<void> {
  await trx.execute(
    sql.raw(`SET LOCAL statement_timeout = '${CHAT_RESOURCE_STATEMENT_TIMEOUT_MS}ms'`)
  )
  await trx.execute(sql.raw(`SET LOCAL lock_timeout = '${CHAT_RESOURCE_LOCK_TIMEOUT_MS}ms'`))
  await trx.execute(
    sql.raw(`SET LOCAL idle_in_transaction_session_timeout = '${CHAT_RESOURCE_IDLE_TIMEOUT_MS}ms'`)
  )
}

const chatResourceWriteChain = new Map<string, Promise<unknown>>()

export async function serializeChatResourceWrite<T>(
  chatId: string,
  write: () => Promise<T>
): Promise<T> {
  const tail = chatResourceWriteChain.get(chatId) ?? Promise.resolve()
  const run = tail.catch(() => {}).then(write)
  chatResourceWriteChain.set(chatId, run)
  try {
    return await run
  } finally {
    if (chatResourceWriteChain.get(chatId) === run) chatResourceWriteChain.delete(chatId)
  }
}

export type ChatResourceChange =
  | { kind: 'upsert'; resources: MothershipResourceUpdate[] }
  | { kind: 'remove'; resources: Pick<MothershipResource, 'type' | 'id'>[] }
  | { kind: 'reorder'; resources: MothershipResource[] }
  | { kind: 'clear-view'; tableId: string; viewId: string }

/** The caller resolves and authorizes this canonical chat before entering its atomic resource update. */
export async function changeStoredChatResources(
  chatId: string,
  change: ChatResourceChange,
  effectId?: string
): Promise<MothershipResource[]> {
  return serializeChatResourceWrite(chatId, () => db.transaction(async (tx) => {
    await setChatResourceTxTimeouts(tx)
    const [chat] = await tx
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.deletedAt)))
      .for('update')
    if (!chat) throw new OrchestrationError('not_found', 'Chat not found')
    const existing = sanitizeChatResources(Array.isArray(chat.resources) ? chat.resources : [])
    if (effectId) {
      const [applied] = await tx
        .insert(mothershipResourceEffects)
        .values({ chatId, effectId })
        .onConflictDoNothing()
        .returning({ effectId: mothershipResourceEffects.effectId })
      if (!applied) return existing
    }
    let resources: MothershipResource[]
    if (change.kind === 'clear-view') {
      resources = existing.map((resource) => {
        if (
          resource.type !== 'table' ||
          resource.id !== change.tableId ||
          resource.viewId !== change.viewId
        )
          return resource
        const { viewId: _view, ...unPinned } = resource
        return unPinned
      })
    } else if (change.kind === 'remove') {
      resources = existing.filter(
        (resource) =>
          !change.resources.some(
            (removed) =>
              removed.type === resource.type &&
              (removed.id === resource.id ||
                removed.type === 'browser' ||
                removed.type === 'terminal')
          )
      )
    } else {
      const incoming = sanitizeChatResources(
        change.resources.filter((resource) => resource.id !== 'streaming-file')
      )
      const byKey = new Map(
        existing.map((resource) => [`${resource.type}:${resource.id}`, resource])
      )
      if (change.kind === 'reorder') {
        const keys = incoming.map((resource) => `${resource.type}:${resource.id}`)
        if (
          keys.length !== byKey.size ||
          new Set(keys).size !== keys.length ||
          keys.some((key) => !byKey.has(key))
        ) {
          throw new OrchestrationError(
            'validation',
            'Reordered resources must match existing resources'
          )
        }
        resources = keys.map((key) => {
          const resource = byKey.get(key)
          if (!resource) throw new OrchestrationError('validation', 'Resource order changed')
          return resource
        })
      } else {
        for (const resource of incoming) {
          const key = `${resource.type}:${resource.id}`
          const previous = byKey.get(key)
          const merged = mergeChatResource(previous, resource)
          byKey.set(key, effectId ? { ...merged, title: resource.title || merged.title } : merged)
        }
        resources = [...byKey.values()]
      }
    }
    await tx
      .update(copilotChats)
      .set({ resources: sql`${JSON.stringify(resources)}::jsonb`, updatedAt: new Date() })
      .where(eq(copilotChats.id, chatId))
    return resources
  }))
}
