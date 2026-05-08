import { isTriggerBlockType } from '@/executor/constants'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { validateConditionHandle, validateRouterHandle } from './validation'

type BlockState = {
  id?: string
  type?: string
  name?: string
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
  orphanBlocks: WorkflowLintBlockRef[]
  emptyOutgoingPorts: WorkflowLintEmptyOutgoingPort[]
  invalidBranchPorts: WorkflowLintInvalidBranchPort[]
  invalidConnectionTargets: WorkflowLintInvalidConnectionTarget[]
}

function blockRef(blockId: string, block: BlockState): WorkflowLintBlockRef {
  return {
    blockId,
    blockName: block.name,
    blockType: block.type,
  }
}

function parseArrayValue(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function conditionPortLabel(title: string, elseIfIndex: number): string {
  if (title === 'if') return 'if'
  if (title === 'else') return 'else'
  if (title === 'else if') return `else-if-${elseIfIndex}`
  return title || `branch-${elseIfIndex}`
}

function conditionPorts(block: BlockState) {
  const conditions = parseArrayValue(block.subBlocks?.conditions?.value)
  let elseIfIndex = 0

  return conditions
    .map((condition, index) => {
      const title = String(condition?.title ?? '').toLowerCase()
      const label = conditionPortLabel(title, elseIfIndex)
      if (title === 'else if') elseIfIndex++

      if (!condition?.id) return null
      return {
        handle: `condition-${condition.id}`,
        label: label || `branch-${index}`,
        value: block.subBlocks?.conditions?.value,
      }
    })
    .filter((port): port is { handle: string; label: string; value: unknown } => Boolean(port))
}

function routerPorts(block: BlockState) {
  return parseArrayValue(block.subBlocks?.routes?.value)
    .map((route, index) => {
      if (!route?.id) return null
      return {
        handle: `router-${route.id}`,
        label: `route-${index}`,
        value: block.subBlocks?.routes?.value,
      }
    })
    .filter((port): port is { handle: string; label: string; value: unknown } => Boolean(port))
}

function shouldLintDynamicPorts(block: BlockState) {
  return block.type === 'condition' || block.type === 'router_v2'
}

export function lintEditedWorkflowState(workflowState: Pick<WorkflowState, 'blocks' | 'edges'>) {
  const blocks = (workflowState.blocks || {}) as Record<string, BlockState>
  const edges = Array.isArray(workflowState.edges)
    ? (workflowState.edges as EdgeState[])
    : ([] as EdgeState[])

  const incomingEdgesByTarget = new Map<string, number>()
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

    if (!shouldLintDynamicPorts(sourceBlock)) continue

    const sourceHandle = edge?.sourceHandle
    if (!sourceHandle || sourceHandle === 'error') continue

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
  }

  const orphanBlocks = Object.entries(blocks)
    .filter(([, block]) => block.type !== 'note' && !isTriggerBlockType(block.type))
    .filter(([blockId]) => !incomingEdgesByTarget.has(blockId))
    .map(([blockId, block]) => blockRef(blockId, block))

  const emptyOutgoingPorts = Object.entries(blocks).flatMap(([blockId, block]) => {
    const handles = connectedDynamicHandles.get(blockId) || new Set<string>()
    const ports =
      block.type === 'condition'
        ? conditionPorts(block)
        : block.type === 'router_v2'
          ? routerPorts(block)
          : []

    return ports
      .filter((port) => !handles.has(port.handle))
      .map((port) => ({
        ...blockRef(blockId, block),
        handle: port.handle,
        label: port.label,
      }))
  })

  return {
    orphanBlocks,
    emptyOutgoingPorts,
    invalidBranchPorts,
    invalidConnectionTargets,
  } satisfies WorkflowLintResult
}

export function hasWorkflowLintIssues(lint: WorkflowLintResult) {
  return (
    lint.orphanBlocks.length > 0 ||
    lint.emptyOutgoingPorts.length > 0 ||
    lint.invalidBranchPorts.length > 0 ||
    lint.invalidConnectionTargets.length > 0
  )
}

export function formatWorkflowLintMessage(lint: WorkflowLintResult) {
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
      `Unconnected condition/router ports: ${lint.emptyOutgoingPorts
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

  return `Workflow graph lint found issues. Fix these before continuing: ${parts.join('; ')}`
}
