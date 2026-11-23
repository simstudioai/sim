import type {
  Diagnostic,
  LocatedDiagnostic,
  LockIdentity,
  WorkflowLockBlock,
  WorkflowLockV1,
} from '@sim/workflow-code'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import type { WorkspaceKind } from '@sim/workspace-code'
import { layoutChangedBlocks } from '@/lib/workflows/application/graph-write'
import { snapshotMcpToolOutputSchemas } from '@/lib/workflows/application/mcp-output-schemas'
import { summarizeDiff } from '@/lib/workflows/application/source-diff'
import {
  hasErrors,
  lintDiagnostics,
  normalizeChangedValues,
} from '@/lib/workflows/application/source-locate'
import type { CompiledSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/compile'
import type { GatedGraph } from '@/lib/workflows/application/source-pipeline/evaluate/gates'
import {
  editedCompileFindings,
  type SourceRefusals,
} from '@/lib/workflows/application/source-pipeline/evaluate/refusals'
import type { ResolvedSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/resolve'
import type {
  PendingResource,
  SourceEvaluation,
  SourceEvaluationInput,
} from '@/lib/workflows/application/source-pipeline/evaluate/types'
import { foreignResourceRefusals } from '@/lib/workflows/application/source-resource-scope'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { changedSubBlockFields } from '@/lib/workflows/code/apply/gates'
import { mergeSourceMetaFromLock } from '@/lib/workflows/code/source-lock'
import type {
  WorkflowLintReport,
  WorkflowLintTableSchema,
  WorkflowLintUnresolvedReference,
} from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'

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

/**
 * The lint reference kind an unresolved id of each workspace source kind reports as, or `null` for
 * a kind no workflow names by id (a secret, read by name; a deployment, which nothing references).
 * Every kind an enclosing apply can create or bind is listed, so a new one fails to compile until
 * it is mapped.
 */
const PENDABLE_REFERENCE_OF: Record<WorkspaceKind, WorkflowLintUnresolvedReference['kind'] | null> =
  {
    secret: null,
    credential: 'credential',
    'custom-tool': 'custom-tool',
    skill: 'skill',
    table: 'resource',
    'knowledge-base': 'resource',
    file: 'resource',
    workflow: 'resource',
    'mcp-server': 'mcp-tool',
    deployment: null,
  }

/** Unresolved reference kinds whose ids an enclosing apply may create. */
const PENDABLE_REFERENCES: ReadonlySet<WorkflowLintUnresolvedReference['kind']> = new Set(
  Object.values(PENDABLE_REFERENCE_OF).filter((kind) => kind !== null)
)

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

/**
 * `lint` without the block-output findings compile already reported at their source line, so a
 * dangling reference is one finding, as an offline check reports it: on a block whose
 * `workflow.ts` reads a path no output has (`W_UNKNOWN_OUTPUT_PATH`, or its refusal), every
 * block-output finding; on a block whose code file `$ref` names nothing (`W_UNRESOLVED_REF`, or
 * its refusal), the one on its code.
 */
function withoutCompiledReferences(
  lint: WorkflowLintReport,
  compiled: readonly LocatedDiagnostic[],
  keyOf: (id: string) => string | undefined
): WorkflowLintReport {
  const inEntry = new Set<string>()
  const inCode = new Set<string>()
  for (const { code, blockKey, span } of compiled) {
    if (blockKey === undefined) continue
    if (span.file === SOURCE_ENTRY_FILE) {
      if (code === 'W_UNKNOWN_OUTPUT_PATH' || code === 'E_APPLY_UNRESOLVED_REF')
        inEntry.add(blockKey)
    } else if (code === 'W_UNRESOLVED_REF' || code === 'E_APPLY_UNRESOLVED_REF') {
      inCode.add(blockKey)
    }
  }
  if (inEntry.size === 0 && inCode.size === 0) return lint
  return {
    ...lint,
    unresolvedReferences: lint.unresolvedReferences.filter((reference) => {
      const key = keyOf(reference.blockId)
      if (reference.kind !== 'block-output' || key === undefined) return true
      return !inEntry.has(key) && !(reference.field === 'code' && inCode.has(key))
    }),
  }
}

/**
 * Refusals the compile makes at the source line, with its own wording and hint, that a server gate
 * makes again for the same block: a field value (`E_APPLY_INVALID_SUBBLOCK_FIELD`, per field), and
 * a block type the workspace cannot place (per block).
 */
const COMPILED_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'E_APPLY_INVALID_SUBBLOCK_FIELD',
  'E_APPLY_INVALID_BLOCK_TYPE',
  'E_APPLY_TYPE_NOT_ADDABLE',
])

function refusalKey(code: string, blockKey: string, param: string | undefined): string {
  const field = code === 'E_APPLY_INVALID_SUBBLOCK_FIELD' ? (param ?? '') : ''
  return `${code}\u0000${blockKey}\u0000${field}`
}

/**
 * `findings` without the refusals that repeat one already made, so one mistake is one error: a
 * {@link COMPILED_REFUSAL_CODES} refusal the compile made for the same block (and field), and the
 * state check's `E_APPLY_INVALID_STATE` on a block whose type is refused as unregistered, which
 * says only that again.
 */
function withoutRepeatedRefusals(
  findings: readonly Diagnostic[],
  compiled: readonly LocatedDiagnostic[],
  keyOf: (id: string) => string | undefined
): Diagnostic[] {
  const blockKeyOf = (finding: Diagnostic) =>
    finding.blockKey ?? (finding.blockId === undefined ? undefined : keyOf(finding.blockId))
  const compiledRefusals = new Set(
    compiled.flatMap((finding) =>
      COMPILED_REFUSAL_CODES.has(finding.code) && finding.blockKey !== undefined
        ? [refusalKey(finding.code, finding.blockKey, finding.param)]
        : []
    )
  )
  const unregistered = new Set(
    [...compiled, ...findings].flatMap((finding) =>
      finding.code === 'E_APPLY_INVALID_BLOCK_TYPE' ? (blockKeyOf(finding) ?? []) : []
    )
  )
  return findings.filter((finding) => {
    const blockKey = blockKeyOf(finding)
    if (finding.code === 'E_APPLY_INVALID_STATE') {
      return blockKey === undefined || !unregistered.has(blockKey)
    }
    return (
      !COMPILED_REFUSAL_CODES.has(finding.code) ||
      blockKey === undefined ||
      !compiledRefusals.has(refusalKey(finding.code, blockKey, finding.param))
    )
  })
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
 * Normalizes the changed values, snapshots MCP tool output schemas, lays out new blocks, lints the
 * graph, refuses ids of another workspace's resources, and gathers every finding pinned to the
 * submitted files. Refuses on any error; otherwise assembles the plan the write stores.
 */
export async function finalizePlan(
  input: SourceEvaluationInput,
  submission: CompiledSubmission,
  resolved: ResolvedSubmission,
  refusals: SourceRefusals,
  gated: GatedGraph
): Promise<SourceEvaluation> {
  const { principal, scope } = input
  const { state } = input.stored
  const isNew = input.create !== undefined
  const { lock, compiled, compiledWorkflow } = submission
  const { materialized, keyById, locate, compiledKeys } = resolved
  const { canonicalDiff, metaChanged, meta } = refusals
  const { storedGraph, graphDiff, edges } = gated
  const pending = input.pendingResources ?? []

  const normalized = normalizeChangedValues(gated.blocks, graphDiff, (id) => keyById.get(id) ?? '')
  let blocks = await snapshotMcpToolOutputSchemas(normalized.blocks, state.blocks, {
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
    { declaredTables: declaredTableSchemas(pending), iterationScope: false }
  )
  const changedIds = new Set([...graphDiff.added, ...graphDiff.modified.map((m) => m.id)])
  const changedKeys = new Set([...changedIds].flatMap((id) => keyById.get(id) ?? []))
  const keyOfId = (id: string) => keyById.get(id)
  const changedFields = new Map(
    [...changedSubBlockFields(storedGraph, { blocks: gated.blocks, edges }, graphDiff)].flatMap(
      ([id, fields]) => {
        const key = keyById.get(id)
        return key === undefined ? [] : [[key, fields] as const]
      }
    )
  )
  const compileDiagnostics = editedCompileFindings(refusals, changedKeys, changedFields)
  const compiledLint = withoutCompiledReferences(
    withoutPendingReferences(lint, pending),
    compileDiagnostics,
    keyOfId
  )
  const foreignIds = await foreignResourceRefusals({
    blocks,
    diff: graphDiff,
    workspaceId: scope.workspaceId,
    pending,
    keyOf: keyOfId,
  })
  const serverFindings = [
    ...resolved.keptDiagnostics,
    ...resolved.materializeDiagnostics,
    ...refusals.sourceRefusals,
    ...refusals.renameWarnings,
    ...gated.gateFindings,
    ...normalized.diagnostics,
    ...foreignIds,
    ...lintDiagnostics(compiledLint, changedIds, keyOfId),
  ]
  const diagnostics = [
    ...compileDiagnostics,
    ...withoutRepeatedRefusals(serverFindings, compileDiagnostics, keyOfId),
  ].map(locate)
  if (hasErrors(diagnostics)) {
    return {
      refused: diagnostics,
      compiledReferences: { references: compiledKeys, envReferences: compiled.envReferences },
    }
  }

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
      diff: summarizeDiff(
        canonicalDiff,
        resolved.storedCanonical,
        { workflow: materialized.workflow, identity: materialized.identity },
        noop,
        metaChanged
      ),
      metaChanged,
      mintedIds,
      identity: materialized.identity,
      lock: lockAfter,
      compiled: compiledSource,
      sourceMeta: mergeSourceMetaFromLock(input.storedSourceMeta, lockAfter, compiledSource),
      functionCode: Object.values(compiled.hints.blocks).some((hint) => hint.codeFile)
        ? 'files'
        : 'inline',
      resources: resolved.resources,
      references: compiledKeys,
      envReferences: compiled.envReferences,
    },
  }
}
