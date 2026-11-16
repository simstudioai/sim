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
  workspaceResourceKey,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { compareStrings, slugify } from '@sim/utils/string'
import type { ResourceKind } from '@sim/workflow-code'
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Persisted resource keys (`workspace_resource_key`): the only mapping between a workflow
 * source key such as `table('leads')` and a resource id.
 *
 * A key is allocated the first time something needs one for a resource, derived from the
 * resource's name at that moment, and never changes afterwards. Renaming the resource keeps its
 * key; deleting it leaves the key on the dead id, so the key stops resolving instead of
 * moving to another resource with the same name. Only resources that are live in the given
 * workspace resolve in either direction, so an id or key from another workspace never does.
 *
 * Both functions join the caller's transaction when given one (`executor`). Allocation re-reads
 * after each insert, so the caller's transaction must run at READ COMMITTED (the default).
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
 * left out. A kind without a loader has no workspace table to check and never resolves.
 */
const LIVE_RESOURCE_LOADERS: Partial<Record<ResourceKind, LiveResourceLoader>> = {
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

async function readKeysByResource(
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
  const resolved: ResourceKeyMap = new Map()
  for (const [kind, ids] of groupByKind(refs, (ref) => ref.id)) {
    const live = await loadLiveResources(executor, workspaceId, kind, ids)
    if (live.length === 0) continue
    const keys = await readKeysByResource(
      executor,
      workspaceId,
      kind,
      live.map((row) => row.id)
    )
    const unbound = live.filter((row) => !keys.has(row.id))
    if (unbound.length > 0) {
      const allocated = await allocateKeys(
        executor,
        workspaceId,
        kind,
        unbound,
        options.createdBy ?? null
      )
      for (const [id, key] of allocated) keys.set(id, key)
    }
    resolved.set(kind, keys)
  }
  return resolved
}

/**
 * The resource each key is bound to in `workspaceId`, when that resource is still live. A key
 * with no key, or keyed to a deleted or archived resource, is left out: it is never re-pointed
 * at another resource. Never allocates.
 */
export async function resolveIds(
  workspaceId: string,
  refs: Iterable<ResourceKeyRef>,
  options: ResourceKeyOptions = {}
): Promise<ResourceKeyMap> {
  const executor = options.executor ?? db
  const resolved: ResourceKeyMap = new Map()
  for (const [kind, keys] of groupByKind(refs, (ref) => ref.key)) {
    if (!LIVE_RESOURCE_LOADERS[kind]) continue
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
    if (rows.length === 0) continue
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
    if (ids.size > 0) resolved.set(kind, ids)
  }
  return resolved
}
