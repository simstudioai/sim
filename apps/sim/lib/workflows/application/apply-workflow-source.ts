import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflowBlocks, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { omit } from '@sim/utils/object'
import {
  type AnchorKey,
  type BlockCatalog,
  type CanonicalDiff,
  type CanonicalWorkflow,
  type CanonicalWorkflowMeta,
  type CompileResult,
  canonicalize,
  codeFrame,
  compileWorkflow,
  type Diagnostic,
  diffCanonical,
  encodeAnchor,
  type LockBase,
  type LockIdentity,
  type MaterializeResult,
  materialize,
  parseWorkflowLock,
  printWorkflow,
  type ResourceKeyResolver,
  type ResourceKind,
  renamesBetween,
  type SourceSpan,
  sourceFingerprint,
  type WorkflowLockBlock,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { evaluateSubBlockCondition } from '@sim/workflow-code/catalog/canonical-index'
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { assembleLock } from '@/lib/workflows/application/get-workflow-source'
import { layoutChangedBlocks } from '@/lib/workflows/application/graph-write'
import { snapshotMcpToolOutputSchemas } from '@/lib/workflows/application/mcp-output-schemas'
import { requireMutableWorkflow } from '@/lib/workflows/application/mutability'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { loadWorkflowGraph } from '@/lib/workflows/application/read-workflow-graph'
import {
  type WorkflowSourceDiagnostic,
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { buildCodeCatalog } from '@/lib/workflows/code/catalog/workspace-catalog'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { createRecordingResolver, loadResourceKeyResolver } from '@/lib/workflows/code/resources'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { validateValueForSubBlockType } from '@/lib/workflows/editing/validation'
import { assertNoWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import {
  assertWorkflowGraphIdsUnclaimed,
  collectWorkflowGraphIds,
  replaceWorkflowNormalizedState,
} from '@/lib/workflows/persistence/replace-normalized-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { gateSourceDiff } from '@/lib/workflows/source/gates'
import { diffGraphs, type GraphDiff, type SourceGraph } from '@/lib/workflows/source/graph-diff'
import {
  assertProtectedBlocksPreserved,
  findProtectedBlockRefusals,
} from '@/lib/workflows/source/protected'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('ApplyWorkflowSource')

/** The entry file every submission carries; function code lives beside it. */
const ENTRY_FILE = 'workflow.ts'
/** Where function code is re-printed when the submission used code files (as `source get` does). */
const FUNCTION_CODE_DIR = 'functions'
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['loop', 'parallel'])

export interface ApplyWorkflowSourceInput {
  workflowId: string
  assertedWorkspaceId?: string
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** The identity lock returned by `source get` (or a previous apply). */
  lock: WorkflowLockV1
  /** The environment facts that came with the lock; a lock read elsewhere is treated as stale. */
  lockBase?: LockBase
  /** The `fingerprint` the source was read at; the apply answers 409 when it no longer matches. */
  baseFingerprint: string
  /** Run the whole pipeline and stop before the write. Never audits or notifies. */
  dryRun?: boolean
  /** `preserve` (default): existing blocks keep stored positions. `lock`: lock layout wins. */
  layout?: 'preserve' | 'lock'
  provenance?: { client: 'cli' | 'copilot' | 'canvas' | 'api'; gitSha?: string; repo?: string }
}

interface SourceBlockRef {
  id: string
  key: string
}

/** What the apply changed (or, on a dry run, would change), by stored id and source key. */
interface SourceDiffSummary {
  noop: boolean
  blocks: {
    added: SourceBlockRef[]
    removed: SourceBlockRef[]
    renamed: Array<{ id: string; from: string; to: string }>
    modified: Array<SourceBlockRef & { fields: string[]; reparented?: boolean }>
  }
  edges: { added: number; removed: number }
  variables: { added: string[]; removed: string[]; modified: string[] }
}

interface ApplyWorkflowSourceResult {
  workflowId: string
  workflowName: string
  workspaceId: string
  dryRun: boolean
  /** True only when a graph was written. */
  applied: boolean
  diff: SourceDiffSummary
  /** Warnings on success; on a dry run, every finding including the errors a commit would refuse. */
  diagnostics: WorkflowSourceDiagnostic[]
  /** The fingerprint of what is (or would be) stored; the next apply's `baseFingerprint`. */
  newFingerprint: string
  /** Re-printed from what is (or would be) stored, so normalized values show in the source. */
  files: Record<string, string>
  lock: WorkflowLockV1
  lockBase: LockBase
  /** Source key → id for every new block whose id was minted rather than taken from the lock. */
  mintedIds: Record<string, string>
  warnings: string[]
  needsRedeployment: boolean
  sdkMajor: number
  catalogVersion: string
}

type AnyDiagnostic = Diagnostic

/** The stored draft as canonicalize reads it, plus the row fields the CWM `meta` carries. */
interface StoredSource {
  state: WorkflowState
  meta: CanonicalWorkflowMeta
}

/**
 * The stored draft through the same loader `source get` reads, so the two compute the same
 * fingerprint. With `tx` (under the row lock) the blocks and the row are re-read in it.
 */
async function loadStoredSource(
  context: ActiveWorkflowApplicationContext,
  tx?: DbOrTx
): Promise<StoredSource> {
  if (!tx) {
    const graph = await loadWorkflowGraph(context)
    return {
      state: {
        blocks: graph.blocks,
        edges: graph.edges,
        loops: graph.loops,
        parallels: graph.parallels,
        variables: graph.variables,
      },
      meta: { name: context.workflow.name, description: context.workflow.description ?? null },
    }
  }
  const [normalized, [row]] = await Promise.all([
    loadWorkflowFromNormalizedTables(context.workflowId, tx),
    tx
      .select({
        name: workflowTable.name,
        description: workflowTable.description,
        variables: workflowTable.variables,
      })
      .from(workflowTable)
      .where(and(eq(workflowTable.id, context.workflowId), isNull(workflowTable.archivedAt)))
      .limit(1),
  ])
  if (!row) throw new OrchestrationError('not_found', 'Workflow not found')
  return {
    state: {
      blocks: (normalized?.blocks ?? {}) as Record<string, BlockState>,
      edges: (normalized?.edges ?? []) as WorkflowState['edges'],
      loops: normalized?.loops ?? {},
      parallels: normalized?.parallels ?? {},
      variables: parseWorkflowVariables(row.variables) ?? {},
    },
    meta: { name: row.name, description: row.description ?? null },
  }
}

/** The `sf1:` fingerprint exactly as `source get` computes it (no lock). */
function fingerprintOf(
  stored: StoredSource,
  catalog: BlockCatalog,
  resources: ResourceKeyResolver
): string {
  const { workflow, identity } = canonicalize(stored.state, {
    catalog,
    meta: stored.meta,
    resources,
  })
  return sourceFingerprint(workflow, identity)
}

/** Every resource kind a compiled model references, so only those tables are read. */
function collectResourceKinds(value: unknown, kinds: Set<ResourceKind>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectResourceKinds(item, kinds)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.$sim === 'resource' && typeof record.kind === 'string') {
    kinds.add(record.kind as ResourceKind)
  }
  for (const nested of Object.values(record)) collectResourceKinds(nested, kinds)
}

/**
 * A lock carrying only identity. `canonicalize` reads a lock's ids and branch keys and nothing
 * else, so the printer-owned fields are placeholders here; the real ones come from the print.
 */
function identityLock(identity: LockIdentity): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    blocks[key] = { ...block, binding: key, order: 0 }
  }
  return { lockVersion: 1, blocks, variables: identity.variables }
}

function spanAnchors(diagnostic: AnyDiagnostic): AnchorKey[] {
  if (!diagnostic.blockKey) return []
  const anchors: AnchorKey[] = []
  if (diagnostic.param) {
    anchors.push(
      encodeAnchor({ kind: 'param', block: diagnostic.blockKey, param: diagnostic.param })
    )
  }
  anchors.push(encodeAnchor({ kind: 'block', block: diagnostic.blockKey }))
  return anchors
}

/**
 * Pins findings to the submitted text. A compile finding already has its span; a server finding
 * (gate, value, lint) is placed on its param, else its block declaration, through the compile
 * span map (s4 step 9).
 */
function createLocator(
  files: Record<string, string>,
  spans: CompileResult['spans'],
  idByKey: ReadonlyMap<string, string>
) {
  return (diagnostic: AnyDiagnostic): WorkflowSourceDiagnostic => {
    let span: SourceSpan | undefined = diagnostic.span
    if (!span) {
      for (const anchor of spanAnchors(diagnostic)) {
        const found = spans[anchor]
        if (found) {
          span = found
          break
        }
      }
    }
    const text = span ? files[span.file] : undefined
    const blockId =
      diagnostic.blockId ?? (diagnostic.blockKey ? idByKey.get(diagnostic.blockKey) : undefined)
    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.hint !== undefined ? { hint: diagnostic.hint } : {}),
      ...(span
        ? {
            file: span.file,
            line: span.line,
            column: span.column,
            endLine: span.endLine,
            endColumn: span.endColumn,
          }
        : {}),
      ...(diagnostic.frame !== undefined
        ? { frame: diagnostic.frame }
        : span && text !== undefined
          ? {
              frame: codeFrame(text, {
                line: span.line,
                column: span.column,
                endLine: span.endLine,
                endColumn: span.endColumn,
              }),
            }
          : {}),
      ...(diagnostic.blockKey !== undefined ? { blockKey: diagnostic.blockKey } : {}),
      ...(blockId !== undefined ? { blockId } : {}),
      ...(diagnostic.param !== undefined ? { param: diagnostic.param } : {}),
      ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
    }
  }
}

function hasErrors(diagnostics: readonly { severity: string }[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
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

function withBlock(
  blocks: Record<string, BlockState>,
  id: string,
  update: (block: BlockState) => BlockState
): Record<string, BlockState> {
  return { ...blocks, [id]: update(blocks[id]) }
}

/** Subblock ids a diff sets on a block: every one for an added block. */
function changedFieldsOf(block: BlockState, diff: GraphDiff): string[] {
  const modified = diff.modified.find((change) => change.id === block.id)
  return modified ? modified.subBlocks : Object.keys(block.subBlocks ?? {})
}

interface NormalizedBlocks {
  blocks: Record<string, BlockState>
  diagnostics: AnyDiagnostic[]
}

/**
 * The replace path's value checks, on the blocks this apply adds or changes (s4 step 7):
 * `validateWorkflowState` with sanitization, then `validateValueForSubBlockType` on each changed,
 * currently visible field. An invalid value refuses the apply; a value either step rewrites is
 * kept rewritten and reported as `W_APPLY_VALUE_NORMALIZED`. Untouched blocks keep their bytes.
 */
function normalizeChangedValues(
  input: Record<string, BlockState>,
  diff: GraphDiff,
  keyOf: (id: string) => string
): NormalizedBlocks {
  let blocks = input
  const diagnostics: AnyDiagnostic[] = []
  const changedIds = [...diff.added, ...diff.modified.map((change) => change.id)]
  for (const id of changedIds) {
    const original = blocks[id]
    if (!original || CONTAINER_TYPES.has(original.type)) continue
    const blockKey = keyOf(id)

    const validation = validateWorkflowState(
      { blocks: { [id]: original }, edges: [], loops: {}, parallels: {} },
      { sanitize: true }
    )
    for (const error of validation.errors) {
      diagnostics.push({
        code: 'E_APPLY_INVALID_STATE',
        severity: 'error',
        message: error,
        blockId: id,
        blockKey,
      })
    }
    const sanitized = validation.sanitizedState?.blocks[id]
    if (sanitized && !isEqual(sanitized, original)) {
      blocks = { ...blocks, [id]: sanitized }
      diagnostics.push({
        code: 'W_APPLY_VALUE_NORMALIZED',
        severity: 'warning',
        message: `Block "${original.name}": ${validation.warnings.join('; ') || 'values were sanitized'}`,
        blockId: id,
        blockKey,
      })
    }

    const block = blocks[id]
    const config = getBlock(block.type)
    if (!config) continue
    const values = buildSubBlockValues(block.subBlocks)
    const visible = new Map(
      config.subBlocks
        .filter((field) => evaluateSubBlockCondition(field.condition, values))
        .map((field) => [field.id, field])
    )
    let subBlocks = block.subBlocks
    for (const fieldId of changedFieldsOf(original, diff)) {
      const field = visible.get(fieldId)
      const stored = subBlocks?.[fieldId]
      if (!field || !stored) continue
      const result = validateValueForSubBlockType(field, stored.value, field.id, block.type, id)
      if (!result.valid) {
        diagnostics.push({
          code: 'E_APPLY_INVALID_SUBBLOCK_FIELD',
          severity: 'error',
          message: result.error?.error ?? `Invalid value for ${field.id}`,
          blockId: id,
          blockKey,
          param: fieldId,
        })
        continue
      }
      if (!isEqual(result.value, stored.value) || stored.type !== field.type) {
        if (!isEqual(result.value, stored.value)) {
          diagnostics.push({
            code: 'W_APPLY_VALUE_NORMALIZED',
            severity: 'warning',
            message: `Block "${block.name}": ${field.id} was normalized to the field's stored form`,
            blockId: id,
            blockKey,
            param: fieldId,
          })
        }
        subBlocks = {
          ...subBlocks,
          [fieldId]: { ...stored, value: result.value, type: field.type },
        }
      }
    }
    if (subBlocks !== block.subBlocks) {
      blocks = withBlock(blocks, id, (current) => ({ ...current, subBlocks }))
    }
  }
  return { blocks, diagnostics }
}

/**
 * Lint findings as source diagnostics. A structural finding (a connection to an invalid target,
 * an invalid branch port, a reference to an output no block provides) on a block this apply adds
 * or changes is blocking (`E_APPLY_LINT`); every other finding, and any finding on a block the
 * apply left alone, is a warning. A canvas can save all of these, so only what the apply itself
 * introduces is refused.
 */
function lintDiagnostics(
  lint: WorkflowLintReport,
  changedIds: ReadonlySet<string>,
  keyOf: (id: string) => string | undefined
): AnyDiagnostic[] {
  const diagnostics: AnyDiagnostic[] = []
  const push = (blocking: boolean, blockId: string, message: string, param?: string) => {
    const blockKey = keyOf(blockId)
    const located = {
      message,
      blockId,
      ...(blockKey !== undefined ? { blockKey } : {}),
      ...(param !== undefined ? { param } : {}),
    }
    diagnostics.push(
      blocking && changedIds.has(blockId)
        ? { code: 'E_APPLY_LINT', severity: 'error', ...located }
        : { code: 'W_APPLY_LINT', severity: 'warning', ...located }
    )
  }
  for (const target of lint.invalidConnectionTargets) {
    push(true, target.sourceBlockId, `Connection to ${target.targetBlockId}: ${target.reason}`)
  }
  for (const port of lint.invalidBranchPorts) {
    push(true, port.blockId, `Branch port ${port.sourceHandle}: ${port.reason}`)
  }
  for (const reference of lint.unresolvedReferences) {
    push(
      reference.kind === 'block-output',
      reference.blockId,
      `${reference.field}: ${reference.reason}`,
      reference.field
    )
  }
  for (const issue of lint.fieldIssues) {
    for (const field of issue.missingRequiredFields) {
      push(false, issue.blockId, `Required field ${field} is empty`, field)
    }
  }
  for (const issue of lint.tableFieldIssues) {
    push(
      false,
      issue.blockId,
      `${issue.field} is not a column of table "${issue.tableName}"`,
      issue.field
    )
  }
  for (const orphan of lint.orphanBlocks) {
    push(false, orphan.blockId, 'Block has no incoming connection')
  }
  for (const port of lint.emptyOutgoingPorts) {
    push(false, port.blockId, `Port ${port.label} has no connection`)
  }
  if (lint.manualRunIssue) {
    const blockId = lint.manualRunIssue.blockId
    if (blockId) push(false, blockId, lint.manualRunIssue.message)
    else {
      diagnostics.push({
        code: 'W_APPLY_LINT',
        severity: 'warning',
        message: lint.manualRunIssue.message,
      })
    }
  }
  return diagnostics
}

function summarizeDiff(
  diff: CanonicalDiff,
  baseIdentity: LockIdentity,
  targetIdentity: LockIdentity,
  noop: boolean
): SourceDiffSummary {
  const targetId = (key: string) => targetIdentity.blocks[key]?.id ?? ''
  const baseId = (key: string) => baseIdentity.blocks[key]?.id ?? ''
  return {
    noop,
    blocks: {
      added: diff.blocks.added.map((key) => ({ id: targetId(key), key })),
      removed: diff.blocks.removed.map((key) => ({ id: baseId(key), key })),
      renamed: diff.blocks.renamed.map(({ from, to }) => ({ id: targetId(to), from, to })),
      modified: diff.blocks.modified.map((change) => {
        const fields = change.changes.map((item) =>
          item.kind === 'param'
            ? item.param
            : item.kind === 'mode'
              ? `modes.${item.canonicalParamId}`
              : item.attribute
        )
        const reparented = change.changes.some(
          (item) => item.kind === 'attribute' && item.attribute === 'parent'
        )
        return {
          id: targetId(change.key),
          key: change.key,
          fields,
          ...(reparented ? { reparented } : {}),
        }
      }),
    },
    edges: { added: diff.edges.added.length, removed: diff.edges.removed.length },
    variables: {
      added: diff.variables.added,
      removed: diff.variables.removed,
      modified: diff.variables.modified,
    },
  }
}

/**
 * Existing blocks keep the positions stored at write time, so a canvas drag that landed during
 * the apply survives it (s4 D3). With `layout: 'lock'`, a block the lock positions keeps that.
 */
function mergeCurrentLayout(
  target: Record<string, BlockState>,
  current: Record<string, BlockState>,
  lockPositioned: ReadonlySet<string>
): Record<string, BlockState> {
  const merged: Record<string, BlockState> = {}
  for (const [id, block] of Object.entries(target)) {
    const stored = current[id]
    if (!stored || lockPositioned.has(id)) {
      merged[id] = block
      continue
    }
    const next: BlockState = {
      ...omit(block, ['height', 'layout']),
      position: stored.position,
      ...(stored.height !== undefined ? { height: stored.height } : {}),
      ...(stored.layout !== undefined ? { layout: stored.layout } : {}),
    }
    if (block.data) {
      next.data = {
        ...omit(block.data, ['width', 'height']),
        ...(stored.data?.width !== undefined ? { width: stored.data.width } : {}),
        ...(stored.data?.height !== undefined ? { height: stored.data.height } : {}),
      }
    }
    merged[id] = isEqual(next, block) ? block : next
  }
  return merged
}

interface Reprinted {
  files: Record<string, string>
  lock: WorkflowLockV1
  fingerprint: string
}

/**
 * Prints `state` back as source with the submission's bindings, order, code files and comments,
 * so the response shows exactly what is (or would be) stored. The fingerprint is computed the way
 * `source get` computes it, so it is the next apply's base.
 */
function reprint(args: {
  state: WorkflowState
  meta: CanonicalWorkflowMeta
  identity: LockIdentity
  compiled: CompileResult & { workflow: CanonicalWorkflow }
  catalog: BlockCatalog
  resources: ResourceKeyResolver
}): Reprinted {
  const { state, meta, identity, compiled, catalog, resources } = args
  const canonical = canonicalize(state, {
    catalog,
    meta,
    lock: identityLock(identity),
    resources,
  })
  const usesCodeFiles = Object.values(compiled.hints.blocks).some((hint) => hint.codeFile)
  const printed = printWorkflow({
    workflow: {
      ...canonical.workflow,
      annotations: {
        ...canonical.workflow.annotations,
        comments: compiled.workflow.annotations.comments,
      },
    },
    catalog,
    hints: compiled.hints,
    options: usesCodeFiles
      ? { functionCode: 'files', codeDir: FUNCTION_CODE_DIR }
      : { functionCode: 'inline' },
  })
  return {
    files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
    lock: assembleLock(canonical.identity, printed.hints.blocks, canonical.layout),
    fingerprint: fingerprintOf({ state, meta }, catalog, resources),
  }
}

function emptySummary(): SourceDiffSummary {
  return {
    noop: true,
    blocks: { added: [], removed: [], renamed: [], modified: [] },
    edges: { added: 0, removed: 0 },
    variables: { added: [], removed: [], modified: [] },
  }
}

/**
 * Applies workflow source (TypeScript) to the stored draft (build-spec decision 11, s4 D1–D12).
 *
 * The server compiles the submitted files against its live per-workflow catalog, materializes
 * the model onto the stored graph (keeping every unchanged value's stored bytes and every id the
 * lock binds), and refuses the whole write on any error: a compile error, a protected block, an
 * engine gate (allowlists, credentials, trigger uniqueness, sandbox plan), an invalid value, a
 * type that may stay but not be added, or a blocking lint finding. Errors carry source lines.
 *
 * The write is one `replaceWorkflowNormalizedState` under the workflow row lock, which re-checks
 * the fingerprint (409 when the draft moved), keeps current canvas positions for existing blocks
 * and asserts the protected-block merge is the identity. Draft only: it never deploys.
 */
export const applyWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applySource,
  resolveContext: resolvePrincipalWorkflowContext<ApplyWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    await requireMutableWorkflow(context.workflowId)

    const gate = await resolveCatalogGate(principal, context, { customBlockInputs: true })
    return withCatalogBlockScope(gate, async () => {
      const subjectUserId = resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      }).attributedUserId
      const isCopilot = principal.kind === 'delegated' && principal.serviceId === 'copilot'

      const stored = await loadStoredSource(context)
      const storedTypes = [...new Set(Object.values(stored.state.blocks).map((b) => b.type))]
      const { catalog } = buildCodeCatalog({
        gate,
        organizationId: context.workspaceOrganizationId,
        storedTypes,
      })

      const recording = createRecordingResolver()
      canonicalize(stored.state, { catalog, meta: stored.meta, resources: recording.resolver })
      let resources = await loadResourceKeyResolver(context.workspaceId, recording.requestedKinds)
      const currentFingerprint = fingerprintOf(stored, catalog, resources)

      const base = {
        workflowId: context.workflowId,
        workflowName: context.workflow.name,
        workspaceId: context.workspaceId,
        dryRun: input.dryRun === true,
        sdkMajor: catalog.sdkMajor,
        catalogVersion: catalog.hash,
      }
      const lockBaseFor = (fingerprint: string): LockBase => ({
        workspaceId: context.workspaceId,
        baseFingerprint: fingerprint,
        catalogHash: catalog.hash,
      })

      /** Refuses a commit; a dry run reports the same findings with a 200 instead (s4 §4). */
      const refuse = async (
        diagnostics: WorkflowSourceDiagnostic[]
      ): Promise<ApplyWorkflowSourceResult> => {
        if (!input.dryRun) throw new WorkflowSourceRejectedError(diagnostics)
        return {
          ...base,
          applied: false,
          diff: emptySummary(),
          diagnostics,
          newFingerprint: currentFingerprint,
          files: input.files,
          lock: input.lock,
          lockBase: lockBaseFor(currentFingerprint),
          mintedIds: {},
          warnings: [],
          needsRedeployment: await checkNeedsRedeployment(context.workflowId),
        }
      }

      if (currentFingerprint !== input.baseFingerprint) {
        if (!input.dryRun) throw new WorkflowSourceStaleError(currentFingerprint)
        return refuse([
          {
            code: 'E_APPLY_STALE',
            severity: 'error',
            message:
              'The workflow changed since this source was read. Get the source again, reapply your edit and retry.',
          },
        ])
      }

      const parsedLock = parseWorkflowLock(input.lock)
      if (parsedLock.diagnostics) {
        const locateLock = createLocator(input.files, {}, new Map())
        return refuse(parsedLock.diagnostics.map((diagnostic) => locateLock(diagnostic)))
      }
      const lock = parsedLock.lock

      const entryText = input.files[ENTRY_FILE]
      if (entryText === undefined) {
        throw new OrchestrationError('validation', `files must include ${ENTRY_FILE}`)
      }
      const compiled = compileWorkflow({
        entry: { path: ENTRY_FILE, text: entryText },
        files: new Map(Object.entries(input.files).filter(([path]) => path !== ENTRY_FILE)),
        catalog,
        sdkMajor: catalog.sdkMajor,
      })
      const compileLocate = createLocator(input.files, compiled.spans, new Map())
      if (!compiled.workflow || hasErrors(compiled.diagnostics)) {
        return refuse(compiled.diagnostics.map(compileLocate))
      }
      const compiledModel = { ...compiled, workflow: compiled.workflow }

      const compiledKinds = new Set<ResourceKind>()
      collectResourceKinds(compiled.workflow.blocks, compiledKinds)
      if ([...compiledKinds].some((kind) => !recording.requestedKinds.has(kind))) {
        resources = await loadResourceKeyResolver(context.workspaceId, [
          ...recording.requestedKinds,
          ...compiledKinds,
        ])
      }

      const hasLockEntries =
        Object.keys(lock.blocks).length > 0 || Object.keys(lock.variables).length > 0
      const lockFreshness: 'fresh' | 'stale' | 'none' = !hasLockEntries
        ? 'none'
        : input.lockBase &&
            (input.lockBase.workspaceId !== context.workspaceId ||
              input.lockBase.baseFingerprint !== currentFingerprint)
          ? 'stale'
          : 'fresh'
      const compiledBindings: Record<string, string> = {}
      for (const [key, hint] of Object.entries(compiled.hints.blocks)) {
        if (hint.binding !== undefined) compiledBindings[key] = hint.binding
      }
      const hooks = createMaterializeHooks()
      const materializeWith = (withLock: WorkflowLockV1): MaterializeResult =>
        materialize(compiledModel.workflow, withLock, {
          catalog,
          hooks,
          prev: stored.state,
          resources,
          layout: input.layout ?? 'preserve',
          compiledBindings,
          lockFreshness,
        })

      /**
       * A lock id for a new block that another workflow already stores cannot be reused (block
       * ids are global keys): drop it from the lock so materialize mints one, and say so.
       */
      let materialized = materializeWith(lock)
      const claimedDiagnostics: AnyDiagnostic[] = []
      const lockSuppliedIds = materialized.entries.flatMap((entry) =>
        entry.status === 'created' && entry.idSource === 'lock' ? [entry.id] : []
      )
      const claimed = new Set(
        await findBlockIdsClaimedElsewhere(context.workflowId, lockSuppliedIds)
      )
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
      const locate = createLocator(input.files, compiled.spans, idByKey)
      const materializeDiagnostics = [...materialized.diagnostics, ...claimedDiagnostics]
      if (hasErrors(materializeDiagnostics)) {
        return refuse([...compiled.diagnostics, ...materializeDiagnostics].map(locate))
      }

      const baseCanonical = canonicalize(stored.state, {
        catalog,
        meta: stored.meta,
        lock,
        resources,
      })
      const canonicalDiff = diffCanonical(
        baseCanonical.workflow,
        compiled.workflow,
        renamesBetween(baseCanonical.identity, materialized.identity)
      )
      const warnings: string[] = []
      if (canonicalDiff.meta.length > 0) {
        warnings.push(
          `The workflow ${canonicalDiff.meta.join(' and ')} in the source differs from the stored one and was not changed; rename or describe the workflow through its settings.`
        )
      }

      const storedGraph: SourceGraph = { blocks: stored.state.blocks, edges: stored.state.edges }
      let blocks = materialized.state.blocks
      const edges = materialized.state.edges
      const graphDiff = diffGraphs(storedGraph, { blocks, edges })
      const keyOf = (id: string) => keyById.get(id) ?? ''

      const permissionConfig = await resolvePermissionGroupConfig(
        subjectUserId,
        context.workspaceId,
        context.workspaceOrganizationId
      )
      const gateDiagnostics = await gateSourceDiff({
        base: storedGraph,
        target: { blocks, edges },
        diff: graphDiff,
        permissionConfig,
        subjectUserId,
        workspaceId: context.workspaceId,
        isCopilot,
      })
      const refusals: AnyDiagnostic[] = [
        ...findProtectedBlockRefusals(storedGraph, { blocks, edges }, graphDiff),
        ...gateDiagnostics,
      ]

      const typeChanged = new Set(
        graphDiff.modified.filter((change) => change.typeChanged).map((change) => change.id)
      )
      for (const id of [...graphDiff.added, ...typeChanged]) {
        const block = blocks[id]
        if (block && catalogBlock(catalog, block.type)?.addable === false) {
          refusals.push({
            code: 'E_TYPE_NOT_ADDABLE',
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
        if (!param || !blocks[blockId]?.subBlocks?.[param]) continue
        blocks = withBlock(blocks, blockId, (block) => ({
          ...block,
          subBlocks: { ...block.subBlocks, [param]: { ...block.subBlocks[param], value: null } },
        }))
      }

      const normalized = normalizeChangedValues(blocks, graphDiff, keyOf)
      blocks = normalized.blocks

      blocks = await snapshotMcpToolOutputSchemas(blocks, stored.state.blocks, {
        principal,
        workspaceId: context.workspaceId,
      })
      if (materialized.needsLayout.length > 0) {
        blocks = layoutChangedBlocks(context.workflowId, storedGraph, { blocks, edges })
      }

      const lint = await buildWorkflowLintReport(
        { blocks, edges },
        { workflowId: context.workflowId, workspaceId: context.workspaceId, subjectUserId }
      )
      const changedIds = new Set([...graphDiff.added, ...graphDiff.modified.map((m) => m.id)])
      const diagnostics = [
        ...compiled.diagnostics,
        ...materializeDiagnostics,
        ...refusals,
        ...normalized.diagnostics,
        ...lintDiagnostics(lint, changedIds, (id) => keyById.get(id)),
      ].map(locate)
      if (hasErrors(diagnostics)) return refuse(diagnostics)

      const layoutChanged =
        input.layout === 'lock' &&
        Object.entries(blocks).some(
          ([id, block]) =>
            stored.state.blocks[id] !== undefined &&
            !isEqual(block.position, stored.state.blocks[id].position)
        )
      const noop =
        !layoutChanged &&
        canonicalDiff.blocks.added.length === 0 &&
        canonicalDiff.blocks.removed.length === 0 &&
        canonicalDiff.blocks.modified.length === 0 &&
        canonicalDiff.edges.added.length === 0 &&
        canonicalDiff.edges.removed.length === 0 &&
        canonicalDiff.variables.added.length === 0 &&
        canonicalDiff.variables.removed.length === 0 &&
        canonicalDiff.variables.modified.length === 0
      const diff = summarizeDiff(canonicalDiff, baseCanonical.identity, materialized.identity, noop)
      const mintedIds: Record<string, string> = {}
      for (const entry of materialized.entries) {
        if (entry.status === 'created' && entry.idSource === 'minted') {
          mintedIds[entry.key] = entry.id
        }
      }
      const variablesChanged =
        canonicalDiff.variables.added.length > 0 ||
        canonicalDiff.variables.removed.length > 0 ||
        canonicalDiff.variables.modified.length > 0
      const variables = variablesChanged
        ? normalizeWorkflowVariables(materialized.state.variables ?? {}, { coerceValues: true })
        : undefined
      /** Variables as the next read will parse them, so the re-printed fingerprint matches it. */
      const storedVariables =
        variables === undefined ? stored.state.variables : (parseWorkflowVariables(variables) ?? {})

      const reprintFrom = (state: WorkflowState) =>
        reprint({
          state,
          meta: stored.meta,
          identity: materialized.identity,
          compiled: compiledModel,
          catalog,
          resources,
        })

      if (noop) {
        const printed = reprintFrom(stored.state)
        return {
          ...base,
          applied: false,
          diff,
          diagnostics,
          newFingerprint: currentFingerprint,
          files: printed.files,
          lock: printed.lock,
          lockBase: lockBaseFor(currentFingerprint),
          mintedIds: {},
          warnings,
          needsRedeployment: await checkNeedsRedeployment(context.workflowId),
        }
      }

      if (input.dryRun) {
        const prepared = prepareWorkflowStateForPersistence({ blocks, edges })
        await assertWorkflowGraphIdsUnclaimed(
          db,
          context.workflowId,
          collectWorkflowGraphIds(prepared.state)
        )
        const printed = reprintFrom({ ...prepared.state, variables: storedVariables })
        logger.info('Evaluated workflow source without persisting', {
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          principalKind: principal.kind,
        })
        return {
          ...base,
          applied: false,
          diff,
          diagnostics,
          newFingerprint: printed.fingerprint,
          files: printed.files,
          lock: printed.lock,
          lockBase: lockBaseFor(printed.fingerprint),
          mintedIds,
          warnings: [...warnings, ...prepared.warnings],
          needsRedeployment: await checkNeedsRedeployment(context.workflowId),
        }
      }

      const lockPositioned = new Set(
        input.layout === 'lock'
          ? Object.entries(lock.blocks).flatMap(([key, entry]) => {
              const id = idByKey.get(key)
              return entry.layout && id ? [id] : []
            })
          : []
      )
      await assertNoWithheldBlockType(
        { workspaceId: context.workspaceId, subjectUserId },
        Object.values(blocks)
      )
      const persisted = await replaceWorkflowNormalizedState({
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        attributedUserId: subjectUserId,
        subjectUserId,
        state: async (tx) => {
          const current = await loadStoredSource(context, tx)
          const fingerprint = fingerprintOf(current, catalog, resources)
          if (fingerprint !== input.baseFingerprint) {
            throw new WorkflowSourceStaleError(fingerprint)
          }
          const next = {
            blocks: mergeCurrentLayout(blocks, current.state.blocks, lockPositioned),
            edges,
          }
          assertProtectedBlocksPreserved(
            { blocks: current.state.blocks, edges: current.state.edges },
            next
          )
          return variables === undefined ? next : { ...next, variables }
        },
      })

      const printed = reprintFrom({ ...persisted.state, variables: storedVariables })
      logger.info('Applied workflow source', {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        principalKind: principal.kind,
      })
      return {
        ...base,
        applied: true,
        diff,
        diagnostics,
        newFingerprint: printed.fingerprint,
        files: printed.files,
        lock: printed.lock,
        lockBase: lockBaseFor(printed.fingerprint),
        mintedIds,
        warnings: [...warnings, ...persisted.warnings],
        needsRedeployment: await checkNeedsRedeployment(context.workflowId),
      }
    })
  },
  /** Only a committed, non-empty apply is a change worth auditing. */
  projectAudit: ({ principal, input, context, result }) =>
    result.applied
      ? ({
          action: AuditAction.WORKFLOW_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: result.workflowName,
          description: `Applied workflow source to workflow "${result.workflowName}"`,
          metadata: {
            op: 'apply_source',
            blocksAdded: result.diff.blocks.added.length,
            blocksRemoved: result.diff.blocks.removed.length,
            blocksRenamed: result.diff.blocks.renamed.length,
            blocksModified: result.diff.blocks.modified.length,
            edgesAdded: result.diff.edges.added,
            edgesRemoved: result.diff.edges.removed,
            variablesChanged:
              result.diff.variables.added.length +
              result.diff.variables.removed.length +
              result.diff.variables.modified.length,
            sdkMajor: result.sdkMajor,
            catalogVersion: result.catalogVersion,
            ...(input.provenance ? { client: input.provenance.client } : {}),
            ...(input.provenance?.gitSha ? { gitSha: input.provenance.gitSha } : {}),
            source: principalAuditSource(principal),
          },
        } as const)
      : [],
  afterSuccess: ({ context, result }) => {
    if (!result.applied) return
    return notifyWorkflowUpdated(context.workflowId)
  },
})
