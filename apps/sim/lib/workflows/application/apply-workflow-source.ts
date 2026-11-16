import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  resolvePrincipalAttribution,
  resolvePrincipalSubjectUserId,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { workflowBlocks, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import {
  type AnchorKey,
  type BlockCatalog,
  type CanonicalDiff,
  type CanonicalizeResult,
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
  type SourceFingerprint,
  type SourceSpan,
  sourceFingerprint,
  type WorkflowCodeMetaV1,
  type WorkflowLockBlock,
  type WorkflowLockV1,
} from '@sim/workflow-code'
import { evaluateSubBlockCondition } from '@sim/workflow-code/catalog/canonical-index'
import { catalogBlock } from '@sim/workflow-code/catalog/view'
import { readWorkflowCodeMeta, writeWorkflowCodeMeta } from '@sim/workflow-persistence/code-meta'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { isEqual } from 'es-toolkit'
import { resolveCatalogGate, withCatalogBlockScope } from '@/lib/catalog/application/context'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { notifyWorkflowUpdated, notifyWorkspaceWorkflowsChanged } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveWorkflowFolderPath } from '@/lib/workflows/application/folders'
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
import { requireWorkflowTransition } from '@/lib/workflows/application/transition-result'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { buildCodeCatalog } from '@/lib/workflows/code/catalog/workspace-catalog'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { loadResourceKeyResolver } from '@/lib/workflows/code/resources'
import {
  buildLockFromState,
  codeMetaPrintInputs,
  mergeCodeMetaFromLock,
} from '@/lib/workflows/code/source-lock'
import { canonicalizeStored, canonicalizeUnderLock } from '@/lib/workflows/code/stored-canonical'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { validateValueForSubBlockType } from '@/lib/workflows/editing/validation'
import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration'
import { assertNoWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import {
  type PreparedWorkflowState,
  prepareWorkflowStateForPersistence,
} from '@/lib/workflows/persistence/prepare-state'
import {
  assertWorkflowGraphIdsUnclaimed,
  collectWorkflowGraphIds,
  replaceWorkflowNormalizedState,
  WorkflowStatePersistenceError,
} from '@/lib/workflows/persistence/replace-normalized-state'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { gateSourceDiff } from '@/lib/workflows/source/gates'
import { diffGraphs, type GraphDiff, type SourceGraph } from '@/lib/workflows/source/graph-diff'
import {
  assertProtectedBlocksPreserved,
  findProtectedBlockRefusals,
} from '@/lib/workflows/source/protected'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { parseWorkflowVariables } from '@/lib/workflows/variables/parse'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/context'
import type { ResourceKeyRef } from '@/lib/workspaces/resource-bindings'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('ApplyWorkflowSource')

/** The entry file every submission carries; function code lives beside it. */
const ENTRY_FILE = 'workflow.ts'
/** Where function code is re-printed when the submission used code files (as `source get` does). */
const FUNCTION_CODE_DIR = 'functions'
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['loop', 'parallel'])

/** What every source submission carries, whether it updates a draft or creates a workflow. */
interface SourceSubmission {
  /** Repo-relative path → text: `workflow.ts` plus any function-code files it references. */
  files: Record<string, string>
  /** Run the whole pipeline and stop before the write. Never audits or notifies. */
  dryRun?: boolean
  /** `preserve` (default): existing blocks keep stored positions. `lock`: lock layout wins. */
  layout?: 'preserve' | 'lock'
  provenance?: { client: 'cli' | 'copilot' | 'canvas' | 'api'; gitSha?: string; repo?: string }
}

export interface ApplyWorkflowSourceInput extends SourceSubmission {
  workflowId: string
  assertedWorkspaceId?: string
  /** The identity lock returned by `source get` (or a previous apply). */
  lock: WorkflowLockV1
  /** The environment facts that came with the lock; a lock read elsewhere is treated as stale. */
  lockBase?: LockBase
  /** The `fingerprint` the source was read at; the apply answers 409 when it no longer matches. */
  baseFingerprint: string
}

export interface CreateWorkflowFromSourceInput extends SourceSubmission {
  workspaceId: string
  /** The new workflow's name; the source's `workflow('…')` name when omitted. */
  name?: string
  /** The new workflow's description; the source's when omitted. */
  description?: string | null
  /** Containing folder path; the workspace root when omitted. */
  folderPath?: string
}

/**
 * Where a source apply writes: the stored draft of an existing workflow, or a new workflow the
 * apply creates, with an empty graph standing in for the stored one (no prev).
 */
type SourceApplyTarget =
  | { kind: 'existing'; context: ActiveWorkflowApplicationContext }
  | {
      kind: 'new'
      workspace: ActiveWorkspaceApplicationContext
      workflowId: string
      name?: string
      description?: string | null
      folderId: string | null
    }

/** The lock a new workflow starts from: nothing bound yet. */
const EMPTY_LOCK: WorkflowLockV1 = { lockVersion: 1, blocks: {}, variables: {} }

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
): SourceFingerprint {
  const { workflow, identity } = canonicalize(stored.state, {
    catalog,
    meta: stored.meta,
    resources,
  })
  return sourceFingerprint(workflow, identity)
}

/** Every `(kind, key)` resource reference in a compiled model, for binding lookup. */
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
  fingerprint: SourceFingerprint
}

/** What a re-print of one state reads, computed once however many prints share it. */
interface PrintBase {
  /** The state canonicalized under the bound identity, so branch keys follow the lock. */
  canonical: CanonicalizeResult
  /** The `sf1:` fingerprint exactly as `source get` computes it (no lock). */
  fingerprint: SourceFingerprint
}

/**
 * The canonical model and fingerprint of `state` for a re-print. `lockless` is the state's
 * lockless canonical model when the caller already holds it; it is reused for the fingerprint and,
 * when the identity lock changes nothing, for the print.
 */
function printBase(args: {
  state: WorkflowState
  meta: CanonicalWorkflowMeta
  identity: LockIdentity
  catalog: BlockCatalog
  resources: ResourceKeyResolver
  lockless?: CanonicalizeResult
}): PrintBase {
  const { state, meta, identity, catalog, resources } = args
  const lockless = args.lockless ?? canonicalize(state, { catalog, meta, resources })
  return {
    canonical: canonicalizeUnderLock(
      state,
      { catalog, meta, resources },
      lockless,
      identityLock(identity)
    ),
    fingerprint: sourceFingerprint(lockless.workflow, lockless.identity),
  }
}

/**
 * Prints a state back as source with the bindings, order and comments of `codeMeta` (the
 * submission's, merged onto the ids it now binds), so the response shows exactly what is (or
 * would be) stored and what the next `source get` prints. The lock is assembled the way `source
 * get` assembles it, and the fingerprint is computed the way it computes it, so it is the next
 * apply's base.
 */
function reprint(args: {
  base: PrintBase
  codeMeta: WorkflowCodeMetaV1 | null
  usesCodeFiles: boolean
  catalog: BlockCatalog
}): Reprinted {
  const { base, codeMeta, usesCodeFiles, catalog } = args
  const { canonical } = base
  const metaInputs = codeMetaPrintInputs(codeMeta, canonical)
  const printed = printWorkflow({
    workflow: {
      ...canonical.workflow,
      annotations: { ...canonical.workflow.annotations, comments: metaInputs.comments },
    },
    catalog,
    hints: metaInputs.hints,
    options: usesCodeFiles
      ? { functionCode: 'files', codeDir: FUNCTION_CODE_DIR }
      : { functionCode: 'inline' },
  })
  return {
    files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
    lock: buildLockFromState(codeMeta, canonical, printed.hints),
    fingerprint: base.fingerprint,
  }
}

/**
 * The post-materialize lock `mergeCodeMetaFromLock` re-keys onto: every bound key with its id,
 * and the submitted lock's binding and order for a block the file does not state them for.
 */
function boundLock(identity: LockIdentity, submitted: WorkflowLockV1): WorkflowLockV1 {
  const blocks: Record<string, WorkflowLockBlock> = {}
  for (const [key, block] of Object.entries(identity.blocks)) {
    const previous = Object.hasOwn(submitted.blocks, key) ? submitted.blocks[key] : undefined
    blocks[key] = { ...block, binding: previous?.binding ?? key, order: previous?.order ?? 0 }
  }
  return { lockVersion: 1, blocks, variables: identity.variables }
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
 * Inserts a workflow created from source and its graph in one transaction: the row (with the
 * create path's folder, name-conflict and sort rules), the prepared graph under the caller's block
 * access, its variables and its `code_meta`. A name taken in the folder is a 409; any failure rolls
 * the whole create back.
 */
async function createSourceWorkflow(args: {
  target: Extract<SourceApplyTarget, { kind: 'new' }>
  name: string
  description: string | null
  subjectUserId: string
  graph: Pick<WorkflowState, 'blocks' | 'edges'>
  variables: ReturnType<typeof normalizeWorkflowVariables> | undefined
  codeMeta: WorkflowCodeMetaV1 | null
}): Promise<{ name: string; state: PreparedWorkflowState; warnings: string[] }> {
  const { target, subjectUserId } = args
  const workspaceId = target.workspace.workspaceId
  await assertNoWithheldBlockType({ workspaceId, subjectUserId }, Object.values(args.graph.blocks))
  const prepared = prepareWorkflowStateForPersistence(args.graph)
  const transition = await performCreateWorkflowTransition({
    id: target.workflowId,
    userId: subjectUserId,
    workspaceId,
    name: args.name,
    description: args.description,
    folderId: target.folderId,
    writeGraph: async (tx, workflowId) => {
      await assertWorkflowGraphIdsUnclaimed(tx, workflowId, collectWorkflowGraphIds(prepared.state))
      const saved = await saveWorkflowToNormalizedTables(
        workflowId,
        { ...prepared.state, lastSaved: Date.now() } as WorkflowState,
        { workspaceId, subjectUserId },
        tx
      )
      if (!saved.success) {
        throw new WorkflowStatePersistenceError(saved.error ?? 'Unknown persistence failure')
      }
      if (args.variables !== undefined) {
        await tx
          .update(workflowTable)
          .set({ variables: args.variables })
          .where(eq(workflowTable.id, workflowId))
      }
      await writeWorkflowCodeMeta(tx, workflowId, args.codeMeta)
    },
  })
  requireWorkflowTransition(transition, 'Failed to create workflow')
  if (!transition.workflow) throw new Error('Successful workflow create returned no workflow')

  try {
    const { errors } = await extractAndPersistCustomTools(
      prepared.state,
      workspaceId,
      subjectUserId
    )
    if (errors.length > 0) {
      logger.warn('Some custom tools failed to persist', { workflowId: target.workflowId, errors })
    }
  } catch (error) {
    logger.error('Failed to persist custom tools', { workflowId: target.workflowId, error })
  }
  return { name: transition.workflow.name, state: prepared.state, warnings: prepared.warnings }
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
 * and asserts the protected-block merge is the identity, then stores the submission's bindings,
 * order and comments in `workflow.code_meta` in the same transaction. A source that changes only
 * those (a renamed const, a moved declaration, a comment) is a graph no-op that stores just
 * `code_meta`, so the next `source get` prints it. Draft only: it never deploys.
 */
export const applyWorkflowSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applySource,
  resolveContext: resolvePrincipalWorkflowContext<ApplyWorkflowSourceInput>,
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    await requireMutableWorkflow(context.workflowId)
    return runSourceApply(principal, input, { kind: 'existing', context })
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
          metadata: sourceAuditMetadata(principal, input, result),
        } as const)
      : [],
  afterSuccess: ({ context, result }) => {
    if (!result.applied) return
    return notifyWorkflowUpdated(context.workflowId)
  },
})

/** The audit metadata a committed source write records, for update and create alike. */
function sourceAuditMetadata(
  principal: Principal,
  input: SourceSubmission,
  result: ApplyWorkflowSourceResult
) {
  return {
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
  }
}

/**
 * Creates a workflow from source (`POST /api/v2/workspaces/{id}/workflows/source`): the same
 * pipeline as {@link applyWorkflowSource} with an empty graph as the stored draft, so every
 * block is new, every id is minted and no fingerprint is checked. The workflow row, its graph,
 * variables and `code_meta` are written in one transaction, so a refused or failed create leaves
 * nothing behind. A dry run runs every check and creates nothing.
 */
export const createWorkflowFromSource = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.createFromSource,
  resolveContext: ({ input }: { input: CreateWorkflowFromSourceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<ApplyWorkflowSourceResult> {
    await requireWorkflowCodeEnabled()
    const { folderId } = await resolveWorkflowFolderPath(
      context.workspaceId,
      input.folderPath ?? '/'
    )
    try {
      await assertFolderMutable(folderId)
    } catch (error) {
      if (error instanceof FolderLockedError) throw new OrchestrationError('locked', error.message)
      throw error
    }
    return runSourceApply(
      principal,
      { ...input, lock: EMPTY_LOCK },
      {
        kind: 'new',
        workspace: context,
        workflowId: generateId(),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        folderId,
      }
    )
  },
  projectAudit: ({ principal, input, result }) =>
    result.applied
      ? ({
          action: AuditAction.WORKFLOW_CREATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: result.workflowId,
          resourceName: result.workflowName,
          description: `Created workflow "${result.workflowName}" from source`,
          metadata: sourceAuditMetadata(principal, input, result),
        } as const)
      : [],
  afterSuccess: async ({ result }) => {
    if (!result.applied) return
    await Promise.all([
      notifyWorkflowUpdated(result.workflowId),
      notifyWorkspaceWorkflowsChanged(result.workspaceId),
    ])
  },
})

/**
 * The source-apply pipeline (build-spec decision 11, s4 D1–D12) for either target. Compile,
 * materialize onto the stored graph (empty for a new workflow), every gate, value check and lint,
 * then the write: a replace under the row lock for an existing draft, or a create that inserts the
 * row and its graph in one transaction.
 */
async function runSourceApply(
  principal: Principal,
  input: SourceSubmission & {
    lock: WorkflowLockV1
    lockBase?: LockBase
    baseFingerprint?: string
  },
  target: SourceApplyTarget
): Promise<ApplyWorkflowSourceResult> {
  const context =
    target.kind === 'existing'
      ? target.context
      : { ...target.workspace, workflowId: target.workflowId }
  const isNew = target.kind === 'new'
  const needsRedeployment = () =>
    isNew ? Promise.resolve(false) : checkNeedsRedeployment(context.workflowId)

  const gate = await resolveCatalogGate(principal, context, { customBlockInputs: true })
  return withCatalogBlockScope(gate, async () => {
    const subjectUserId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const isCopilot = principal.kind === 'delegated' && principal.serviceId === 'copilot'

    const [loadedStored, storedCodeMeta]: [StoredSource, WorkflowCodeMetaV1 | null] =
      target.kind === 'existing'
        ? await Promise.all([
            loadStoredSource(target.context),
            readWorkflowCodeMeta(db, context.workflowId),
          ])
        : [
            {
              state: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} },
              meta: { name: target.name ?? '', description: target.description ?? null },
            },
            null,
          ]
    let stored: StoredSource = loadedStored
    const storedTypes = [...new Set(Object.values(stored.state.blocks).map((b) => b.type))]
    const { catalog } = buildCodeCatalog({
      gate,
      organizationId: context.workspaceOrganizationId,
      storedTypes,
    })

    const createdBy = resolvePrincipalSubjectUserId(principal) ?? null
    const storedSource = await canonicalizeStored({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      state: stored.state,
      meta: stored.meta,
      catalog,
      createdBy,
    })
    let storedCanonical = storedSource.canonical
    const storedIdentity = storedCanonical.identity
    let resources = storedSource.resources
    const currentFingerprint = sourceFingerprint(storedCanonical.workflow, storedIdentity)

    const base = {
      workflowId: context.workflowId,
      workflowName: stored.meta.name,
      workspaceId: context.workspaceId,
      dryRun: input.dryRun === true,
      sdkMajor: catalog.sdkMajor,
      catalogVersion: catalog.hash,
    }
    const lockBaseFor = (fingerprint: SourceFingerprint): LockBase => ({
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
        needsRedeployment: await needsRedeployment(),
      }
    }

    if (!isNew && currentFingerprint !== input.baseFingerprint) {
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
      knownKeys: new Set([...Object.keys(lock.blocks), ...Object.keys(storedIdentity.blocks)]),
    })
    const compileLocate = createLocator(input.files, compiled.spans, new Map())
    if (!compiled.workflow || hasErrors(compiled.diagnostics)) {
      return refuse(compiled.diagnostics.map(compileLocate))
    }
    const compiledModel = { ...compiled, workflow: compiled.workflow }
    if (target.kind === 'new') {
      stored = {
        ...stored,
        meta: {
          name: target.name ?? compiled.workflow.meta.name,
          description:
            target.description !== undefined
              ? target.description
              : compiled.workflow.meta.description,
        },
      }
      base.workflowName = stored.meta.name
      storedCanonical = canonicalize(stored.state, { catalog, meta: stored.meta, resources })
    }

    const compiledKeys: ResourceKeyRef[] = []
    collectResourceKeys(compiled.workflow.blocks, compiledKeys)
    const currentResources = resources
    if (compiledKeys.some(({ kind, key }) => currentResources.toId(kind, key) === null)) {
      resources = await loadResourceKeyResolver(
        context.workspaceId,
        { ids: storedSource.loaded.ids, keys: [...storedSource.loaded.keys, ...compiledKeys] },
        { createdBy }
      )
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
    const claimed = new Set(await findBlockIdsClaimedElsewhere(context.workflowId, lockSuppliedIds))
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

    const baseCanonical = canonicalizeUnderLock(
      stored.state,
      { catalog, meta: stored.meta, resources },
      storedCanonical,
      lock
    )
    const canonicalDiff = diffCanonical(
      baseCanonical.workflow,
      compiled.workflow,
      renamesBetween(baseCanonical.identity, materialized.identity)
    )
    const warnings: string[] = []
    if (!isNew && canonicalDiff.meta.length > 0) {
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
      !isNew &&
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

    const lockAfter = boundLock(materialized.identity, lock)
    const nextCodeMeta = mergeCodeMetaFromLock(storedCodeMeta, lockAfter, compiledModel)
    const usesCodeFiles = Object.values(compiled.hints.blocks).some((hint) => hint.codeFile)
    const printBaseOf = (state: WorkflowState, lockless?: CanonicalizeResult) =>
      printBase({
        state,
        meta: stored.meta,
        identity: materialized.identity,
        catalog,
        resources,
        ...(lockless ? { lockless } : {}),
      })
    const reprintFrom = (base: PrintBase) =>
      reprint({ base, codeMeta: nextCodeMeta, usesCodeFiles, catalog })

    if (noop) {
      const storedBase = printBaseOf(stored.state, storedCanonical)
      const printed = reprintFrom(storedBase)
      if (!input.dryRun) {
        const storedPrint = reprint({
          base: storedBase,
          codeMeta: storedCodeMeta,
          usesCodeFiles,
          catalog,
        })
        if (
          !isEqual(printed.files, storedPrint.files) ||
          !isEqual(printed.lock, storedPrint.lock)
        ) {
          await writeWorkflowCodeMeta(db, context.workflowId, nextCodeMeta)
        }
      }
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
        needsRedeployment: await needsRedeployment(),
      }
    }

    if (input.dryRun) {
      const prepared = prepareWorkflowStateForPersistence({ blocks, edges })
      await assertWorkflowGraphIdsUnclaimed(
        db,
        context.workflowId,
        collectWorkflowGraphIds(prepared.state)
      )
      const printed = reprintFrom(printBaseOf({ ...prepared.state, variables: storedVariables }))
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
        needsRedeployment: await needsRedeployment(),
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
    if (target.kind === 'new') {
      const created = await createSourceWorkflow({
        target,
        name: stored.meta.name,
        description: stored.meta.description,
        subjectUserId,
        graph: { blocks, edges },
        variables,
        codeMeta: nextCodeMeta,
      })
      const printed = reprintFrom(printBaseOf({ ...created.state, variables: storedVariables }))
      logger.info('Created workflow from source', {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        principalKind: principal.kind,
      })
      return {
        ...base,
        workflowName: created.name,
        applied: true,
        diff,
        diagnostics,
        newFingerprint: printed.fingerprint,
        files: printed.files,
        lock: printed.lock,
        lockBase: lockBaseFor(printed.fingerprint),
        mintedIds,
        warnings: [...warnings, ...created.warnings],
        needsRedeployment: false,
      }
    }

    const existing = target.context
    const persisted = await replaceWorkflowNormalizedState({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      attributedUserId: subjectUserId,
      subjectUserId,
      state: async (tx) => {
        const current = await loadStoredSource(existing, tx)
        const fingerprint = isEqual(current, stored)
          ? currentFingerprint
          : fingerprintOf(current, catalog, resources)
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
        await writeWorkflowCodeMeta(
          tx,
          context.workflowId,
          mergeCodeMetaFromLock(
            await readWorkflowCodeMeta(tx, context.workflowId),
            lockAfter,
            compiledModel
          )
        )
        return variables === undefined ? next : { ...next, variables }
      },
    })

    const printed = reprintFrom(printBaseOf({ ...persisted.state, variables: storedVariables }))
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
      needsRedeployment: await needsRedeployment(),
    }
  })
}
