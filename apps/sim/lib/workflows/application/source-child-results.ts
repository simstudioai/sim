/**
 * How the server types a child workflow call's `<call.result.data.<field>>` in a JSON field: by
 * the fields the child's Response data holds (`childResultFields`), read from the child's draft
 * as stored, or as the workspace source apply that holds the call submits it. Every source compile
 * and print of a workflow goes through the same reading, so a get prints a reference in the form
 * the next apply stores again, and a workspace directory's check (which reads the children from
 * the directory) agrees with both.
 */
import {
  type ChildResultFields,
  canonicalize,
  childResultFields,
  compileWorkflow,
  type ResourceKeyResolver,
} from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import type { BlockState } from '@sim/workflow-types/workflow'
import { type CatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { loadWorkflowGraphs } from '@/lib/workflows/application/read-workflow-graph'
import { buildSourceCatalog, storedCatalogTypes } from '@/lib/workflows/code/catalog/workspace'
import { resolveIds } from '@/lib/workspaces/resource-keys'

/** A child's typed result fields, or `null` when it can end without responding or is unreadable. */
type ChildFields = ChildResultFields | null

/**
 * One request's readings of child workflows by key, each read at most once: a workspace apply
 * shares one across every workflow it evaluates.
 */
export type ChildResultsMemo = Map<string, Promise<ChildFields>>

/**
 * The files of each workflow folder a workspace source apply writes, by key: a workflow calling
 * one is typed by the child's Response data as the folder holds it, as the directory's check
 * types it, not as stored.
 */
export type ChildSources = ReadonlyMap<string, Readonly<Record<string, string>>>

export interface ChildResultsScope {
  workspaceId: string
  workspaceOrganizationId: string | null
  /** The caller's catalog gate, which the children are compiled or canonicalized under. */
  gate: CatalogGate
  memo: ChildResultsMemo
  /** The folders the enclosing workspace source apply writes: such a child is read as submitted. */
  submitted?: ChildSources
}

/**
 * Canonicalize reads resources only to lift ids to keys, which no Response field's type depends
 * on, so the children are read without the workspace's resource keys.
 */
const UNRESOLVED: ResourceKeyResolver = { toKey: () => null, toId: () => null }

/** The fields of a submitted folder, compiled on its own as the directory's check compiles it. */
function submittedFields(
  files: Readonly<Record<string, string>>,
  scope: ChildResultsScope
): ChildFields {
  const entry = files[SOURCE_ENTRY_FILE]
  if (entry === undefined) return null
  const catalog = buildSourceCatalog({
    gate: scope.gate,
    organizationId: scope.workspaceOrganizationId,
  })
  const { workflow } = compileWorkflow({
    entry: { path: SOURCE_ENTRY_FILE, text: entry },
    files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
  })
  return workflow ? childResultFields(workflow, catalog) : null
}

/** Stored workflow graphs by id, as `loadWorkflowGraphs` reads them. */
export type StoredGraphs = Awaited<ReturnType<typeof loadWorkflowGraphs>>

/** The fields of a stored child workflow, canonicalized under its own source catalog. */
function storedGraphFields(
  loaded: NonNullable<ReturnType<StoredGraphs['get']>>,
  scope: ChildResultsScope
): ChildFields {
  const { blocks, edges, loops, parallels, variables } = loaded.graph
  const catalog = buildSourceCatalog({
    gate: scope.gate,
    organizationId: scope.workspaceOrganizationId,
    storedTypes: storedCatalogTypes(Object.values(blocks)),
  })
  const { workflow } = canonicalize(
    { blocks, edges, loops, parallels, variables },
    {
      catalog,
      meta: { name: loaded.name, description: loaded.description ?? null },
      resources: UNRESOLVED,
    }
  )
  return childResultFields(workflow, catalog)
}

/** The fields of each stored workflow `keys` name in the workspace, by key. */
async function storedFields(
  keys: readonly string[],
  scope: ChildResultsScope
): Promise<Map<string, ChildFields>> {
  const ids =
    (
      await resolveIds(
        scope.workspaceId,
        keys.map((key) => ({ kind: 'workflow' as const, key }))
      )
    ).get('workflow') ?? new Map<string, string>()
  const graphs = await loadWorkflowGraphs(scope.workspaceId, [...ids.values()])
  const fields = new Map<string, ChildFields>()
  for (const key of keys) {
    const id = ids.get(key)
    const loaded = id === undefined ? undefined : graphs.get(id)
    fields.set(key, loaded ? storedGraphFields(loaded, scope) : null)
  }
  return fields
}

/**
 * The ids of the workflows stored `blocks` may run as children (each `workflowId` value), for a
 * read to load their graphs with its own: a superset of the calls its canonical model names.
 */
export function storedChildWorkflowIds(blocks: Iterable<BlockState>): string[] {
  const ids = new Set<string>()
  for (const block of blocks) {
    const value = block.subBlocks?.workflowId?.value
    if (typeof value === 'string' && value !== '') ids.add(value)
  }
  return [...ids]
}

/**
 * Loads the graphs of the workflows `ids` name that `loaded` lacks, in one read, and returns them
 * with `loaded`'s ({@link storedChildWorkflowIds}).
 */
export async function loadChildGraphs(
  workspaceId: string,
  ids: readonly string[],
  loaded: StoredGraphs = new Map()
): Promise<StoredGraphs> {
  const missing = [...new Set(ids)].filter((id) => !loaded.has(id))
  if (missing.length === 0) return loaded
  return new Map([...loaded, ...(await loadWorkflowGraphs(workspaceId, missing))])
}

/**
 * The typed result fields of each child workflow `keys` name that always responds, by key: a
 * child the enclosing apply submits as submitted, any other as its stored draft in the workspace
 * (one the workspace does not hold, or holds archived, is left out). Each key is read once per
 * `scope.memo`.
 */
export async function loadChildResults(
  scope: ChildResultsScope,
  keys: readonly string[]
): Promise<Map<string, ChildResultFields>> {
  const unread = keys.filter((key) => !scope.memo.has(key))
  const stored = unread.filter((key) => !scope.submitted?.has(key))
  if (unread.length > 0) {
    const reading = withCatalogBlockScope(scope.gate, async () => {
      const fields = stored.length > 0 ? await storedFields(stored, scope) : new Map()
      for (const key of unread) {
        const files = scope.submitted?.get(key)
        if (files) fields.set(key, submittedFields(files, scope))
      }
      return fields
    })
    for (const key of unread) {
      scope.memo.set(
        key,
        reading.then((fields) => fields.get(key) ?? null)
      )
    }
  }
  const read = await Promise.all(keys.map(async (key) => [key, await scope.memo.get(key)] as const))
  const results = new Map<string, ChildResultFields>()
  for (const [key, fields] of read) if (fields) results.set(key, fields)
  return results
}

/**
 * {@link loadChildResults} for a read of stored workflows that loaded their children's graphs with
 * {@link loadChildGraphs} (`toId` names the workflow a key resolves to): a child read from there,
 * where one the workspace does not hold or holds archived is left out, so a read makes no query of
 * its own. A key that resolves to no workflow is read as {@link loadChildResults} reads it.
 */
export async function loadChildResultsFrom(
  scope: ChildResultsScope,
  keys: readonly string[],
  graphs: StoredGraphs,
  toId: (key: string) => string | null
): Promise<Map<string, ChildResultFields>> {
  await withCatalogBlockScope(scope.gate, async () => {
    for (const key of keys) {
      const id = toId(key)
      if (id === null || scope.memo.has(key) || scope.submitted?.has(key)) continue
      const loaded = graphs.get(id)
      scope.memo.set(key, Promise.resolve(loaded ? storedGraphFields(loaded, scope) : null))
    }
  })
  return loadChildResults(scope, keys)
}
