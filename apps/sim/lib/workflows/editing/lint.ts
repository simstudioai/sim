import { getBlock } from '@/blocks'
import { isTriggerBlockType } from '@/executor/constants'
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
  kind: 'credential' | 'resource' | 'custom-tool' | 'mcp-tool' | 'skill'
  reason: string
}

/**
 * Aggregate lint report: the graph lint plus the config (Tier 1) and resolution
 * (Tier 2) checks. Returned in the edit_workflow result and written to lint.json.
 */
export interface WorkflowLintReport extends WorkflowLintResult {
  fieldIssues: WorkflowLintFieldIssue[]
  unresolvedReferences: WorkflowLintUnresolvedReference[]
  notes: string[]
}

function blockRef(blockId: string, block: BlockState): WorkflowLintBlockRef {
  return {
    blockId,
    blockName: block.name,
    blockType: block.type,
  }
}

function isWorkflowEntryBlock(block: BlockState) {
  return Boolean(block.triggerMode) || isTriggerBlockType(block.type)
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
 * member) issues. Pure/sync. Uses the shared collector so results match the
 * runtime serializer's required-field semantics. Skips notes and subflow
 * containers, and blocks with no registry config.
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
      params
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

type WorkflowLintIssueView = WorkflowLintResult & {
  fieldIssues?: WorkflowLintFieldIssue[]
  unresolvedReferences?: WorkflowLintUnresolvedReference[]
}

export function hasWorkflowLintIssues(lint: WorkflowLintIssueView) {
  return (
    lint.orphanBlocks.length > 0 ||
    lint.emptyOutgoingPorts.length > 0 ||
    lint.invalidBranchPorts.length > 0 ||
    lint.invalidConnectionTargets.length > 0 ||
    (lint.fieldIssues?.length ?? 0) > 0 ||
    (lint.unresolvedReferences?.length ?? 0) > 0
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

  return `Workflow lint found issues. Fix these before continuing: ${parts.join('; ')}`
}
