import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflowBlocks } from '@sim/db/schema'
import {
  type BlockCatalog,
  type CanonicalWorkflow,
  type CanonicalWorkflowMeta,
  canonicalizeUnderLock,
  compileWorkflow,
  type Diagnostic,
  diffCanonical,
  type LockIdentity,
  type MaterializeResult,
  materialize,
  parseWorkflowLock,
  type ResourceKeyResolver,
  type ResourceKind,
  renamesBetween,
  type SourceBase,
  type SourceHints,
  type WorkflowLockBlock,
  type WorkflowLockV1,
  type WorkflowSourceMetaV1,
} from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, inArray, ne } from 'drizzle-orm'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { layoutChangedBlocks } from '@/lib/workflows/application/graph-write'
import { snapshotMcpToolOutputSchemas } from '@/lib/workflows/application/mcp-output-schemas'
import { type SourceDiffSummary, summarizeDiff } from '@/lib/workflows/application/source-diff'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import {
  createLocator,
  hasErrors,
  lintDiagnostics,
  normalizeChangedValues,
} from '@/lib/workflows/application/source-locate'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { gateSourceDiff } from '@/lib/workflows/code/apply/gates'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findLiveTriggerRemovals } from '@/lib/workflows/code/apply/live-triggers'
import { findLockedBlockRefusals } from '@/lib/workflows/code/apply/locked'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import type { StoredSource } from '@/lib/workflows/code/print-stored'
import { loadResourceKeyResolver } from '@/lib/workflows/code/resources'
import { mergeSourceMetaFromLock } from '@/lib/workflows/code/source-lock'
import type { StoredCanonical } from '@/lib/workflows/code/stored-canonical'
import type {
  WorkflowLintReport,
  WorkflowLintTableSchema,
  WorkflowLintUnresolvedReference,
} from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import type { ResourceKeyRef } from '@/lib/workspaces/resource-keys'

const META_FIELDS: Array<keyof CanonicalWorkflowMeta> = ['name', 'description']

export interface SourceEvaluationInput {
  principal: Principal
  scope: {
    workflowId: string
    workspaceId: string
    workspaceOrganizationId: string | null
    /** The human the write is performed as, for gates, permission groups and lint. */
    subjectUserId: string
  }
  /** The draft the source applies to; an empty graph for a workflow the apply creates. */
  stored: StoredSource
  /** `stored` canonicalized with its resource keys. */
  storedCanonical: StoredCanonical
  storedSourceMeta: WorkflowSourceMetaV1 | null
  catalog: BlockCatalog
  /** Env names the subject's runs resolve, for `env('…')` checks. */
  envNames: ReadonlySet<string>
  /** Attribution for resource keys a submitted reference allocates. */
  createdBy: string | null
  files: Record<string, string>
  lock: WorkflowLockV1
  /** Where and when the source was read, its fingerprint already matched; absent for a create. */
  base?: SourceBase
  /** Set when the apply creates the workflow: the caller's name and description overrides. */
  create?: { name?: string; description?: string | null }
  /**
   * Resources a workspace source apply creates or adopts before this workflow, by key, each with
   * a stand-in id: consulted after the stored keys, so a dry run of a workflow that names a table
   * created in the same apply resolves instead of failing `E_MAT_UNKNOWN_RESOURCE`.
   */
  pendingResources?: readonly PendingResource[]
}

/** A resource an enclosing apply creates or adopts, by key, with the id that stands in for it. */
export interface PendingResource {
  kind: ResourceKind
  key: string
  id: string
  /** The name the apply writes it under, which a workflow's stored reference repeats (a skill). */
  name?: string
  /**
   * A table's declared column names, which the lint checks a row write against instead of the
   * stored schema the apply has yet to change.
   */
  columns?: readonly string[]
}

/** The schemas `pending` declares for its tables, by id, for the lint's table checks. */
function declaredTableSchemas(
  pending: readonly PendingResource[]
): Map<string, WorkflowLintTableSchema> {
  const schemas = new Map<string, WorkflowLintTableSchema>()
  for (const entry of pending) {
    if (entry.kind !== 'table' || !entry.columns) continue
    schemas.set(entry.id, { name: entry.name ?? entry.key, columnNames: entry.columns })
  }
  return schemas
}

/** `resources`, falling back to `pending` for a key, id or name it does not resolve. */
function withPendingResources(
  resources: ResourceKeyResolver,
  pending: readonly PendingResource[]
): ResourceKeyResolver {
  if (pending.length === 0) return resources
  const byId = (kind: ResourceKind, id: string) =>
    pending.find((entry) => entry.kind === kind && entry.id === id)
  return {
    toKey: (kind, id) => resources.toKey(kind, id) ?? byId(kind, id)?.key ?? null,
    toId: (kind, key) =>
      resources.toId(kind, key) ??
      pending.find((entry) => entry.kind === kind && entry.key === key)?.id ??
      null,
    nameOf: (kind, id) => resources.nameOf?.(kind, id) ?? byId(kind, id)?.name ?? null,
    isBuiltin: resources.isBuiltin,
  }
}

/** Unresolved reference kinds whose ids an enclosing apply may create. */
const PENDABLE_REFERENCES: ReadonlySet<WorkflowLintUnresolvedReference['kind']> = new Set([
  'resource',
  'custom-tool',
  'skill',
])

/**
 * `lint` without the unresolved resource references that name only ids an enclosing apply has yet
 * to write: a dry run of a directory that adds a skill and the workflow using it is not a warning.
 */
function withoutPendingReferences(
  lint: WorkflowLintReport,
  pending: readonly PendingResource[]
): WorkflowLintReport {
  if (pending.length === 0) return lint
  const pendingIds = new Set(pending.map((entry) => entry.id))
  const awaitsPending = (value: unknown) => {
    const ids = typeof value === 'string' ? value.split(',').map((id) => id.trim()) : value
    return (
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => typeof id === 'string' && pendingIds.has(id))
    )
  }
  return {
    ...lint,
    unresolvedReferences: lint.unresolvedReferences.filter(
      (reference) => !PENDABLE_REFERENCES.has(reference.kind) || !awaitsPending(reference.value)
    ),
  }
}

/** Everything a commit (or a dry run) writes and reports, once every check passed. */
export interface SourcePlan {
  /** The workflow's name and description: the stored ones, or a created workflow's. */
  meta: CanonicalWorkflowMeta
  /** The graph is unchanged; only source meta may differ. Never true for a create. */
  noop: boolean
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  /** The variables to write, or `undefined` when the source leaves them unchanged. */
  variables: ReturnType<typeof normalizeWorkflowVariables> | undefined
  /** Variables as the next read parses them, for re-printing what is stored. */
  storedVariables: WorkflowState['variables']
  /** Warnings (on a dry run, every finding), pinned to the submitted files. */
  diagnostics: WorkflowSourceDiagnostic[]
  /** Non-fatal notes about the write. */
  notes: string[]
  diff: SourceDiffSummary
  /** Source key → id for every new block whose id was minted rather than taken from the lock. */
  mintedIds: Record<string, string>
  /** Every key the write binds, with its id: what the next print is keyed by. */
  identity: LockIdentity
  /** The post-materialize lock the compiled idents and comments are re-keyed onto. */
  lock: WorkflowLockV1
  /** The compiled file's idents, order and comments. */
  compiled: { hints: SourceHints; workflow: Pick<CanonicalWorkflow, 'annotations'> }
  /** source meta after the write, merged onto the stored one. */
  sourceMeta: WorkflowSourceMetaV1
  /** How the response prints function code: as the submission did. */
  functionCode: 'inline' | 'files'
  /** Answers every resource reference of both the stored and the submitted source. */
  resources: ResourceKeyResolver
  /** Every resource the submitted source names by key, as the compiler read it. */
  references: ResourceKeyRef[]
}

export type SourceEvaluation = { refused: WorkflowSourceDiagnostic[] } | { plan: SourcePlan }

/** Every `(kind, key)` resource reference in a compiled model, for ident lookup. */
function collectResourceKeys(value: unknown, refs: ResourceKeyRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectResourceKeys(item, refs)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (
    record.$sim === 'resource' &&
    typeof record.kind === 'string' &&
    typeof record.key === 'string'
  ) {
    refs.push({ kind: record.kind as ResourceKind, key: record.key })
  }
  for (const nested of Object.values(record)) collectResourceKeys(nested, refs)
}

/** Block ids another workflow already stores, among `ids`. */
async function findBlockIdsClaimedElsewhere(workflowId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(inArray(workflowBlocks.id, ids), ne(workflowBlocks.workflowId, workflowId)))
  return rows.map((row) => row.id)
}

/**
 * The post-materialize lock `mergeSourceMetaFromLock` re-keys onto: every bound key with its id,
 * and the submitted lock's ident and order for a block the file does not state them for.
 */
function boundLock(identity: LockIdentity, submitted: WorkflowLockV1): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    const previous = Object.hasOwn(submitted.blocks, key) ? submitted.blocks[key] : undefined
    blocks[key] = { ...block, ident: previous?.ident ?? key, order: previous?.order ?? 0 }
  }
  return { version: 1, blocks, variables: identity.variables }
}

/**
 * Evaluates submitted source against a stored draft without writing it: compile against the live
 * catalog, parse the lock, materialize onto the stored graph (keeping every unchanged value's
 * stored bytes and every id the lock binds), then every gate (locked blocks, engine gates,
 * types that may stay but not be added), the value checks and lint. Returns the refusals, located
 * in the submitted text, or the plan the write stores.
 */
export async function evaluateSource(input: SourceEvaluationInput): Promise<SourceEvaluation> {
  const { principal, scope, catalog, files } = input
  const isNew = input.create !== undefined

  const parsedLock = parseWorkflowLock(input.lock)
  if (parsedLock.diagnostics) {
    return { refused: parsedLock.diagnostics.map(createLocator(files, {}, new Map())) }
  }
  const lock = parsedLock.lock

  const { state } = input.stored
  let resources = input.storedCanonical.resources
  let meta = input.stored.meta
  /**
   * The stored graph as the submitted lock reads it: what `stored()` keeps values from, what
   * materialize matches against, and what the diff compares the compiled source against.
   */
  const storedCanonical = canonicalizeUnderLock(
    state,
    { catalog, meta, resources },
    input.storedCanonical.canonical,
    lock
  )
  const compiled = compileWorkflow({
    entry: { path: SOURCE_ENTRY_FILE, text: files[SOURCE_ENTRY_FILE] },
    files: new Map(Object.entries(files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set([
      ...Object.keys(lock.blocks),
      ...Object.keys(storedCanonical.identity.blocks),
    ]),
    stored: storedCanonical.workflow,
    envNames: input.envNames,
  })
  const compiledWorkflow = compiled.workflow
  if (!compiledWorkflow || hasErrors(compiled.diagnostics)) {
    const refused: Diagnostic[] = [...compiled.diagnostics]
    if (input.base && input.base.catalogHash !== catalog.hash) {
      refused.push({
        code: 'W_APPLY_CATALOG_MOVED',
        severity: 'warning',
        message:
          'The block catalog changed since this source was read, which can explain these errors.',
        hint: 'Get the source again to print it against the current catalog, then reapply your edit.',
      })
    }
    return { refused: refused.map(createLocator(files, compiled.spans, new Map())) }
  }

  if (input.create) {
    meta = {
      name: input.create.name ?? compiledWorkflow.meta.name,
      description:
        input.create.description !== undefined
          ? input.create.description
          : compiledWorkflow.meta.description,
    }
  }

  const compiledKeys: ResourceKeyRef[] = []
  collectResourceKeys(compiledWorkflow.blocks, compiledKeys)
  const storedResources = resources
  const newKeys = compiledKeys.filter(({ kind, key }) => storedResources.toId(kind, key) === null)
  if (newKeys.length > 0) {
    const extra = await loadResourceKeyResolver(
      scope.workspaceId,
      { keys: newKeys },
      { actorUserId: input.createdBy }
    )
    resources = {
      toKey: (kind, id) => storedResources.toKey(kind, id) ?? extra.toKey(kind, id),
      toId: (kind, key) => storedResources.toId(kind, key) ?? extra.toId(kind, key),
      nameOf: (kind, id) => storedResources.nameOf?.(kind, id) ?? extra.nameOf?.(kind, id) ?? null,
      isBuiltin: storedResources.isBuiltin,
    }
  }

  resources = withPendingResources(resources, input.pendingResources ?? [])

  const hasLockEntries =
    Object.keys(lock.blocks).length > 0 || Object.keys(lock.variables).length > 0
  const lockFreshness: 'fresh' | 'stale' | 'none' = !hasLockEntries
    ? 'none'
    : input.base && input.base.workspaceId !== scope.workspaceId
      ? 'stale'
      : 'fresh'
  const compiledIdents: Record<string, string> = {}
  for (const [key, hint] of Object.entries(compiled.hints.blocks)) {
    if (hint.ident !== undefined) compiledIdents[key] = hint.ident
  }
  const hooks = createMaterializeHooks()
  const materializeWith = (withLock: WorkflowLockV1): MaterializeResult =>
    materialize(compiledWorkflow, withLock, {
      catalog,
      hooks,
      prev: state,
      prevCanonical: storedCanonical,
      resources,
      compiledIdents,
      lockFreshness,
    })

  /**
   * A lock id for a new block that another workflow already stores cannot be reused (block ids
   * are global keys): drop it from the lock so materialize mints one, and say so.
   */
  let materialized = materializeWith(lock)
  const claimedDiagnostics: Diagnostic[] = []
  const lockSuppliedIds = materialized.entries.flatMap((entry) =>
    entry.status === 'created' && entry.idSource === 'lock' ? [entry.id] : []
  )
  const [claimedIds, permissionConfig] = await Promise.all([
    findBlockIdsClaimedElsewhere(scope.workflowId, lockSuppliedIds),
    resolvePermissionGroupConfig(
      scope.subjectUserId,
      scope.workspaceId,
      scope.workspaceOrganizationId
    ),
  ])
  const claimed = new Set(claimedIds)
  if (claimed.size > 0) {
    const blocks: Record<string, WorkflowLockBlock> = {}
    for (const [key, entry] of Object.entries(lock.blocks)) {
      if (claimed.has(entry.id)) {
        claimedDiagnostics.push({
          code: 'W_MAT_LOCK_ID_CLAIMED',
          severity: 'warning',
          message: `The lock id for block "${key}" belongs to another workflow; a new id was minted`,
          blockKey: key,
        })
      } else {
        blocks[key] = entry
      }
    }
    materialized = materializeWith({ ...lock, blocks })
  }

  const idByKey = new Map(
    Object.entries(materialized.identity.blocks).map(([key, block]) => [key, block.id])
  )
  const keyById = new Map([...idByKey].map(([key, id]) => [id, key]))
  const storedKeyById = new Map(
    Object.entries(storedCanonical.identity.blocks).map(([key, block]) => [block.id, key])
  )
  /** A block's source key: the one this write binds, else the stored one for a removed block. */
  const keyOf = (id: string) => keyById.get(id) ?? storedKeyById.get(id)
  const locate = createLocator(files, compiled.spans, idByKey)
  const materializeDiagnostics = [...materialized.diagnostics, ...claimedDiagnostics]
  if (hasErrors(materializeDiagnostics)) {
    return { refused: [...compiled.diagnostics, ...materializeDiagnostics].map(locate) }
  }

  /** The source's name and description never change a stored workflow, so they are not diffed. */
  const ignoredMeta = isNew
    ? []
    : META_FIELDS.filter((field) => compiledWorkflow.meta[field] !== meta[field])
  /**
   * What the write stores against what is stored: the materialized CWM, not the compiled one,
   * so a field source never prints (a forEach loop's empty while condition, a pair's stored
   * member) that materialize keeps from the stored block is no change.
   */
  const canonicalDiff = diffCanonical(
    storedCanonical.workflow,
    { ...materialized.workflow, meta: storedCanonical.workflow.meta },
    renamesBetween(storedCanonical.identity, materialized.identity)
  )
  const notes: string[] = []
  if (ignoredMeta.length > 0) {
    notes.push(
      `The workflow ${ignoredMeta.join(' and ')} in the source differs from the stored one and was not changed; rename or describe the workflow through its settings.`
    )
  }

  const storedGraph: SourceGraph = { blocks: state.blocks, edges: state.edges }
  let blocks = materialized.state.blocks
  const edges = materialized.state.edges
  const graphDiff = diffGraphs(storedGraph, { blocks, edges })

  const typeChanged = graphDiff.modified.filter((change) => change.typeChanged).map((c) => c.id)
  const [gateDiagnostics, liveTriggerRefusals] = await Promise.all([
    gateSourceDiff({
      base: storedGraph,
      target: { blocks, edges },
      diff: graphDiff,
      catalog,
      keyOf,
      permissionConfig,
      subjectUserId: scope.subjectUserId,
      workspaceId: scope.workspaceId,
      isCopilot: principal.kind === 'delegated' && principal.serviceId === 'copilot',
    }),
    findLiveTriggerRemovals(
      scope.workflowId,
      [...graphDiff.removed, ...typeChanged].map((id) => state.blocks[id]),
      keyOf
    ),
  ])
  const refusals: Diagnostic[] = [
    ...findLockedBlockRefusals(storedGraph, { blocks, edges }, graphDiff, keyOf),
    ...gateDiagnostics,
    ...liveTriggerRefusals,
  ]

  for (const diagnostic of gateDiagnostics) {
    if (diagnostic.code !== 'W_APPLY_HOSTED_KEY_DROPPED' || !diagnostic.blockId) continue
    const { blockId, param } = diagnostic
    const block = blocks[blockId]
    if (!param || !block?.subBlocks?.[param]) continue
    blocks = {
      ...blocks,
      [blockId]: {
        ...block,
        subBlocks: { ...block.subBlocks, [param]: { ...block.subBlocks[param], value: null } },
      },
    }
  }

  const normalized = normalizeChangedValues(blocks, graphDiff, (id) => keyById.get(id) ?? '')
  blocks = await snapshotMcpToolOutputSchemas(normalized.blocks, state.blocks, {
    principal,
    workspaceId: scope.workspaceId,
  })
  if (materialized.needsLayout.length > 0) {
    blocks = layoutChangedBlocks(scope.workflowId, storedGraph, { blocks, edges })
  }

  const lint = await buildWorkflowLintReport(
    { blocks, edges },
    {
      workflowId: scope.workflowId,
      workspaceId: scope.workspaceId,
      subjectUserId: scope.subjectUserId,
    },
    { declaredTables: declaredTableSchemas(input.pendingResources ?? []) }
  )
  const changedIds = new Set([...graphDiff.added, ...graphDiff.modified.map((m) => m.id)])
  const diagnostics = [
    ...compiled.diagnostics,
    ...materializeDiagnostics,
    ...refusals,
    ...normalized.diagnostics,
    ...lintDiagnostics(
      withoutPendingReferences(lint, input.pendingResources ?? []),
      changedIds,
      (id) => keyById.get(id)
    ),
  ].map(locate)
  if (hasErrors(diagnostics)) return { refused: diagnostics }

  const noop = !isNew && canonicalDiff.noop
  const mintedIds: Record<string, string> = {}
  for (const entry of materialized.entries) {
    if (entry.status === 'created' && entry.idSource === 'minted') mintedIds[entry.key] = entry.id
  }
  const { added, removed, modified } = canonicalDiff.variables
  const variables =
    added.length > 0 || removed.length > 0 || modified.length > 0
      ? normalizeWorkflowVariables(materialized.state.variables ?? {}, { coerceValues: true })
      : undefined
  const compiledSource = { hints: compiled.hints, workflow: compiledWorkflow }
  const lockAfter = boundLock(materialized.identity, lock)

  return {
    plan: {
      meta,
      noop,
      blocks,
      edges,
      variables,
      storedVariables:
        variables === undefined ? state.variables : (parseWorkflowVariables(variables) ?? {}),
      diagnostics,
      notes,
      diff: summarizeDiff(canonicalDiff, storedCanonical.identity, materialized.identity, noop),
      mintedIds,
      identity: materialized.identity,
      lock: lockAfter,
      compiled: compiledSource,
      sourceMeta: mergeSourceMetaFromLock(input.storedSourceMeta, lockAfter, compiledSource),
      functionCode: Object.values(compiled.hints.blocks).some((hint) => hint.codeFile)
        ? 'files'
        : 'inline',
      resources,
      references: compiledKeys,
    },
  }
}
