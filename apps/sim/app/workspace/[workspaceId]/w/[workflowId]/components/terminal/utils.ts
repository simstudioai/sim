import type React from 'react'
import {
  AlertTriangleIcon,
  BanIcon,
  NetworkIcon,
  RepeatIcon,
  SplitIcon,
  XCircleIcon,
} from 'lucide-react'
import { getBlock } from '@/blocks'
import { isWorkflowBlockType } from '@/executor/constants'
import { TERMINAL_BLOCK_COLUMN_WIDTH } from '@/stores/constants'
import type { ConsoleEntry } from '@/stores/terminal'

/**
 * Subflow colors matching the subflow tool configs
 */
const SUBFLOW_COLORS = {
  loop: '#2FB3FF',
  parallel: '#FEE12B',
} as const

const WORKFLOW_COLOR = '#8b5cf6'

/**
 * Special block type colors for errors and system messages
 */
const SPECIAL_BLOCK_COLORS = {
  error: '#ef4444',
  validation: '#f59e0b',
  cancelled: '#6b7280',
} as const

/**
 * Retrieves the icon component for a given block type
 */
export function getBlockIcon(
  blockType: string
): React.ComponentType<{ className?: string }> | null {
  const blockConfig = getBlock(blockType)

  if (blockConfig?.icon) {
    return blockConfig.icon
  }

  if (blockType === 'loop') {
    return RepeatIcon
  }

  if (blockType === 'parallel') {
    return SplitIcon
  }

  if (blockType === 'workflow') {
    return NetworkIcon
  }

  if (blockType === 'error') {
    return XCircleIcon
  }

  if (blockType === 'validation') {
    return AlertTriangleIcon
  }

  if (blockType === 'cancelled') {
    return BanIcon
  }

  return null
}

/**
 * Gets the background color for a block type
 */
export function getBlockColor(blockType: string): string {
  const blockConfig = getBlock(blockType)
  if (blockConfig?.bgColor) {
    return blockConfig.bgColor
  }
  // Use proper subflow colors matching the toolbar configs
  if (blockType === 'loop') {
    return SUBFLOW_COLORS.loop
  }
  if (blockType === 'parallel') {
    return SUBFLOW_COLORS.parallel
  }
  if (blockType === 'workflow') {
    return WORKFLOW_COLOR
  }
  // Special block types for errors and system messages
  if (blockType === 'error') {
    return SPECIAL_BLOCK_COLORS.error
  }
  if (blockType === 'validation') {
    return SPECIAL_BLOCK_COLORS.validation
  }
  if (blockType === 'cancelled') {
    return SPECIAL_BLOCK_COLORS.cancelled
  }
  return '#6b7280'
}

/**
 * Determines if a keyboard event originated from a text-editable element
 */
export function isEventFromEditableElement(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null
  if (!target) return false

  const isEditable = (el: HTMLElement | null): boolean => {
    if (!el) return false
    if (el instanceof HTMLInputElement) return true
    if (el instanceof HTMLTextAreaElement) return true
    if ((el as HTMLElement).isContentEditable) return true
    const role = el.getAttribute('role')
    if (role === 'textbox' || role === 'combobox') return true
    return false
  }

  let el: HTMLElement | null = target
  while (el) {
    if (isEditable(el)) return true
    el = el.parentElement
  }
  return false
}

/**
 * Checks if a block type is a subflow (loop or parallel)
 */
export function isSubflowBlockType(blockType: string): boolean {
  const lower = blockType?.toLowerCase() || ''
  return lower === 'loop' || lower === 'parallel'
}

/**
 * Node type for the tree structure
 */
export type EntryNodeType = 'block' | 'subflow' | 'iteration' | 'workflow'

/**
 * Entry node for tree structure - represents a block, subflow, or iteration
 */
export interface EntryNode {
  /** The console entry (for blocks) or synthetic entry (for subflows/iterations) */
  entry: ConsoleEntry
  /** Child nodes */
  children: EntryNode[]
  /** Node type */
  nodeType: EntryNodeType
  /** Iteration info for iteration nodes */
  iterationInfo?: {
    current: number
    total?: number
  }
}

/**
 * Execution group interface for grouping entries by execution
 */
export interface ExecutionGroup {
  executionId: string
  startTime: string
  endTime: string
  startTimeMs: number
  endTimeMs: number
  duration: number
  status: 'success' | 'error'
  /** Flat list of entries (legacy, kept for filters) */
  entries: ConsoleEntry[]
  /** Tree structure of entry nodes for nested display */
  entryTree: EntryNode[]
}

/**
 * Iteration group for grouping blocks within the same iteration
 */
interface IterationGroup {
  iterationType: string
  iterationContainerId: string
  iterationCurrent: number
  iterationTotal?: number
  blocks: ConsoleEntry[]
  startTimeMs: number
}

/**
 * Recursively collects all descendant entries owned by a workflow block.
 * This includes direct children and the children of any nested workflow blocks,
 * enabling correct tree construction for deeply-nested child workflows.
 */
function collectWorkflowDescendants(
  instanceKey: string,
  workflowChildGroups: Map<string, ConsoleEntry[]>,
  visited: Set<string> = new Set()
): ConsoleEntry[] {
  if (visited.has(instanceKey)) return []
  visited.add(instanceKey)
  const direct = workflowChildGroups.get(instanceKey) ?? []
  const result = [...direct]
  for (const entry of direct) {
    if (isWorkflowBlockType(entry.blockType)) {
      // Use childWorkflowInstanceId when available (unique per-invocation) to correctly
      // separate children across loop iterations of the same workflow block.
      result.push(
        ...collectWorkflowDescendants(
          entry.childWorkflowInstanceId ?? entry.blockId,
          workflowChildGroups,
          visited
        )
      )
    }
  }
  return result
}

/**
 * Builds a tree structure from flat entries.
 * Groups iteration entries by (iterationType, iterationContainerId, iterationCurrent), showing all blocks
 * that executed within each iteration.
 * Sorts by start time to ensure chronological order.
 */
function buildEntryTree(entries: ConsoleEntry[]): EntryNode[] {
  // Separate entries into three buckets:
  // 1. Iteration entries (loop/parallel children)
  // 2. Workflow child entries (blocks inside a child workflow)
  // 3. Regular blocks
  const regularBlocks: ConsoleEntry[] = []
  const iterationEntries: ConsoleEntry[] = []
  const workflowChildEntries: ConsoleEntry[] = []

  for (const entry of entries) {
    if (entry.childWorkflowBlockId) {
      // Child workflow entries take priority over iteration classification
      workflowChildEntries.push(entry)
    } else if (entry.iterationType && entry.iterationCurrent !== undefined) {
      iterationEntries.push(entry)
    } else {
      regularBlocks.push(entry)
    }
  }

  // Group workflow child entries by the parent workflow block ID
  const workflowChildGroups = new Map<string, ConsoleEntry[]>()
  for (const entry of workflowChildEntries) {
    const parentId = entry.childWorkflowBlockId!
    const group = workflowChildGroups.get(parentId)
    if (group) {
      group.push(entry)
    } else {
      workflowChildGroups.set(parentId, [entry])
    }
  }

  // Group iteration entries by (iterationType, iterationContainerId, iterationCurrent)
  const iterationGroupsMap = new Map<string, IterationGroup>()
  for (const entry of iterationEntries) {
    const iterationContainerId = entry.iterationContainerId || 'unknown'
    const key = `${entry.iterationType}-${iterationContainerId}-${entry.iterationCurrent}`
    let group = iterationGroupsMap.get(key)
    const entryStartMs = new Date(entry.startedAt || entry.timestamp).getTime()

    if (!group) {
      group = {
        iterationType: entry.iterationType!,
        iterationContainerId,
        iterationCurrent: entry.iterationCurrent!,
        iterationTotal: entry.iterationTotal,
        blocks: [],
        startTimeMs: entryStartMs,
      }
      iterationGroupsMap.set(key, group)
    } else {
      // Update start time to earliest
      if (entryStartMs < group.startTimeMs) {
        group.startTimeMs = entryStartMs
      }
      // Update total if available
      if (entry.iterationTotal !== undefined) {
        group.iterationTotal = entry.iterationTotal
      }
    }
    group.blocks.push(entry)
  }

  // Sort blocks within each iteration by executionOrder ascending (oldest first, top-down)
  for (const group of iterationGroupsMap.values()) {
    group.blocks.sort((a, b) => a.executionOrder - b.executionOrder)
  }

  // Group iterations by (iterationType, iterationContainerId) to create subflow parents
  const subflowGroups = new Map<
    string,
    { iterationType: string; iterationContainerId: string; groups: IterationGroup[] }
  >()
  for (const group of iterationGroupsMap.values()) {
    const key = `${group.iterationType}-${group.iterationContainerId}`
    let subflowGroup = subflowGroups.get(key)
    if (!subflowGroup) {
      subflowGroup = {
        iterationType: group.iterationType,
        iterationContainerId: group.iterationContainerId,
        groups: [],
      }
      subflowGroups.set(key, subflowGroup)
    }
    subflowGroup.groups.push(group)
  }

  // Sort iterations within each subflow by iteration number
  for (const subflowGroup of subflowGroups.values()) {
    subflowGroup.groups.sort((a, b) => a.iterationCurrent - b.iterationCurrent)
  }

  // Build subflow nodes with iteration children
  const subflowNodes: EntryNode[] = []
  for (const subflowGroup of subflowGroups.values()) {
    const { iterationType, iterationContainerId, groups: iterationGroups } = subflowGroup
    // Calculate subflow timing from all its iterations
    const firstIteration = iterationGroups[0]
    const allBlocks = iterationGroups.flatMap((g) => g.blocks)
    const subflowStartMs = Math.min(
      ...allBlocks.map((b) => new Date(b.startedAt || b.timestamp).getTime())
    )
    const subflowEndMs = Math.max(
      ...allBlocks.map((b) => new Date(b.endedAt || b.timestamp).getTime())
    )
    const totalDuration = allBlocks.reduce((sum, b) => sum + (b.durationMs || 0), 0)
    // Parallel branches run concurrently — use wall-clock time. Loop iterations run serially — use sum.
    const subflowDuration =
      iterationType === 'parallel' ? subflowEndMs - subflowStartMs : totalDuration

    // Create synthetic subflow parent entry
    // Use the minimum executionOrder from all child blocks for proper ordering
    const subflowExecutionOrder = Math.min(...allBlocks.map((b) => b.executionOrder))
    const syntheticSubflow: ConsoleEntry = {
      id: `subflow-${iterationType}-${iterationContainerId}-${firstIteration.blocks[0]?.executionId || 'unknown'}`,
      timestamp: new Date(subflowStartMs).toISOString(),
      workflowId: firstIteration.blocks[0]?.workflowId || '',
      blockId: `${iterationType}-container-${iterationContainerId}`,
      blockName: iterationType.charAt(0).toUpperCase() + iterationType.slice(1),
      blockType: iterationType,
      executionId: firstIteration.blocks[0]?.executionId,
      startedAt: new Date(subflowStartMs).toISOString(),
      executionOrder: subflowExecutionOrder,
      endedAt: new Date(subflowEndMs).toISOString(),
      durationMs: subflowDuration,
      success: !allBlocks.some((b) => b.error),
    }

    // Build iteration child nodes
    const iterationNodes: EntryNode[] = iterationGroups.map((iterGroup) => {
      // Create synthetic iteration entry
      const iterBlocks = iterGroup.blocks
      const iterStartMs = Math.min(
        ...iterBlocks.map((b) => new Date(b.startedAt || b.timestamp).getTime())
      )
      const iterEndMs = Math.max(
        ...iterBlocks.map((b) => new Date(b.endedAt || b.timestamp).getTime())
      )
      const iterDuration = iterBlocks.reduce((sum, b) => sum + (b.durationMs || 0), 0)
      // Parallel branches run concurrently — use wall-clock time. Loop iterations run serially — use sum.
      const iterDisplayDuration =
        iterationType === 'parallel' ? iterEndMs - iterStartMs : iterDuration

      // Use the minimum executionOrder from blocks in this iteration
      const iterExecutionOrder = Math.min(...iterBlocks.map((b) => b.executionOrder))
      const syntheticIteration: ConsoleEntry = {
        id: `iteration-${iterationType}-${iterGroup.iterationContainerId}-${iterGroup.iterationCurrent}-${iterBlocks[0]?.executionId || 'unknown'}`,
        timestamp: new Date(iterStartMs).toISOString(),
        workflowId: iterBlocks[0]?.workflowId || '',
        blockId: `iteration-${iterGroup.iterationContainerId}-${iterGroup.iterationCurrent}`,
        blockName: `Iteration ${iterGroup.iterationCurrent}${iterGroup.iterationTotal !== undefined ? ` / ${iterGroup.iterationTotal}` : ''}`,
        blockType: iterationType,
        executionId: iterBlocks[0]?.executionId,
        startedAt: new Date(iterStartMs).toISOString(),
        executionOrder: iterExecutionOrder,
        endedAt: new Date(iterEndMs).toISOString(),
        durationMs: iterDisplayDuration,
        success: !iterBlocks.some((b) => b.error),
        iterationCurrent: iterGroup.iterationCurrent,
        iterationTotal: iterGroup.iterationTotal,
        iterationType: iterationType as 'loop' | 'parallel',
        iterationContainerId: iterGroup.iterationContainerId,
      }

      // Block nodes within this iteration — workflow blocks get their full subtree
      const blockNodes: EntryNode[] = iterBlocks.map((block) => {
        if (isWorkflowBlockType(block.blockType)) {
          const instanceKey = block.childWorkflowInstanceId ?? block.blockId
          const allDescendants = collectWorkflowDescendants(instanceKey, workflowChildGroups)
          const rawChildren = allDescendants.map((c) => ({
            ...c,
            childWorkflowBlockId:
              c.childWorkflowBlockId === instanceKey ? undefined : c.childWorkflowBlockId,
          }))
          return {
            entry: block,
            children: buildEntryTree(rawChildren),
            nodeType: 'workflow' as const,
          }
        }
        return { entry: block, children: [], nodeType: 'block' as const }
      })

      return {
        entry: syntheticIteration,
        children: blockNodes,
        nodeType: 'iteration' as const,
        iterationInfo: {
          current: iterGroup.iterationCurrent,
          total: iterGroup.iterationTotal,
        },
      }
    })

    subflowNodes.push({
      entry: syntheticSubflow,
      children: iterationNodes,
      nodeType: 'subflow' as const,
    })
  }

  // Build workflow nodes for regular blocks that are workflow block types
  const workflowNodes: EntryNode[] = []
  const remainingRegularBlocks: ConsoleEntry[] = []

  for (const block of regularBlocks) {
    if (isWorkflowBlockType(block.blockType)) {
      const instanceKey = block.childWorkflowInstanceId ?? block.blockId
      const allDescendants = collectWorkflowDescendants(instanceKey, workflowChildGroups)
      const rawChildren = allDescendants.map((c) => ({
        ...c,
        childWorkflowBlockId:
          c.childWorkflowBlockId === instanceKey ? undefined : c.childWorkflowBlockId,
      }))
      const children = buildEntryTree(rawChildren)
      workflowNodes.push({ entry: block, children, nodeType: 'workflow' as const })
    } else {
      remainingRegularBlocks.push(block)
    }
  }

  // Build nodes for remaining regular blocks
  const regularNodes: EntryNode[] = remainingRegularBlocks.map((entry) => ({
    entry,
    children: [],
    nodeType: 'block' as const,
  }))

  // Combine all nodes and sort by executionOrder ascending (oldest first, top-down)
  const allNodes = [...subflowNodes, ...workflowNodes, ...regularNodes]
  allNodes.sort((a, b) => a.entry.executionOrder - b.entry.executionOrder)
  return allNodes
}

/**
 * Recursively collects IDs of all nodes that should be auto-expanded.
 * Includes subflow, iteration, and workflow nodes that have children.
 */
export function collectExpandableNodeIds(nodes: EntryNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (
      (node.nodeType === 'subflow' ||
        node.nodeType === 'iteration' ||
        node.nodeType === 'workflow') &&
      node.children.length > 0
    ) {
      ids.push(node.entry.id)
    }
    if (node.children.length > 0) {
      ids.push(...collectExpandableNodeIds(node.children))
    }
  }
  return ids
}

/**
 * Groups console entries by execution ID and builds a tree structure.
 * Pre-computes timestamps for efficient sorting.
 */
export function groupEntriesByExecution(entries: ConsoleEntry[]): ExecutionGroup[] {
  const groups = new Map<
    string,
    { meta: Omit<ExecutionGroup, 'entryTree'>; entries: ConsoleEntry[] }
  >()

  for (const entry of entries) {
    const execId = entry.executionId || entry.id

    const entryStartTime = entry.startedAt || entry.timestamp
    const entryEndTime = entry.endedAt || entry.timestamp
    const entryStartMs = new Date(entryStartTime).getTime()
    const entryEndMs = new Date(entryEndTime).getTime()

    let group = groups.get(execId)

    if (!group) {
      group = {
        meta: {
          executionId: execId,
          startTime: entryStartTime,
          endTime: entryEndTime,
          startTimeMs: entryStartMs,
          endTimeMs: entryEndMs,
          duration: 0,
          status: 'success',
          entries: [],
        },
        entries: [],
      }
      groups.set(execId, group)
    } else {
      // Update timing bounds
      if (entryStartMs < group.meta.startTimeMs) {
        group.meta.startTime = entryStartTime
        group.meta.startTimeMs = entryStartMs
      }
      if (entryEndMs > group.meta.endTimeMs) {
        group.meta.endTime = entryEndTime
        group.meta.endTimeMs = entryEndMs
      }
    }

    // Check for errors
    if (entry.error) {
      group.meta.status = 'error'
    }

    group.entries.push(entry)
  }

  // Build tree structure for each group
  const result: ExecutionGroup[] = []
  for (const group of groups.values()) {
    group.meta.duration = group.meta.endTimeMs - group.meta.startTimeMs
    group.meta.entries = group.entries
    result.push({
      ...group.meta,
      entryTree: buildEntryTree(group.entries),
    })
  }

  // Sort by start time descending (newest first)
  result.sort((a, b) => b.startTimeMs - a.startTimeMs)

  return result
}

/**
 * Flattens entry tree into display order for keyboard navigation
 */
export function flattenEntryTree(nodes: EntryNode[]): ConsoleEntry[] {
  const result: ConsoleEntry[] = []
  for (const node of nodes) {
    result.push(node.entry)
    if (node.children.length > 0) {
      result.push(...flattenEntryTree(node.children))
    }
  }
  return result
}

/**
 * Block entry with parent tracking for navigation
 */
export interface NavigableBlockEntry {
  entry: ConsoleEntry
  executionId: string
  /** IDs of parent nodes (subflows, iterations) that contain this block */
  parentNodeIds: string[]
}

/**
 * Flattens entry tree to only include actual block entries (not subflows/iterations).
 * Also tracks parent node IDs for auto-expanding when navigating.
 */
export function flattenBlockEntriesOnly(
  nodes: EntryNode[],
  executionId: string,
  parentIds: string[] = []
): NavigableBlockEntry[] {
  const result: NavigableBlockEntry[] = []
  for (const node of nodes) {
    if (node.nodeType === 'block' || node.nodeType === 'workflow') {
      result.push({
        entry: node.entry,
        executionId,
        parentNodeIds: parentIds,
      })
    }
    if (node.children.length > 0) {
      const newParentIds = node.nodeType !== 'block' ? [...parentIds, node.entry.id] : parentIds
      result.push(...flattenBlockEntriesOnly(node.children, executionId, newParentIds))
    }
  }
  return result
}

/**
 * Terminal height configuration constants
 */
export const TERMINAL_CONFIG = {
  NEAR_MIN_THRESHOLD: 40,
  BLOCK_COLUMN_WIDTH_PX: TERMINAL_BLOCK_COLUMN_WIDTH,
  HEADER_TEXT_CLASS: 'font-medium text-[var(--text-tertiary)] text-[12px]',
} as const
