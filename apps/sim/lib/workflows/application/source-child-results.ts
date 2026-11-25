/**
 * How the server types a child workflow call's `<call.result.data.<field>>` in a JSON field: by
 * the fields the child's Response data holds (`childResultFields`), read from the child's draft
 * as stored, or as the workspace source apply that holds the call submits it, each typed in turn
 * by the workflows it calls (`resolveChildResults`). Every source compile and print of a workflow
 * goes through the same reading, so a get prints a reference in the form the next apply stores
 * again, and a workspace directory's check (which reads the children from the directory the same
 * way) agrees with both.
 */
import {
  type ChildResultFields,
  type ChildResultNode,
  canonicalize,
  canonicalResultNode,
  compiledResultNode,
  folderCompileInput,
  parseWorkflowLock,
  type ResourceKeyResolver,
  resolveChildResults,
} from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import type { BlockState } from '@sim/workflow-types/workflow'
import { type CatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { loadWorkflowGraphs } from '@/lib/workflows/application/read-workflow-graph'
import { buildSourceCatalog, storedCatalogTypes } from '@/lib/workflows/code/catalog/workspace'
import { resolveIds, resolveKeys } from '@/lib/workspaces/resource-keys'

/** A child's typed result fields, or `null` when it can end without responding or is unreadable. */
type ChildFields = ChildResultFields | null

/**
 * One request's readings of child workflows by key, each read at most once: a workspace apply
 * shares one across every workflow it evaluates.
 */
export type ChildResultsMemo = Map<string, Promise<ChildFields>>

/** A workflow folder as a workspace source apply submits it: its files and `.sim/lock.json`. */
interface ChildSource {
  files: Readonly<Record<string, string>>
  lock: unknown
}

/**
 * The workflow folders a workspace source apply writes with files, by key: a workflow calling
 * one is typed by the child's Response data as the folder holds it, as the directory's check
 * types it, not as stored.
 */
export type ChildSources = ReadonlyMap<string, ChildSource>

export interface ChildResultsScope {
  workspaceId: string
  workspaceOrganizationId: string | null
  /** The caller's catalog gate, which the children are compiled or canonicalized under. */
  gate: CatalogGate
  memo: ChildResultsMemo
  /** The folders the enclosing workspace source apply writes: such a child is read as submitted. */
  submitted?: ChildSources
}

/** Stored workflow graphs by id, as `loadWorkflowGraphs` reads them. */
export type StoredGraphs = Awaited<ReturnType<typeof loadWorkflowGraphs>>

/** One stored workflow graph, as `loadWorkflowGraphs` reads it. */
type StoredGraph = NonNullable<ReturnType<StoredGraphs['get']>>

/** Graphs a read already loaded, and the workflow each child key resolves to for it. */
interface LoadedChildren {
  graphs: StoredGraphs
  toId: (key: string) => string | null
}

/**
 * A submitted folder compiled as the directory's check compiles it ({@link folderCompileInput}):
 * continuing the stored workflow its lock binds, so a `stored()` param compiles unread, against
 * the catalog the child's own apply compiles it with: the workspace catalog plus the types its
 * stored draft holds (`stored`, absent for a workflow the apply creates).
 */
function submittedNode(
  source: ChildSource,
  stored: StoredGraph | undefined,
  scope: ChildResultsScope
): ChildResultNode | null {
  const entry = source.files[SOURCE_ENTRY_FILE]
  if (entry === undefined) return null
  const catalog = buildSourceCatalog({
    gate: scope.gate,
    organizationId: scope.workspaceOrganizationId,
    storedTypes: storedCatalogTypes(Object.values(stored?.graph.blocks ?? {})),
  })
  const lock = source.lock === undefined ? undefined : parseWorkflowLock(source.lock).lock
  return compiledResultNode(folderCompileInput(entry, source.files, lock, catalog))
}

/**
 * A stored workflow canonicalized under its own source catalog, with only the workflows it calls
 * lifted to their keys: no Response field's type depends on any other resource's key.
 */
function storedNode(
  loaded: StoredGraph,
  workflowKeys: ReadonlyMap<string, string>,
  scope: ChildResultsScope
): ChildResultNode {
  const { blocks, edges, loops, parallels, variables } = loaded.graph
  const catalog = buildSourceCatalog({
    gate: scope.gate,
    organizationId: scope.workspaceOrganizationId,
    storedTypes: storedCatalogTypes(Object.values(blocks)),
  })
  const resources: ResourceKeyResolver = {
    toKey: (kind, id) => (kind === 'workflow' ? (workflowKeys.get(id) ?? null) : null),
    toId: () => null,
  }
  const { workflow } = canonicalize(
    { blocks, edges, loops, parallels, variables },
    { catalog, meta: { name: loaded.name, description: loaded.description ?? null }, resources }
  )
  return canonicalResultNode(workflow, catalog)
}

/**
 * The stored graph of each workflow `keys` name in the workspace, by key (one the workspace does
 * not hold, or holds archived, is left out): from `loaded` when it holds the graph a key resolves
 * to, else read in one query.
 */
async function keyedGraphs(
  keys: readonly string[],
  scope: ChildResultsScope,
  loaded: LoadedChildren | undefined
): Promise<Map<string, StoredGraph>> {
  const ids = new Map<string, string>()
  for (const key of keys) {
    const id = loaded ? loaded.toId(key) : null
    if (id !== null && loaded?.graphs.has(id)) ids.set(key, id)
  }
  const unloaded = keys.filter((key) => !ids.has(key))
  if (unloaded.length > 0) {
    const resolved =
      (
        await resolveIds(
          scope.workspaceId,
          unloaded.map((key) => ({ kind: 'workflow' as const, key }))
        )
      ).get('workflow') ?? new Map<string, string>()
    for (const [key, id] of resolved) ids.set(key, id)
  }
  const graphs = await loadChildGraphs(scope.workspaceId, [...ids.values()], loaded?.graphs)
  const byKey = new Map<string, StoredGraph>()
  for (const [key, id] of ids) {
    const graph = graphs.get(id)
    if (graph) byKey.set(key, graph)
  }
  return byKey
}

/** The node of each stored workflow `graphs` holds, by key ({@link storedNode}). */
async function storedNodes(
  graphs: ReadonlyMap<string, StoredGraph>,
  scope: ChildResultsScope
): Promise<Map<string, ChildResultNode>> {
  const calledIds = [...graphs.values()].flatMap((graph) =>
    storedChildWorkflowIds(Object.values(graph.graph.blocks))
  )
  const workflowKeys =
    calledIds.length === 0
      ? new Map<string, string>()
      : ((
          await resolveKeys(
            scope.workspaceId,
            calledIds.map((id) => ({ kind: 'workflow' as const, id })),
            { allocate: false }
          )
        ).get('workflow') ?? new Map<string, string>())
  const nodes = new Map<string, ChildResultNode>()
  for (const [key, graph] of graphs) nodes.set(key, storedNode(graph, workflowKeys, scope))
  return nodes
}

/**
 * The fields of each workflow `keys` name and every workflow they reach by calls, by key: read
 * level by level (a submitted folder as submitted, any other as stored), then resolved callees
 * first ({@link resolveChildResults}).
 */
async function readChildResults(
  scope: ChildResultsScope,
  keys: readonly string[],
  loaded: LoadedChildren | undefined
): Promise<Map<string, ChildFields>> {
  const nodes = new Map<string, ChildResultNode | null>()
  let frontier = [...new Set(keys)]
  while (frontier.length > 0) {
    const graphs = await keyedGraphs(frontier, scope, loaded)
    const stored = new Map([...graphs].filter(([key]) => !scope.submitted?.has(key)))
    const read = stored.size > 0 ? await storedNodes(stored, scope) : new Map()
    for (const key of frontier) {
      const source = scope.submitted?.get(key)
      nodes.set(
        key,
        source ? submittedNode(source, graphs.get(key), scope) : (read.get(key) ?? null)
      )
    }
    const next = new Set(frontier.flatMap((key) => nodes.get(key)?.calls ?? []))
    frontier = [...next].filter((key) => !nodes.has(key))
  }
  const present = new Map<string, ChildResultNode>()
  for (const [key, node] of nodes) if (node) present.set(key, node)
  const resolved = resolveChildResults(present)
  return new Map([...nodes.keys()].map((key) => [key, resolved.get(key) ?? null]))
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
 * (one the workspace does not hold, or holds archived, is left out), each typed by the workflows
 * it calls in turn. Each key is read once per `scope.memo`; the workflows a reading reaches
 * through calls are kept there too.
 */
export async function loadChildResults(
  scope: ChildResultsScope,
  keys: readonly string[],
  loaded?: LoadedChildren
): Promise<Map<string, ChildResultFields>> {
  const unread = keys.filter((key) => !scope.memo.has(key))
  if (unread.length > 0) {
    const reading = withCatalogBlockScope(scope.gate, async () => {
      const fields = await readChildResults(scope, unread, loaded)
      for (const [key, value] of fields) {
        if (!scope.memo.has(key)) scope.memo.set(key, Promise.resolve(value))
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
 * {@link loadChildGraphs} (`toId` names the workflow a key resolves to): a child whose graph is
 * there is read from there, any other (a workflow those children call, or a key `toId` does not
 * resolve) as {@link loadChildResults} reads it.
 */
export function loadChildResultsFrom(
  scope: ChildResultsScope,
  keys: readonly string[],
  graphs: StoredGraphs,
  toId: (key: string) => string | null
): Promise<Map<string, ChildResultFields>> {
  return loadChildResults(scope, keys, { graphs, toId })
}
