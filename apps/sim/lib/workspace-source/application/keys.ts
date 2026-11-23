/**
 * How every kind binds its stored resources to source keys, and claims a key for a resource an
 * apply wrote.
 */
import { db } from '@sim/db'
import { generateId } from '@sim/utils/id'
import type { ResourceKind } from '@sim/workflow-code'
import { WORKSPACE_KIND_SPECS, type WorkspaceKind } from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import type { DbTransaction } from '@/lib/db/types'
import type { PendingResource } from '@/lib/workflows/application/source-pipeline'
import { reboundFinding } from '@/lib/workspace-source/application/findings'
import type {
  PlannedChange,
  SourceContext,
  StoredResource,
  StoredSet,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
import { claimResourceKey, readKeysByResource, resolveKeys } from '@/lib/workspaces/resource-keys'

/**
 * The resource kind `kind`'s keys are recorded under; throws for a kind with no key row of its own
 * (a secret, a file, a deployment), which never claims a key or stands in as pending.
 */
function resourceKindOf(kind: WorkspaceKind): ResourceKind {
  const resourceKind = WORKSPACE_KIND_SPECS[kind].resourceKind
  if (resourceKind === null) throw new Error(`The ${kind} kind has no resource keys`)
  return resourceKind
}

/**
 * Binds each stored resource to its key: a get (`allocate`) allocates a key for every resource
 * that has none, an apply never does, so an unbound resource can still be adopted by name. A
 * resource `bindable` turns down stays unbound and never gets a key.
 */
export async function bindStored<S>(
  ctx: SourceContext,
  kind: ResourceKind,
  records: ReadonlyArray<Omit<StoredResource<S>, 'key'>>,
  options: { allocate: boolean; bindable?: (record: Omit<StoredResource<S>, 'key'>) => boolean }
): Promise<StoredSet<S>> {
  const { workspaceId } = ctx.workspace
  const bindable = options.bindable ?? (() => true)
  const ids = records.filter(bindable).map((record) => record.id)
  const keys = options.allocate
    ? ((
        await resolveKeys(
          workspaceId,
          ids.map((id) => ({ kind, id })),
          { createdBy: ctx.createdBy }
        )
      ).get(kind) ?? new Map<string, string>())
    : await readKeysByResource(db, workspaceId, kind, ids)
  const set: StoredSet<S> = { bound: new Map(), unbound: [] }
  for (const record of records) {
    const key = bindable(record) ? keys.get(record.id) : undefined
    if (key === undefined) set.unbound.push({ ...record, key: '' })
    else set.bound.set(key, { ...record, key })
  }
  return set
}

/**
 * A kind's stored resources, page by page, until the listing ends or holds more than one directory
 * may (`maxResourcesPerKind`): a workspace over the limit costs one page past it, never a full
 * listing.
 */
export async function listUpTo<T, C>(
  fetchPage: (cursor: C | undefined) => Promise<{ items: readonly T[]; next: C | null | undefined }>
): Promise<T[]> {
  const items: T[] = []
  let cursor: C | undefined
  do {
    const page = await fetchPage(cursor)
    items.push(...page.items)
    cursor = page.next ?? undefined
  } while (cursor !== undefined && items.length <= WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind)
  return items
}

/**
 * Binds `change.key` to the resource the change wrote: inside the write's own transaction `tx`
 * (a create no later apply could adopt by name, so a claim that fails rolls the create back), or
 * once the write succeeded, so a write that fails leaves the key free and the next apply adopts
 * the resource by name. Returns `I_KEY_REBOUND` when the key named a deleted resource. A kind
 * keyed by another kind's keys or by path (no `resourceKind`) claims nothing.
 */
export async function claimKey(
  change: Pick<PlannedChange, 'kind' | 'key' | 'action'>,
  ctx: SourceContext,
  resourceId: string,
  tx?: DbTransaction
): Promise<WorkspaceSourceDiagnostic[]> {
  const kind = WORKSPACE_KIND_SPECS[change.kind].resourceKind
  if (kind === null) return []
  const claim = await claimResourceKey({
    workspaceId: ctx.workspace.workspaceId,
    kind,
    key: change.key,
    resourceId,
    origin: change.action === 'create' ? 'created' : 'adopted',
    createdBy: ctx.createdBy,
    ...(tx ? { tx } : {}),
  })
  return claim === 'rebound' ? [reboundFinding(change.kind, change.key)] : []
}

/**
 * The pending entry of a planned change (see `PlannedChange.pending`): a create stands in under a
 * fresh placeholder id, anything else under its stored id. `extra` is what the kind adds (the name
 * a reference repeats, a table's declared columns).
 */
export function pendingOf(
  change: Pick<PlannedChange, 'kind' | 'key' | 'action' | 'storedId'>,
  extra: Pick<PendingResource, 'name' | 'columns'> = {}
): PendingResource {
  const stored = change.action !== 'create' ? change.storedId : undefined
  return {
    kind: resourceKindOf(change.kind),
    key: change.key,
    ...(stored ? { id: stored } : { id: generateId(), placeholder: true }),
    ...extra,
  }
}
