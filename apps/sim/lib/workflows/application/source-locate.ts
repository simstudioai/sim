import {
  type AnchorKey,
  type CanonicalDiff,
  type CompileResult,
  codeFrame,
  type Diagnostic,
  encodeAnchor,
  type LockIdentity,
  type SourceSpan,
} from '@sim/workflow-code'
import { evaluateSubBlockCondition } from '@sim/workflow-code/catalog/canonical-index'
import { type BlockState, isSubflowType } from '@sim/workflow-types/workflow'
import { isEqual } from 'es-toolkit'
import type { WorkflowSourceDiagnostic } from '@/lib/workflows/application/source-error'
import type { GraphDiff } from '@/lib/workflows/code/apply/graph-diff'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import { validateValueForSubBlockType } from '@/lib/workflows/editing/validation'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'

interface SourceBlockRef {
  id: string
  key: string
}

/** What the apply changed (or, on a dry run, would change), by stored id and source key. */
export interface SourceDiffSummary {
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

export function hasErrors(diagnostics: readonly { severity: string }[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

function spanAnchors(diagnostic: Diagnostic): AnchorKey[] {
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
 * span map.
 */
export function createLocator(
  files: Record<string, string>,
  spans: CompileResult['spans'],
  idByKey: ReadonlyMap<string, string>
) {
  return (diagnostic: Diagnostic): WorkflowSourceDiagnostic => {
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

/** Subblock ids a diff sets on a block: every one for an added block. */
function changedFieldsOf(block: BlockState, diff: GraphDiff): string[] {
  const modified = diff.modified.find((change) => change.id === block.id)
  return modified ? modified.subBlocks : Object.keys(block.subBlocks ?? {})
}

/**
 * The replace path's value checks, on the blocks this apply adds or changes:
 * `validateWorkflowState` with sanitization, then `validateValueForSubBlockType` on each changed,
 * currently visible field. An invalid value refuses the apply; a value either step rewrites is
 * kept rewritten and reported as `W_APPLY_VALUE_NORMALIZED`. Untouched blocks keep their bytes.
 */
export function normalizeChangedValues(
  input: Record<string, BlockState>,
  diff: GraphDiff,
  keyOf: (id: string) => string
): { blocks: Record<string, BlockState>; diagnostics: Diagnostic[] } {
  let blocks = input
  const diagnostics: Diagnostic[] = []
  const changedIds = [...diff.added, ...diff.modified.map((change) => change.id)]
  for (const id of changedIds) {
    const original = blocks[id]
    if (!original || isSubflowType(original.type)) continue
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
      blocks = { ...blocks, [id]: { ...block, subBlocks } }
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
export function lintDiagnostics(
  lint: WorkflowLintReport,
  changedIds: ReadonlySet<string>,
  keyOf: (id: string) => string | undefined
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
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

/** The canonical diff by stored id and source key; `noop` is whether the graph is unchanged. */
export function summarizeDiff(
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

/** The summary of an apply that refused before diffing. */
export function emptyDiffSummary(): SourceDiffSummary {
  return {
    noop: true,
    blocks: { added: [], removed: [], renamed: [], modified: [] },
    edges: { added: 0, removed: 0 },
    variables: { added: [], removed: [], modified: [] },
  }
}
