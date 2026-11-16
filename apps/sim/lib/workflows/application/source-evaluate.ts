import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflowBlocks } from '@sim/db/schema'
import {
  type BlockCatalog,
  type CanonicalWorkflow,
  type CanonicalWorkflowMeta,
  canonicalize,
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
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, inArray, ne } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { layoutChangedBlocks } from '@/lib/workflows/application/graph-write'
import { snapshotMcpToolOutputSchemas } from '@/lib/workflows/application/mcp-output-schemas'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import {
  createLocator,
  hasErrors,
  lintDiagnostics,
  normalizeChangedValues,
  type SourceDiffSummary,
  summarizeDiff,
} from '@/lib/workflows/application/source-locate'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { gateSourceDiff } from '@/lib/workflows/code/apply/gates'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findLiveTriggerRemovals } from '@/lib/workflows/code/apply/live-triggers'
import { findLockedBlockRefusals } from '@/lib/workflows/code/apply/locked'
import { boundLock, type StoredSource } from '@/lib/workflows/code/apply/print'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { loadResourceKeyResolver } from '@/lib/workflows/code/resources'
import { mergeSourceMetaFromLock } from '@/lib/workflows/code/source-lock'
import { canonicalizeUnderLock, type StoredCanonical } from '@/lib/workflows/code/stored-canonical'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import type { ResourceKeyRef } from '@/lib/workspaces/resource-keys'

/** The entry file every submission carries; function code lives beside it. */
const ENTRY_FILE = 'workflow.ts'
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
  storedFingerprint: string
  storedSourceMeta: WorkflowSourceMetaV1 | null
  catalog: BlockCatalog
  /** Attribution for resource keys a submitted reference allocates. */
  createdBy: string | null
  files: Record<string, string>
  lock: WorkflowLockV1
  /** Where and when the source was read; absent for a create. */
  base?: SourceBase
  /** Set when the apply creates the workflow: the caller's name and description overrides. */
  create?: { name?: string; description?: string | null }
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

  const entryText = files[ENTRY_FILE]
  if (entryText === undefined) {
    throw new OrchestrationError('validation', `files must include ${ENTRY_FILE}`)
  }
  const storedIdentity = input.storedCanonical.canonical.identity
  const compiled = compileWorkflow({
    entry: { path: ENTRY_FILE, text: entryText },
    files: new Map(Object.entries(files).filter(([path]) => path !== ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set([...Object.keys(lock.blocks), ...Object.keys(storedIdentity.blocks)]),
    stored: input.storedCanonical.canonical.workflow,
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

  const { state } = input.stored
  let resources = input.storedCanonical.resources
  let storedCanonical = input.storedCanonical.canonical
  let meta = input.stored.meta
  if (input.create) {
    meta = {
      name: input.create.name ?? compiledWorkflow.meta.name,
      description:
        input.create.description !== undefined
          ? input.create.description
          : compiledWorkflow.meta.description,
    }
    storedCanonical = canonicalize(state, { catalog, meta, resources })
  }

  const compiledKeys: ResourceKeyRef[] = []
  collectResourceKeys(compiledWorkflow.blocks, compiledKeys)
  const storedResources = resources
  if (compiledKeys.some(({ kind, key }) => storedResources.toId(kind, key) === null)) {
    const { loaded } = input.storedCanonical
    resources = await loadResourceKeyResolver(
      scope.workspaceId,
      { ids: loaded.ids, keys: [...loaded.keys, ...compiledKeys] },
      { createdBy: input.createdBy }
    )
  }

  const hasLockEntries =
    Object.keys(lock.blocks).length > 0 || Object.keys(lock.variables).length > 0
  const lockFreshness: 'fresh' | 'stale' | 'none' = !hasLockEntries
    ? 'none'
    : input.base &&
        (input.base.workspaceId !== scope.workspaceId ||
          input.base.fingerprint !== input.storedFingerprint)
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
  const claimed = new Set(await findBlockIdsClaimedElsewhere(scope.workflowId, lockSuppliedIds))
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
  const keyOf = (id: string) => keyById.get(id) ?? ''
  const locate = createLocator(files, compiled.spans, idByKey)
  const materializeDiagnostics = [...materialized.diagnostics, ...claimedDiagnostics]
  if (hasErrors(materializeDiagnostics)) {
    return { refused: [...compiled.diagnostics, ...materializeDiagnostics].map(locate) }
  }

  const baseCanonical = canonicalizeUnderLock(
    state,
    { catalog, meta, resources },
    storedCanonical,
    lock
  )
  /** The source's name and description never change a stored workflow, so they are not diffed. */
  const ignoredMeta = isNew
    ? []
    : META_FIELDS.filter((field) => compiledWorkflow.meta[field] !== meta[field])
  const canonicalDiff = diffCanonical(
    baseCanonical.workflow,
    { ...compiledWorkflow, meta: baseCanonical.workflow.meta },
    renamesBetween(baseCanonical.identity, materialized.identity)
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

  const permissionConfig = await resolvePermissionGroupConfig(
    scope.subjectUserId,
    scope.workspaceId,
    scope.workspaceOrganizationId
  )
  const gateDiagnostics = await gateSourceDiff({
    base: storedGraph,
    target: { blocks, edges },
    diff: graphDiff,
    permissionConfig,
    subjectUserId: scope.subjectUserId,
    workspaceId: scope.workspaceId,
    isCopilot: principal.kind === 'delegated' && principal.serviceId === 'copilot',
  })
  const typeChanged = graphDiff.modified.filter((change) => change.typeChanged).map((c) => c.id)
  const refusals: Diagnostic[] = [
    ...findLockedBlockRefusals(storedGraph, { blocks, edges }, graphDiff),
    ...gateDiagnostics,
    ...(await findLiveTriggerRemovals(
      scope.workflowId,
      [...graphDiff.removed, ...typeChanged].map((id) => state.blocks[id])
    )),
  ]

  for (const id of [...graphDiff.added, ...typeChanged]) {
    const block = blocks[id]
    if (block && catalogBlock(catalog, block.type)?.addable === false) {
      refusals.push({
        code: 'E_APPLY_TYPE_NOT_ADDABLE',
        severity: 'error',
        message: `Block type "${block.type}" can stay where it is already used but cannot be added`,
        blockId: id,
        blockKey: keyOf(id),
      })
    }
  }

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

  const normalized = normalizeChangedValues(blocks, graphDiff, keyOf)
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
    }
  )
  const changedIds = new Set([...graphDiff.added, ...graphDiff.modified.map((m) => m.id)])
  const diagnostics = [
    ...compiled.diagnostics,
    ...materializeDiagnostics,
    ...refusals,
    ...normalized.diagnostics,
    ...lintDiagnostics(lint, changedIds, (id) => keyById.get(id)),
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
      diff: summarizeDiff(canonicalDiff, baseCanonical.identity, materialized.identity, noop),
      mintedIds,
      identity: materialized.identity,
      lock: lockAfter,
      compiled: compiledSource,
      sourceMeta: mergeSourceMetaFromLock(input.storedSourceMeta, lockAfter, compiledSource),
      functionCode: Object.values(compiled.hints.blocks).some((hint) => hint.codeFile)
        ? 'files'
        : 'inline',
      resources,
    },
  }
}
