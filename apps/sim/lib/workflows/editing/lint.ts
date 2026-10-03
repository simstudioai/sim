import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import {
  collectPredicateFieldNames,
  collectSortFieldNames,
} from '@/lib/table/query-builder/field-names'
import {
  getEffectiveBlockOutputs,
  getResponseFormatOutputs,
} from '@/lib/workflows/blocks/block-outputs'
import { getBlock } from '@/blocks'
import {
  isTriggerBlockType,
  normalizeName,
  REFERENCE,
  SPECIAL_REFERENCE_PREFIXES,
} from '@/executor/constants'
import { collectStringLeaves } from '@/executor/utils/reference-validation'
import {
  collectBlockFieldIssues,
  extractBlockParams,
  type InactiveModeValue,
} from '@/serializer/index'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { validateConditionHandle, validateRouterHandle } from './validation'

type BlockState = {
  id?: string
  type?: string
  name?: string
  triggerMode?: boolean
  subBlocks?: Record<string, { value?: unknown } | undefined>
}

type EdgeState = {
  source?: string | null
  sourceHandle?: string | null
  target?: string | null
}

export interface WorkflowLintBlockRef {
  blockId: string
  blockName?: string
  blockType?: string
}

export interface WorkflowLintEmptyOutgoingPort extends WorkflowLintBlockRef {
  handle: string
  label: string
}

export interface WorkflowLintInvalidBranchPort extends WorkflowLintBlockRef {
  sourceHandle: string
  reason: string
}

export interface WorkflowLintInvalidConnectionTarget {
  sourceBlockId: string
  sourceBlockName?: string
  sourceHandle?: string
  targetBlockId: string
  reason: string
}

export interface WorkflowLintResult {
  /** Every non-note block with no incoming edge (trigger blocks are naturally sources). */
  sources: WorkflowLintBlockRef[]
  /** Every non-note block with no outgoing edge. */
  sinks: WorkflowLintBlockRef[]
  orphanBlocks: WorkflowLintBlockRef[]
  emptyOutgoingPorts: WorkflowLintEmptyOutgoingPort[]
  invalidBranchPorts: WorkflowLintInvalidBranchPort[]
  invalidConnectionTargets: WorkflowLintInvalidConnectionTarget[]
}

/** Tier-1 (sync, config) field issues for a single block. */
export interface WorkflowLintFieldIssue extends WorkflowLintBlockRef {
  /** Required fields that resolve empty in the active mode. */
  missingRequiredFields: string[]
  /** Canonical pairs whose value is stranded on the inactive member (silently dropped). */
  inactiveModeValues: InactiveModeValue[]
}

/** Tier-2 (async, DB) reference that does not resolve to an accessible entity. */
export interface WorkflowLintUnresolvedReference extends WorkflowLintBlockRef {
  field: string
  value: string | string[]
  kind: 'credential' | 'resource' | 'custom-tool' | 'mcp-tool' | 'skill' | 'block-output'
  reason: string
}

/**
 * A Table block `filter`/`order` field that is not a column of the table the
 * block is bound to. Lint stayed clean on these while the run failed inside
 * the block's error edge, because the field name is only checked at run time.
 */
export interface WorkflowLintTableFieldIssue extends WorkflowLintBlockRef {
  /** The filter or sort field that names no column. */
  field: string
  /** Display name of the table the block is bound to. */
  tableName: string
}

/**
 * Aggregate lint report: the graph lint plus the config (Tier 1) and resolution
 * (Tier 2) checks. Returned in the edit_workflow result and written to lint.json.
 */
export interface WorkflowLintReport extends WorkflowLintResult {
  fieldIssues: WorkflowLintFieldIssue[]
  unresolvedReferences: WorkflowLintUnresolvedReference[]
  tableFieldIssues: WorkflowLintTableFieldIssue[]
  notes: string[]
}

function blockRef(blockId: string, block: BlockState): WorkflowLintBlockRef {
  return {
    blockId,
    blockName: block.name,
    blockType: block.type,
  }
}

/**
 * Whether a block starts a run and so is never an orphan: a block in trigger
 * mode, one of the universal entry types, or any `triggers`-category block
 * (schedule, webhooks) — the same rule the serializer applies.
 */
function isWorkflowEntryBlock(block: BlockState) {
  if (Boolean(block.triggerMode) || isTriggerBlockType(block.type)) return true
  return block.type !== undefined && getBlock(block.type)?.category === 'triggers'
}

/** Whether any block in the graph can start a run (see {@link isWorkflowEntryBlock}). */
export function hasWorkflowEntryBlock(
  blocks: WorkflowState['blocks'] | Record<string, unknown> | undefined
): boolean {
  return Object.values(blocks || {}).some((block) => isWorkflowEntryBlock(block as BlockState))
}

function requiredSubflowStartPort(block: BlockState) {
  if (block.type === 'loop') {
    return { handle: 'loop-start-source', label: 'loop-start-source' }
  }
  if (block.type === 'parallel') {
    return { handle: 'parallel-start-source', label: 'parallel-start-source' }
  }
  return null
}

function countsAsExternalOutgoing(block: BlockState, sourceHandle?: string | null) {
  if (block.type === 'loop') {
    return sourceHandle !== 'loop-start-source'
  }
  if (block.type === 'parallel') {
    return sourceHandle !== 'parallel-start-source'
  }
  return true
}

export function lintEditedWorkflowState(workflowState: Pick<WorkflowState, 'blocks' | 'edges'>) {
  const blocks = (workflowState.blocks || {}) as Record<string, BlockState>
  const edges = Array.isArray(workflowState.edges)
    ? (workflowState.edges as EdgeState[])
    : ([] as EdgeState[])

  const incomingEdgesByTarget = new Map<string, number>()
  const outgoingEdgesBySource = new Set<string>()
  const connectedDynamicHandles = new Map<string, Set<string>>()
  const invalidBranchPorts: WorkflowLintInvalidBranchPort[] = []
  const invalidConnectionTargets: WorkflowLintInvalidConnectionTarget[] = []

  for (const edge of edges) {
    const sourceBlockId = edge?.source || ''
    const targetBlockId = edge?.target || ''
    const sourceBlock = blocks[sourceBlockId]
    const targetBlock = blocks[targetBlockId]

    if (!sourceBlock || !targetBlock) {
      invalidConnectionTargets.push({
        sourceBlockId: sourceBlockId || 'unknown',
        sourceBlockName: sourceBlock?.name,
        sourceHandle: edge?.sourceHandle ?? undefined,
        targetBlockId: targetBlockId || 'unknown',
        reason: !sourceBlock
          ? 'Connection source block does not exist'
          : 'Connection target block does not exist',
      })
      continue
    }

    incomingEdgesByTarget.set(targetBlockId, (incomingEdgesByTarget.get(targetBlockId) || 0) + 1)
    if (countsAsExternalOutgoing(sourceBlock, edge?.sourceHandle)) {
      outgoingEdgesBySource.add(sourceBlockId)
    }

    const sourceHandle = edge?.sourceHandle
    if (!sourceHandle || sourceHandle === 'error') continue

    if (sourceBlock.type === 'condition' || sourceBlock.type === 'router_v2') {
      const validation =
        sourceBlock.type === 'condition'
          ? validateConditionHandle(
              sourceHandle,
              sourceBlockId,
              sourceBlock.subBlocks?.conditions?.value as string | any[]
            )
          : validateRouterHandle(
              sourceHandle,
              sourceBlockId,
              sourceBlock.subBlocks?.routes?.value as string | any[]
            )

      if (!validation.valid) {
        invalidBranchPorts.push({
          ...blockRef(sourceBlockId, sourceBlock),
          sourceHandle,
          reason: validation.error || `Invalid branch handle "${sourceHandle}"`,
        })
        continue
      }

      const normalizedHandle = validation.normalizedHandle || sourceHandle
      const handles = connectedDynamicHandles.get(sourceBlockId) || new Set<string>()
      handles.add(normalizedHandle)
      connectedDynamicHandles.set(sourceBlockId, handles)
      continue
    }

    const handles = connectedDynamicHandles.get(sourceBlockId) || new Set<string>()
    handles.add(sourceHandle)
    connectedDynamicHandles.set(sourceBlockId, handles)
  }

  const orphanBlocks = Object.entries(blocks)
    .filter(([, block]) => block.type !== 'note' && !isWorkflowEntryBlock(block))
    .filter(([blockId]) => !incomingEdgesByTarget.has(blockId))
    .map(([blockId, block]) => blockRef(blockId, block))

  // Structural descriptors (advisory, not "issues"): sources have no incoming
  // edge (trigger blocks are naturally sources), sinks have no outgoing edge.
  const sources = Object.entries(blocks)
    .filter(([, block]) => block.type !== 'note')
    .filter(([blockId]) => !incomingEdgesByTarget.has(blockId))
    .map(([blockId, block]) => blockRef(blockId, block))

  const sinks = Object.entries(blocks)
    .filter(([, block]) => block.type !== 'note')
    .filter(([blockId]) => !outgoingEdgesBySource.has(blockId))
    .map(([blockId, block]) => blockRef(blockId, block))

  const emptyOutgoingPorts = Object.entries(blocks).flatMap(([blockId, block]) => {
    const handles = connectedDynamicHandles.get(blockId) || new Set<string>()
    const requiredPort = requiredSubflowStartPort(block)
    const ports = requiredPort ? [requiredPort] : []

    return ports
      .filter((port) => !handles.has(port.handle))
      .map((port) => ({
        ...blockRef(blockId, block),
        handle: port.handle,
        label: port.label,
      }))
  })

  return {
    sources,
    sinks,
    orphanBlocks,
    emptyOutgoingPorts,
    invalidBranchPorts,
    invalidConnectionTargets,
  } satisfies WorkflowLintResult
}

/**
 * Tier-1 config lint: per-block required-field and canonical-mode (inactive
 * member) issues. Pure/sync. Uses the shared collector in `lint` mode, so every
 * required, visible sub-block is reported whatever the tool-level visibility of
 * its parameter — execution defers `user-or-llm` params to the tool's own late
 * validation, which is how a missing knowledge base id went unreported while a
 * missing table id was not. Skips notes and subflow containers, and blocks with
 * no registry config.
 */
export function collectWorkflowFieldIssues(
  blocks: WorkflowState['blocks'] | Record<string, unknown> | undefined
): WorkflowLintFieldIssue[] {
  const results: WorkflowLintFieldIssue[] = []
  for (const [blockId, block] of Object.entries(blocks || {})) {
    const type = (block as { type?: string })?.type
    if (!type || type === 'note' || type === 'loop' || type === 'parallel') continue
    const blockConfig = getBlock(type)
    if (!blockConfig) continue

    let params: Record<string, any>
    try {
      params = extractBlockParams(block as any)
    } catch {
      continue
    }

    const { missingRequiredFields, inactiveModeValues } = collectBlockFieldIssues(
      block as any,
      blockConfig,
      params,
      { mode: 'lint' }
    )
    if (missingRequiredFields.length > 0 || inactiveModeValues.length > 0) {
      results.push({
        ...blockRef(blockId, block as BlockState),
        missingRequiredFields,
        inactiveModeValues,
      })
    }
  }
  return results
}

/** The block type whose `filter`/`order` name table columns. */
const TABLE_BLOCK_TYPE = 'table_v2'

/** Sub-blocks that bind a Table block to a table: the manual id wins, then the picker. */
const TABLE_ID_SUB_BLOCKS = ['manualTableId', 'tableSelector'] as const

/** Fields every table row carries beyond its declared columns. */
const IMPLICIT_TABLE_ROW_FIELDS = ['id', 'createdAt', 'updatedAt'] as const

/** What the table field check needs to know about one table. */
export interface WorkflowLintTableSchema {
  name: string
  columnNames: readonly string[]
}

/**
 * A sub-block string value that is literal at lint time: non-empty and holding
 * no `<block.output>` reference, which only resolves at run time.
 */
function literalSubBlockText(block: BlockState, id: string): string | undefined {
  const value = block.subBlocks?.[id]?.value
  if (typeof value !== 'string' || value.trim() === '' || value.includes('<')) return undefined
  return value.trim()
}

/** The table id a Table block is statically bound to, or `undefined` when it is a reference or unset. */
export function tableBlockBoundTableId(block: BlockState): string | undefined {
  if (block.type !== TABLE_BLOCK_TYPE) return undefined
  for (const id of TABLE_ID_SUB_BLOCKS) {
    const value = literalSubBlockText(block, id)
    if (value) return value
  }
  return undefined
}

/** Every table id the graph's Table blocks are statically bound to. */
export function collectWorkflowTableIds(
  blocks: WorkflowState['blocks'] | Record<string, unknown> | undefined
): string[] {
  const ids = new Set<string>()
  for (const block of Object.values(blocks || {})) {
    const tableId = tableBlockBoundTableId(block as BlockState)
    if (tableId) ids.add(tableId)
  }
  return [...ids]
}

const TABLE_FIELD_SUB_BLOCKS: ReadonlyArray<[id: string, collect: (root: unknown) => string[]]> = [
  ['filter', collectPredicateFieldNames],
  ['order', collectSortFieldNames],
]

/**
 * Table-block `filter`/`order` fields that name no column of the bound table.
 * Resolved against the live schema the caller loaded (`tables`, keyed by table
 * id); a block whose table is not in the map — unset, a reference, or not
 * readable in this workspace — is skipped, as is a filter that holds a
 * reference or is not JSON, since neither can be judged at lint time.
 */
export function collectTableBlockFieldIssues(
  blocks: WorkflowState['blocks'] | Record<string, unknown> | undefined,
  tables: ReadonlyMap<string, WorkflowLintTableSchema>
): WorkflowLintTableFieldIssue[] {
  const issues: WorkflowLintTableFieldIssue[] = []
  for (const [blockId, raw] of Object.entries(blocks || {})) {
    const block = raw as BlockState
    const tableId = tableBlockBoundTableId(block)
    const table = tableId ? tables.get(tableId) : undefined
    if (!table) continue

    const known = new Set(
      [...table.columnNames, ...IMPLICIT_TABLE_ROW_FIELDS].map((name) => name.toLowerCase())
    )
    const reported = new Set<string>()
    for (const [subBlockId, collect] of TABLE_FIELD_SUB_BLOCKS) {
      const text = literalSubBlockText(block, subBlockId)
      if (!text) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        continue
      }
      for (const field of collect(parsed)) {
        const key = field.toLowerCase()
        if (known.has(key) || reported.has(key)) continue
        reported.add(key)
        issues.push({ ...blockRef(blockId, block), field, tableName: table.name })
      }
    }
  }
  return issues
}

type WorkflowLintIssueView = WorkflowLintResult & {
  fieldIssues?: WorkflowLintFieldIssue[]
  unresolvedReferences?: WorkflowLintUnresolvedReference[]
  tableFieldIssues?: WorkflowLintTableFieldIssue[]
}

export function hasWorkflowLintIssues(lint: WorkflowLintIssueView) {
  return (
    lint.orphanBlocks.length > 0 ||
    lint.emptyOutgoingPorts.length > 0 ||
    lint.invalidBranchPorts.length > 0 ||
    lint.invalidConnectionTargets.length > 0 ||
    (lint.fieldIssues?.length ?? 0) > 0 ||
    (lint.unresolvedReferences?.length ?? 0) > 0 ||
    (lint.tableFieldIssues?.length ?? 0) > 0
  )
}

export function formatWorkflowLintMessage(lint: WorkflowLintIssueView) {
  const parts: string[] = []

  if (lint.orphanBlocks.length > 0) {
    parts.push(
      `Blocks with no incoming edge: ${lint.orphanBlocks
        .map((block) => `"${block.blockName || block.blockId}" (${block.blockType || 'unknown'})`)
        .join(', ')}`
    )
  }

  if (lint.emptyOutgoingPorts.length > 0) {
    parts.push(
      `Unconnected required subflow start ports: ${lint.emptyOutgoingPorts
        .map((port) => `"${port.blockName || port.blockId}".${port.label}`)
        .join(', ')}`
    )
  }

  if (lint.invalidBranchPorts.length > 0) {
    parts.push(
      `Invalid condition/router branch handles: ${lint.invalidBranchPorts
        .map((port) => `"${port.blockName || port.blockId}" uses "${port.sourceHandle}"`)
        .join(', ')}`
    )
  }

  if (lint.invalidConnectionTargets.length > 0) {
    parts.push(
      `Connections pointing at missing blocks: ${lint.invalidConnectionTargets
        .map((edge) => `${edge.sourceBlockId} -> ${edge.targetBlockId}`)
        .join(', ')}`
    )
  }

  const fieldIssues = lint.fieldIssues ?? []
  const missing = fieldIssues.filter((issue) => issue.missingRequiredFields.length > 0)
  if (missing.length > 0) {
    parts.push(
      `Blocks missing required fields: ${missing
        .map(
          (issue) =>
            `"${issue.blockName || issue.blockId}" (${issue.missingRequiredFields.join(', ')})`
        )
        .join(', ')}`
    )
  }

  const inactive = fieldIssues.filter((issue) => issue.inactiveModeValues.length > 0)
  if (inactive.length > 0) {
    parts.push(
      `Values set on the inactive field mode (they will not resolve): ${inactive
        .map(
          (issue) =>
            `"${issue.blockName || issue.blockId}" (${issue.inactiveModeValues
              .map(
                (v) =>
                  `${v.inactiveMemberId}: move the value to "${v.activeMemberId ?? v.canonicalId}"`
              )
              .join('; ')})`
        )
        .join(', ')}`
    )
  }

  const unresolved = lint.unresolvedReferences ?? []
  const credResourceRefs = unresolved.filter(
    (ref) => ref.kind === 'credential' || ref.kind === 'resource'
  )
  if (credResourceRefs.length > 0) {
    parts.push(
      `Credential/resource references that do not resolve: ${credResourceRefs
        .map((ref) => `"${ref.blockName || ref.blockId}".${ref.field} (${ref.reason})`)
        .join(', ')}`
    )
  }

  const toolSkillRefs = unresolved.filter(
    (ref) => ref.kind === 'custom-tool' || ref.kind === 'mcp-tool' || ref.kind === 'skill'
  )
  if (toolSkillRefs.length > 0) {
    parts.push(
      `Agent tool/skill references that do not resolve (they will not attach at runtime): ${toolSkillRefs
        .map((ref) => `"${ref.blockName || ref.blockId}".${ref.field} (${ref.reason})`)
        .join(', ')}`
    )
  }

  const blockOutputRefs = unresolved.filter((ref) => ref.kind === 'block-output')
  if (blockOutputRefs.length > 0) {
    parts.push(
      `Block output references that will not resolve: ${blockOutputRefs
        .map(
          (ref) =>
            `"${ref.blockName || ref.blockId}".${ref.field} ${
              Array.isArray(ref.value) ? ref.value.join(', ') : ref.value
            } (${ref.reason})`
        )
        .join('; ')}`
    )
  }

  const tableFields = lint.tableFieldIssues ?? []
  if (tableFields.length > 0) {
    parts.push(
      `Table filter/sort fields that are not columns of the referenced table (the run will fail in the block's error edge): ${tableFields
        .map(
          (issue) =>
            `"${issue.blockName || issue.blockId}".${issue.field} (table "${issue.tableName}")`
        )
        .join(', ')}`
    )
  }

  return `Workflow lint found issues. Fix these before continuing: ${parts.join('; ')}`
}

/**
 * A `<block.path>` template whose head names no block in the graph. The runtime
 * behavior diverges by surface — function code fails loudly, but API bodies and
 * agent prompts pass the literal text through and the run reports completed —
 * so the dangling reference has to be caught at lint time, where every surface
 * gets the same finding. Code fields are tokenized with the runtime's own
 * reference scanner, so comparisons and generics in real JavaScript are not
 * mistaken for templates. Heads are matched with the executor's own name
 * normalization.
 */
const BLOCK_REF_TOKEN = /<([^<>]+)>/g
const REF_TOKEN_SHAPE = /^[A-Za-z_][\w-]*(?:[\w\s-]*[\w-])?\.[A-Za-z0-9_.[\]]+$/

/** Candidate `block.path` bodies in one string leaf; code goes through the runtime scanner. */
function referenceCandidates(leaf: string, isCode: boolean): string[] {
  if (!isCode) {
    return [...leaf.matchAll(BLOCK_REF_TOKEN)].map((match) => match[1] ?? '')
  }
  return findWorkflowReferenceTokens(leaf)
    .filter((token) => token.kind === 'workflow')
    .map((token) => token.value.slice(REFERENCE.START.length, -REFERENCE.END.length))
}

/**
 * Block types whose first-segment output keys are decided at run time rather
 * than by the registry: subflow containers (their outputs are the iteration
 * results the executor assembles) and table operations (rows take the shape of
 * the table's own columns).
 */
const DYNAMIC_OUTPUT_BLOCK_TYPES = new Set(['loop', 'parallel', 'table', 'table_v2'])

/**
 * The output field the executor writes on any block that fails. Never declared
 * in a registry schema, always resolvable — see the block reference resolver.
 */
const IMPLICIT_ERROR_OUTPUT = 'error'

/** Trailing `[n]` index suffixes, so `items[0]` compares as the key `items`. */
const INDEX_SUFFIX = /(?:\[\d+\])+$/

/**
 * The first path segment of a `block.path` token as an output key, or
 * `undefined` when it is not a key at all (a bare array index).
 */
function firstOutputSegment(token: string): string | undefined {
  const segment = (token.split('.')[1] ?? '').replace(INDEX_SUFFIX, '')
  if (!segment || /^\d+$/.test(segment)) return undefined
  return segment
}

/**
 * Output keys a reference into `block` may start with, or `undefined` when they
 * are not knowable at lint time.
 *
 * Mirrors the executor's own validation schema — `getEffectiveBlockOutputs`
 * with hidden outputs included, which is what `getBlockSchema` reads — so a
 * segment rejected here is one the run rejects with `InvalidFieldError`, and
 * one the schema accepts (a `responseFormat` property, an evaluator metric, a
 * resume-form field) is accepted here. Not knowable: trigger blocks, whose
 * output is whatever the caller sent; subflow containers and tables; an agent
 * whose `responseFormat` is set but cannot be parsed, since its fields are
 * decided when that schema resolves; and any type that declares no outputs.
 */
function declaredOutputKeys(block: BlockState): string[] | undefined {
  const type = block.type
  if (!type || block.triggerMode === true || isTriggerBlockType(type)) return undefined
  if (DYNAMIC_OUTPUT_BLOCK_TYPES.has(type)) return undefined
  const config = getBlock(type)
  if (!config || config.category === 'triggers') return undefined

  const subBlocks: Record<string, { value?: unknown }> = {}
  for (const [id, subBlock] of Object.entries(block.subBlocks ?? {})) {
    if (subBlock) subBlocks[id] = subBlock
  }

  if (type === 'agent') {
    const responseFormat = subBlocks.responseFormat?.value
    const hasResponseFormat =
      typeof responseFormat === 'string' ? responseFormat.trim() !== '' : Boolean(responseFormat)
    if (hasResponseFormat && !getResponseFormatOutputs(subBlocks, block.id ?? type)) {
      return undefined
    }
  }

  const keys = Object.keys(
    getEffectiveBlockOutputs(type, subBlocks, {
      triggerMode: false,
      preferToolOutputs: true,
      includeHidden: true,
    })
  )
  if (keys.length === 0) return undefined
  /** The resolver's legacy fallback accepts `<response.response.x>` on a Response block. */
  if (type === 'response') keys.push('response')
  return keys
}

interface UnknownFieldGroup {
  target: BlockState
  keys: string[]
  tokens: Set<string>
  segments: Set<string>
}

function quoteList(values: Iterable<string>): string {
  return [...values].map((value) => `"${value}"`).join(', ')
}

export function collectDanglingBlockOutputReferences(
  workflowState: Pick<WorkflowState, 'blocks'>
): WorkflowLintUnresolvedReference[] {
  const blocks = (workflowState.blocks || {}) as Record<string, BlockState>
  const targetByKey = new Map<string, string>()
  for (const [id, block] of Object.entries(blocks)) {
    targetByKey.set(id, id)
    if (block.name) targetByKey.set(normalizeName(block.name), id)
  }
  /** Output keys per referenced block; `null` once found not knowable. */
  const outputKeysByTarget = new Map<string, string[] | null>()
  const outputKeysFor = (targetId: string): string[] | null => {
    const cached = outputKeysByTarget.get(targetId)
    if (cached !== undefined) return cached
    const keys = declaredOutputKeys(blocks[targetId]) ?? null
    outputKeysByTarget.set(targetId, keys)
    return keys
  }

  const findings: WorkflowLintUnresolvedReference[] = []
  for (const [blockId, block] of Object.entries(blocks)) {
    for (const [subBlockId, subBlock] of Object.entries(block.subBlocks ?? {})) {
      const leaves: string[] = []
      collectStringLeaves((subBlock as { value?: unknown })?.value, leaves)
      const dangling = new Set<string>()
      const unknownByTarget = new Map<string, UnknownFieldGroup>()
      for (const leaf of leaves) {
        for (const token of referenceCandidates(leaf, subBlockId === 'code')) {
          if (!token || !REF_TOKEN_SHAPE.test(token)) continue
          const head = token.split('.')[0] ?? ''
          if ((SPECIAL_REFERENCE_PREFIXES as readonly string[]).includes(head)) continue
          const targetId = targetByKey.get(head) ?? targetByKey.get(normalizeName(head))
          if (targetId === undefined) {
            dangling.add(`<${token}>`)
            continue
          }
          const keys = outputKeysFor(targetId)
          const segment = firstOutputSegment(token)
          if (!keys || !segment || segment === IMPLICIT_ERROR_OUTPUT || keys.includes(segment)) {
            continue
          }
          const group = unknownByTarget.get(targetId) ?? {
            target: blocks[targetId],
            keys,
            tokens: new Set<string>(),
            segments: new Set<string>(),
          }
          group.tokens.add(`<${token}>`)
          group.segments.add(segment)
          unknownByTarget.set(targetId, group)
        }
      }
      if (dangling.size > 0) {
        findings.push({
          ...blockRef(blockId, block),
          field: subBlockId,
          value: [...dangling],
          kind: 'block-output',
          reason:
            'References a block that does not exist in this workflow — at run time the literal text is passed through (or the block fails), never the intended value.',
        })
      }
      for (const [targetId, group] of unknownByTarget) {
        const targetName = group.target.name || targetId
        const plural = group.segments.size === 1 ? 'field' : 'fields'
        findings.push({
          ...blockRef(blockId, block),
          field: subBlockId,
          value: [...group.tokens],
          kind: 'block-output',
          reason: `unknown-field: "${targetName}" (${group.target.type}) has no output ${plural} ${quoteList(group.segments)} — the run fails when the reference resolves. Available fields: ${group.keys.join(', ')}`,
        })
      }
    }
  }
  return findings
}
