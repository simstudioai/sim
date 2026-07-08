import { workspaceForkDependentValue } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkReferenceResolver } from '@/ee/workspace-forking/lib/remap/remap-references'

/** One stored dependent-field value for an edge. */
export interface ForkDependentValue {
  targetWorkflowId: string
  targetBlockId: string
  subBlockKey: string
  value: string
}

/** Stable key for a stored value (target workflow + block + subblock). */
export function forkDependentValueKey(
  targetWorkflowId: string,
  targetBlockId: string,
  subBlockKey: string
): string {
  // NUL separators so ids/keys containing ':' can't be confused for a different triple.
  return `${targetWorkflowId}\u0000${targetBlockId}\u0000${subBlockKey}`
}

/**
 * Load an edge's stored dependent values - the single source of truth for what each dependent
 * selector (Gmail label, KB document, sheet tab) is set to. Consumed two ways: the diff
 * overlays them as the modal's pre-filled value, and a promote applies them verbatim. Pass
 * `targetWorkflowIds` to scope the read to a plan's replace targets (matching the
 * `(childWorkspaceId, targetWorkflowId)` index) instead of loading the whole edge; an empty
 * array short-circuits to no rows.
 */
export async function loadForkDependentValues(
  executor: DbOrTx,
  childWorkspaceId: string,
  targetWorkflowIds?: string[]
): Promise<ForkDependentValue[]> {
  if (targetWorkflowIds && targetWorkflowIds.length === 0) return []
  const where = targetWorkflowIds
    ? and(
        eq(workspaceForkDependentValue.childWorkspaceId, childWorkspaceId),
        inArray(workspaceForkDependentValue.targetWorkflowId, targetWorkflowIds)
      )
    : eq(workspaceForkDependentValue.childWorkspaceId, childWorkspaceId)
  return executor
    .select({
      targetWorkflowId: workspaceForkDependentValue.targetWorkflowId,
      targetBlockId: workspaceForkDependentValue.targetBlockId,
      subBlockKey: workspaceForkDependentValue.subBlockKey,
      value: workspaceForkDependentValue.value,
    })
    .from(workspaceForkDependentValue)
    .where(where)
}

/**
 * Translate dependent values through the promote resolver before they are applied to the
 * written state and persisted: a value that is a SOURCE knowledge-document id (a pick under a
 * copy-resolved KB) becomes its copied/mapped counterpart id, so the
 * dependent-value apply - which runs AFTER the reference remap and wins for its subblock -
 * never writes a source-workspace document id into the target, and the store stays coherent
 * for the next sync's (then-mapped) display. Only ids the resolver actually knows are
 * rewritten: a target document id, a Gmail label, a column id, or any other opaque value
 * misses the map and is kept verbatim. Documents are the one dependent-selector value that is
 * itself a copied resource id, so `knowledge-document` is the only kind consulted. Pure.
 */
export function translateForkDependentValues(
  values: ForkDependentValue[],
  resolve: ForkReferenceResolver
): ForkDependentValue[] {
  return values.map((entry) => {
    if (entry.value === '') return entry
    const translated = resolve('knowledge-document', entry.value)
    return translated != null && translated !== entry.value
      ? { ...entry, value: translated }
      : entry
  })
}

/**
 * Replace the stored dependent values for the given target workflows with `values` (the full
 * set the modal sent). Deletes those workflows' rows first, then inserts the non-empty values,
 * so the store always equals exactly what the user configured - cleared fields drop out, and
 * blocks/fields that no longer exist are pruned. Empty values aren't stored (an empty store
 * entry and a missing one mean the same thing: unset).
 */
export async function reconcileForkDependentValues(
  executor: DbOrTx,
  childWorkspaceId: string,
  targetWorkflowIds: string[],
  values: ForkDependentValue[]
): Promise<void> {
  if (targetWorkflowIds.length > 0) {
    await executor
      .delete(workspaceForkDependentValue)
      .where(
        and(
          eq(workspaceForkDependentValue.childWorkspaceId, childWorkspaceId),
          inArray(workspaceForkDependentValue.targetWorkflowId, targetWorkflowIds)
        )
      )
  }
  // Dedupe by the stored (workflow, block, subblock) triple (last value wins) before building
  // insert rows, so a duplicated/retried payload entry can't trip the `..._field_unique` index
  // and abort the whole sync transaction. Empty values aren't stored.
  const deduped = new Map<string, ForkDependentValue>()
  for (const entry of values) {
    if (entry.value === '') continue
    deduped.set(
      forkDependentValueKey(entry.targetWorkflowId, entry.targetBlockId, entry.subBlockKey),
      entry
    )
  }
  const rows = Array.from(deduped.values()).map((entry) => ({
    id: generateId(),
    childWorkspaceId,
    targetWorkflowId: entry.targetWorkflowId,
    targetBlockId: entry.targetBlockId,
    subBlockKey: entry.subBlockKey,
    value: entry.value,
  }))
  if (rows.length === 0) return
  await executor.insert(workspaceForkDependentValue).values(rows)
}
