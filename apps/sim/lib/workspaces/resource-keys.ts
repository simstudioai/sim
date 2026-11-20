import { db } from '@sim/db'
import {
  credential,
  customTools,
  folder,
  knowledgeBase,
  mcpServers,
  skill,
  userTableDefinitions,
  workflow,
  workspaceFiles,
  workspaceResourceKey,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { compareStrings, slugify } from '@sim/utils/string'
import type { ResourceKind } from '@sim/workflow-code'
import { and, asc, eq, inArray, isNull, like, or } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

/**
 * Persisted resource keys (`workspace_resource_key`): the only mapping between a workflow
 * source key such as `table('leads')` and a resource id.
 *
 * A key is allocated the first time something needs one for a resource, derived from the
 * resource's name at that moment, and never changes afterwards. Renaming the resource keeps its
 * key; deleting it leaves the key on the dead id, so the key stops resolving instead of
 * moving to another resource with the same name; only {@link claimResourceKey}, for workspace
 * source that names the key explicitly, moves a key off a dead resource. Only resources that are
 * live in the given workspace resolve in either direction, so an id or key from another workspace
 * never does.
 *
 * `resolveKeys` and `resolveIds` join the caller's transaction when given one (`executor`).
 * Allocation re-reads after each insert, so the caller's transaction must run at READ COMMITTED
 * (the default).
 */

const logger = createLogger('ResourceKeys')

const MAX_KEY_LENGTH = 64

/**
 * Characters of a key base compared when collecting taken keys: a suffixed key keeps at least
 * this much of its base, so every key a candidate could collide with shares this prefix.
 */
const TAKEN_PREFIX_LENGTH = 48

/** Insert rounds before an allocation that keeps losing races is left unresolved. */
const MAX_ALLOCATION_ROUNDS = 5

/**
 * Claim retries after an insert that lost a race on one of the two unique indexes; each retry
 * re-reads the committed winner, so a second attempt normally settles it.
 */
const MAX_CLAIM_ATTEMPTS = 3

interface LiveResource {
  id: string
  name: string
  createdAt: Date
}

type LiveResourceLoader = (
  executor: DbOrTx,
  workspaceId: string,
  ids: string[]
) => Promise<LiveResource[]>

/**
 * Reads the live resources among `ids` in one workspace: archived, deleted and foreign rows are
 * left out. Every kind is listed, so a new one fails to compile until it has a loader; `null`
 * marks a kind with no workspace table to check, whose keys never resolve.
 */
const LIVE_RESOURCE_LOADERS: Record<ResourceKind, LiveResourceLoader | null> = {
  'knowledge-document': null,
  'custom-block': null,
  sandbox: null,
  table: (executor, workspaceId, ids) =>
    executor
      .select({
        id: userTableDefinitions.id,
        name: userTableDefinitions.name,
        createdAt: userTableDefinitions.createdAt,
      })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.workspaceId, workspaceId),
          inArray(userTableDefinitions.id, ids),
          isNull(userTableDefinitions.archivedAt)
        )
      ),
  'knowledge-base': (executor, workspaceId, ids) =>
    executor
      .select({
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        createdAt: knowledgeBase.createdAt,
      })
      .from(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.workspaceId, workspaceId),
          inArray(knowledgeBase.id, ids),
          isNull(knowledgeBase.deletedAt)
        )
      ),
  workflow: (executor, workspaceId, ids) =>
    executor
      .select({ id: workflow.id, name: workflow.name, createdAt: workflow.createdAt })
      .from(workflow)
      .where(
        and(
          eq(workflow.workspaceId, workspaceId),
          inArray(workflow.id, ids),
          isNull(workflow.archivedAt)
        )
      ),
  'custom-tool': (executor, workspaceId, ids) =>
    executor
      .select({ id: customTools.id, name: customTools.title, createdAt: customTools.createdAt })
      .from(customTools)
      .where(and(eq(customTools.workspaceId, workspaceId), inArray(customTools.id, ids))),
  'mcp-server': (executor, workspaceId, ids) =>
    executor
      .select({ id: mcpServers.id, name: mcpServers.name, createdAt: mcpServers.createdAt })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.workspaceId, workspaceId),
          inArray(mcpServers.id, ids),
          isNull(mcpServers.deletedAt)
        )
      ),
  skill: (executor, workspaceId, ids) =>
    executor
      .select({ id: skill.id, name: skill.name, createdAt: skill.createdAt })
      .from(skill)
      .where(and(eq(skill.workspaceId, workspaceId), inArray(skill.id, ids))),
  credential: (executor, workspaceId, ids) =>
    executor
      .select({ id: credential.id, name: credential.displayName, createdAt: credential.createdAt })
      .from(credential)
      .where(and(eq(credential.workspaceId, workspaceId), inArray(credential.id, ids))),
  file: (executor, workspaceId, ids) =>
    executor
      .select({
        id: workspaceFiles.id,
        name: workspaceFiles.originalName,
        createdAt: workspaceFiles.uploadedAt,
      })
      .from(workspaceFiles)
      .where(
        and(
          fileOwnerCondition({ entityType: 'workspace', entityId: workspaceId }),
          inArray(workspaceFiles.id, ids),
          isNull(workspaceFiles.deletedAt)
        )
      ),
  'file-folder': (executor, workspaceId, ids) =>
    executor
      .select({ id: folder.id, name: folder.name, createdAt: folder.createdAt })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, workspaceId),
          inArray(folder.id, ids),
          eq(folder.resourceType, 'file'),
          isNull(folder.deletedAt)
        )
      ),
}

export interface ResourceIdRef {
  kind: ResourceKind
  id: string
}

export interface ResourceKeyRef {
  kind: ResourceKind
  key: string
}

/** kind → (id → key), or kind → (key → id); only live, bound resources appear. */
export type ResourceKeyMap = Map<ResourceKind, Map<string, string>>

interface ResourceKeyOptions {
  /** The caller's transaction, when the lookup must see or join its writes. */
  executor?: DbOrTx
}

interface ResolveKeysOptions extends ResourceKeyOptions {
  /** The human the allocation is attributed to; `null` for an actorless caller. */
  createdBy?: string | null
  /** `false` leaves a resource with no key out instead of allocating it one (a read that writes nothing). */
  allocate?: boolean
}

function trimKey(value: string, maxLength: number): string {
  return value.slice(0, maxLength).replace(/-+$/, '')
}

/**
 * The key a resource is first offered: its name's slug, or the kind when the name has no slug
 * characters; prefixed with the kind when the slug starts with a digit, and cut to the key
 * length. Always matches the stored key format `^[a-z][a-z0-9_-]{0,63}$`.
 */
export function resourceKeyBase(kind: ResourceKind, name: string): string {
  const slug = slugify(name)
  const base = slug === '' ? kind : /^[a-z]/.test(slug) ? slug : `${kind}-${slug}`
  return trimKey(base, MAX_KEY_LENGTH)
}

/** `base` when free, else the first free `base-2`, `base-3`, … (the base cut to fit). */
export function nextFreeKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const tail = `-${suffix}`
    const key = `${trimKey(base, MAX_KEY_LENGTH - tail.length)}${tail}`
    if (!taken.has(key)) return key
  }
}

function groupByKind<T extends { kind: ResourceKind }>(
  refs: Iterable<T>,
  value: (ref: T) => string
): Map<ResourceKind, string[]> {
  const grouped = new Map<ResourceKind, Set<string>>()
  for (const ref of refs) {
    const values = grouped.get(ref.kind) ?? new Set<string>()
    values.add(value(ref))
    grouped.set(ref.kind, values)
  }
  return new Map([...grouped].map(([kind, values]) => [kind, [...values]]))
}

async function loadLiveResources(
  executor: DbOrTx,
  workspaceId: string,
  kind: ResourceKind,
  ids: string[]
): Promise<LiveResource[]> {
  const load = LIVE_RESOURCE_LOADERS[kind]
  if (!load || ids.length === 0) return []
  return load(executor, workspaceId, ids)
}

/**
 * The keys bound to `resourceIds` (resource id → key), whether or not each resource is live.
 * Never allocates.
 */
export async function readKeysByResource(
  executor: DbOrTx,
  workspaceId: string,
  kind: ResourceKind,
  resourceIds: string[]
): Promise<Map<string, string>> {
  if (resourceIds.length === 0) return new Map()
  const rows = await executor
    .select({ resourceId: workspaceResourceKey.resourceId, key: workspaceResourceKey.key })
    .from(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, workspaceId),
        eq(workspaceResourceKey.kind, kind),
        inArray(workspaceResourceKey.resourceId, resourceIds)
      )
    )
  return new Map(rows.map((row) => [row.resourceId, row.key]))
}

/**
 * The resource `key` is bound to, live or not, or null when it is free; locks the binding for the
 * rest of `tx`, so what a claim or release in it replaces is what this read.
 */
export async function lockKeyHolder(
  tx: DbTransaction,
  workspaceId: string,
  kind: ResourceKind,
  key: string
): Promise<string | null> {
  const [row] = await tx
    .select({ resourceId: workspaceResourceKey.resourceId })
    .from(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, workspaceId),
        eq(workspaceResourceKey.kind, kind),
        eq(workspaceResourceKey.key, key)
      )
    )
    .for('update')
  return row?.resourceId ?? null
}

async function readTakenKeys(
  executor: DbOrTx,
  workspaceId: string,
  kind: ResourceKind,
  bases: string[]
): Promise<Set<string>> {
  const prefixes = [...new Set(bases.map((base) => base.slice(0, TAKEN_PREFIX_LENGTH)))]
  const rows = await executor
    .select({ key: workspaceResourceKey.key })
    .from(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, workspaceId),
        eq(workspaceResourceKey.kind, kind),
        or(...prefixes.map((prefix) => like(workspaceResourceKey.key, `${prefix}%`)))
      )
    )
  return new Set(rows.map((row) => row.key))
}

/**
 * Binds every unbound resource in `unbound` and returns the keys now bound to them. Each round
 * offers the oldest resource the lowest free key and inserts with on-conflict-do-nothing: a row
 * that loses a race (the resource bound concurrently, or its key taken by another resource) is
 * skipped and re-read, so concurrent callers converge on one key per resource.
 */
async function allocateKeys(
  executor: DbOrTx,
  workspaceId: string,
  kind: ResourceKind,
  unbound: LiveResource[],
  createdBy: string | null
): Promise<Map<string, string>> {
  const allocated = new Map<string, string>()
  let pending = [...unbound].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || compareStrings(a.id, b.id)
  )
  for (let round = 0; round < MAX_ALLOCATION_ROUNDS && pending.length > 0; round += 1) {
    const bases = new Map(pending.map((row) => [row.id, resourceKeyBase(kind, row.name)]))
    const taken = await readTakenKeys(executor, workspaceId, kind, [...bases.values()])
    const now = new Date()
    const values = pending.map((row) => {
      const key = nextFreeKey(bases.get(row.id) ?? kind, taken)
      taken.add(key)
      return {
        id: generateId(),
        workspaceId,
        kind,
        key,
        resourceId: row.id,
        origin: 'allocated' as const,
        createdBy,
        createdAt: now,
        updatedAt: now,
      }
    })
    await executor.insert(workspaceResourceKey).values(values).onConflictDoNothing()
    const bound = await readKeysByResource(
      executor,
      workspaceId,
      kind,
      pending.map((row) => row.id)
    )
    for (const [resourceId, key] of bound) allocated.set(resourceId, key)
    pending = pending.filter((row) => !bound.has(row.id))
  }
  if (pending.length > 0) {
    logger.warn('Resource key allocation did not converge; leaving resources unresolved', {
      workspaceId,
      kind,
      unresolvedCount: pending.length,
    })
  }
  return allocated
}

/**
 * The key of each referenced resource that is live in `workspaceId`, allocating one for a
 * resource that has none yet. Ids that are deleted, archived, from another workspace, or of a
 * kind with no workspace table are left out (the caller treats them as unresolved).
 *
 * Allocation is a metadata write that callers with read access may cause (`source get`): it is
 * idempotent identity allocation that changes no resource, only records the name the resource is
 * printed under from now on, and a second call returns the same key without writing. Concurrent
 * calls for the same resource insert with on-conflict-do-nothing and re-read, so they agree on one
 * key.
 */
export async function resolveKeys(
  workspaceId: string,
  refs: Iterable<ResourceIdRef>,
  options: ResolveKeysOptions = {}
): Promise<ResourceKeyMap> {
  const executor = options.executor ?? db
  const byKind = await Promise.all(
    [...groupByKind(refs, (ref) => ref.id)].map(async ([kind, ids]) => {
      const live = await loadLiveResources(executor, workspaceId, kind, ids)
      if (live.length === 0) return null
      const keys = await readKeysByResource(
        executor,
        workspaceId,
        kind,
        live.map((row) => row.id)
      )
      const unbound = live.filter((row) => !keys.has(row.id))
      if (unbound.length > 0 && options.allocate !== false) {
        const allocated = await allocateKeys(
          executor,
          workspaceId,
          kind,
          unbound,
          options.createdBy ?? null
        )
        for (const [id, key] of allocated) keys.set(id, key)
      }
      return [kind, keys] as const
    })
  )
  return new Map(byKind.filter((entry) => entry !== null))
}

/**
 * The resource each key is bound to in `workspaceId`, when that resource is still live. A key
 * bound to no resource, or to a deleted or archived one, is left out: it is never re-pointed at
 * another resource. Never allocates.
 */
export async function resolveIds(
  workspaceId: string,
  refs: Iterable<ResourceKeyRef>,
  options: ResourceKeyOptions = {}
): Promise<ResourceKeyMap> {
  const executor = options.executor ?? db
  const byKind = await Promise.all(
    [...groupByKind(refs, (ref) => ref.key)].map(async ([kind, keys]) => {
      if (!LIVE_RESOURCE_LOADERS[kind]) return null
      const rows = await executor
        .select({
          key: workspaceResourceKey.key,
          resourceId: workspaceResourceKey.resourceId,
        })
        .from(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, kind),
            inArray(workspaceResourceKey.key, keys)
          )
        )
      if (rows.length === 0) return null
      const live = new Set(
        (
          await loadLiveResources(
            executor,
            workspaceId,
            kind,
            rows.map((row) => row.resourceId)
          )
        ).map((row) => row.id)
      )
      const ids = new Map<string, string>()
      for (const row of rows) if (live.has(row.resourceId)) ids.set(row.key, row.resourceId)
      return ids.size > 0 ? ([kind, ids] as const) : null
    })
  )
  return new Map(byKind.filter((entry) => entry !== null))
}

/**
 * The keys bound to live resources of `kind` in `workspaceId`, sorted, at most `limit` of them:
 * what a source could name instead of a key that resolves to nothing. Never allocates.
 */
export async function listLiveKeys(
  workspaceId: string,
  kind: ResourceKind,
  options: ResourceKeyOptions & { limit: number }
): Promise<Array<{ key: string; resourceId: string }>> {
  if (!LIVE_RESOURCE_LOADERS[kind]) return []
  const executor = options.executor ?? db
  const rows = await executor
    .select({ key: workspaceResourceKey.key, resourceId: workspaceResourceKey.resourceId })
    .from(workspaceResourceKey)
    .where(
      and(eq(workspaceResourceKey.workspaceId, workspaceId), eq(workspaceResourceKey.kind, kind))
    )
    .orderBy(asc(workspaceResourceKey.key))
    .limit(options.limit)
  const live = new Set(
    (
      await loadLiveResources(
        executor,
        workspaceId,
        kind,
        rows.map((row) => row.resourceId)
      )
    ).map((row) => row.id)
  )
  return rows.filter((row) => live.has(row.resourceId))
}

/** Another live resource of the kind holds the key a source claims. */
export class ResourceKeyTakenError extends OrchestrationError {
  constructor(
    readonly kind: ResourceKind,
    readonly key: string,
    readonly holderId: string
  ) {
    super('conflict', `The ${kind} key "${key}" belongs to another ${kind}.`)
    this.name = 'ResourceKeyTakenError'
  }
}

/** What claiming a key did: bound it, found it already bound, or moved it off a dead resource. */
export type ResourceKeyClaim = 'bound' | 'kept' | 'rebound'

/**
 * Binds `key` to `resourceId`, for a source that names the resource by that key: a resource it
 * created (`origin: 'created'`) or an unbound one it adopted by name (`'adopted'`). A key still
 * bound to a deleted or archived resource moves to the new one (`'rebound'`), so deleting a
 * declared resource and applying again re-creates it under the same key. A key held by another
 * live resource throws {@link ResourceKeyTakenError}, unless `takeFrom` names that resource: then
 * the key moves off it (a source that rebinds a key on purpose). A key the resource held before
 * (allocated by a get) is replaced, since the source now names it. Runs in one transaction: `tx`
 * when given, so the claim commits or rolls back with the write that made the resource.
 *
 * An unheld key has no row to lock, so a concurrent get or claim can bind the key, or bind the
 * resource to another key, between the read and the insert. The insert skips on either unique
 * index and the claim re-reads the committed winner: its own key is `'kept'`, another live
 * resource's key throws {@link ResourceKeyTakenError}, and a key allocated to the resource
 * meanwhile is replaced on the retry.
 */
export async function claimResourceKey(input: {
  workspaceId: string
  kind: ResourceKind
  key: string
  resourceId: string
  origin: 'created' | 'adopted'
  createdBy: string | null
  /** The live resource the key may be moved off; any other live holder still refuses. */
  takeFrom?: string
  /** The transaction to claim in, instead of a transaction of its own. */
  tx?: DbTransaction
}): Promise<ResourceKeyClaim> {
  const { workspaceId, kind, key, resourceId } = input
  const claim = async (tx: DbTransaction): Promise<ResourceKeyClaim> => {
    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const [holder] = await tx
        .select({ id: workspaceResourceKey.id, resourceId: workspaceResourceKey.resourceId })
        .from(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, kind),
            eq(workspaceResourceKey.key, key)
          )
        )
        .for('update')
      if (holder?.resourceId === resourceId) return 'kept'
      if (holder && holder.resourceId !== input.takeFrom) {
        const live = await loadLiveResources(tx, workspaceId, kind, [holder.resourceId])
        if (live.length > 0) throw new ResourceKeyTakenError(kind, key, holder.resourceId)
      }
      await tx
        .delete(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, kind),
            or(
              eq(workspaceResourceKey.resourceId, resourceId),
              holder ? eq(workspaceResourceKey.id, holder.id) : undefined
            )
          )
        )
      const now = new Date()
      const inserted = await tx
        .insert(workspaceResourceKey)
        .values({
          id: generateId(),
          workspaceId,
          kind,
          key,
          resourceId,
          origin: input.origin,
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: workspaceResourceKey.id })
      if (inserted.length > 0) return holder ? 'rebound' : 'bound'
    }
    throw new Error(`Claiming the ${kind} key "${key}" kept losing to concurrent writers`)
  }
  return input.tx ? claim(input.tx) : db.transaction(claim)
}

/**
 * Unbinds `key` from `resourceId`, for a source that stops naming the resource by it; a key bound
 * to anything else is left as it is. Returns whether a binding was removed. The resource itself
 * is untouched, and a later get allocates it a key again.
 */
export async function releaseResourceKey(input: {
  workspaceId: string
  kind: ResourceKind
  key: string
  resourceId: string
}): Promise<boolean> {
  const removed = await db
    .delete(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, input.workspaceId),
        eq(workspaceResourceKey.kind, input.kind),
        eq(workspaceResourceKey.key, input.key),
        eq(workspaceResourceKey.resourceId, input.resourceId)
      )
    )
    .returning({ id: workspaceResourceKey.id })
  return removed.length > 0
}
