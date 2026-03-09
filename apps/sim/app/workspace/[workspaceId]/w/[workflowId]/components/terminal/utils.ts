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
  workflow: '#8b5cf6',
} as const

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
    return SUBFLOW_COLORS.workflow
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
export function buildEntryTree(entries: ConsoleEntry[], idPrefix = ''): EntryNode[] {
  const regularBlocks: ConsoleEntry[] = []
  const topLevelIterationEntries: ConsoleEntry[] = []
  const nestedIterationEntries: ConsoleEntry[] = []
  const workflowChildEntries: ConsoleEntry[] = []

  for (const entry of entries) {
    if (entry.childWorkflowBlockId) {
      workflowChildEntries.push(entry)
    } else if (entry.iterationType && entry.iterationCurrent !== undefined) {
      if (entry.parentIterations && entry.parentIterations.length > 0) {
        nestedIterationEntries.push(entry)
      } else {
        topLevelIterationEntries.push(entry)
      }
    } else {
      regularBlocks.push(entry)
    }
  }

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

  const iterationGroupsMap = new Map<string, IterationGroup>()
  for (const entry of topLevelIterationEntries) {
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
      if (entryStartMs < group.startTimeMs) {
        group.startTimeMs = entryStartMs
      }
      if (entry.iterationTotal !== undefined) {
        group.iterationTotal = entry.iterationTotal
      }
    }
    group.blocks.push(entry)
  }

  for (const group of iterationGroupsMap.values()) {
    group.blocks.sort((a, b) => a.executionOrder - b.executionOrder)
  }

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

  for (const subflowGroup of subflowGroups.values()) {
    subflowGroup.groups.sort((a, b) => a.iterationCurrent - b.iterationCurrent)
  }

  // Create synthetic parent subflow groups for orphaned nested iteration entries.
  // Nested subflow containers (e.g., inner parallel inside outer parallel) may not
  // have store entries if no block:started event was emitted for them. Without a
  // parent subflow group, their child entries would be silently dropped from the tree.
  // Check at the iteration level (not container level) so that existing iterations
  // from topLevelIterationEntries don't block synthetic creation for other iterations
  // of the same container (e.g., loop iterations 1-4 when iteration 0 already exists).
  const syntheticIterations = new Map<string, IterationGroup>()
  for (const entry of nestedIterationEntries) {
    const parent = entry.parentIterations?.[0]
    if (!parent?.iterationContainerId) {
      continue
    }

    // Only skip if this specific iteration already has a group from topLevelIterationEntries
    const iterKey = `${parent.iterationType}-${parent.iterationContainerId}-${parent.iterationCurrent}`
    if (iterationGroupsMap.has(iterKey)) {
      continue
    }

    const entryMs = new Date(entry.startedAt || entry.timestamp).getTime()
    if (!syntheticIterations.has(iterKey)) {
      syntheticIterations.set(iterKey, {
        iterationType: parent.iterationType!,
        iterationContainerId: parent.iterationContainerId!,
        iterationCurrent: parent.iterationCurrent!,
        iterationTotal: parent.iterationTotal,
        blocks: [],
        startTimeMs: entryMs,
      })
    } else {
      const existing = syntheticIterations.get(iterKey)!
      if (entryMs < existing.startTimeMs) {
        existing.startTimeMs = entryMs
      }
    }
  }

  const syntheticSubflows = new Map<
    string,
    { iterationType: string; iterationContainerId: string; groups: IterationGroup[] }
  >()
  for (const iterGroup of syntheticIterations.values()) {
    const subflowKey = `${iterGroup.iterationType}-${iterGroup.iterationContainerId}`
    let subflow = syntheticSubflows.get(subflowKey)
    if (!subflow) {
      subflow = {
        iterationType: iterGroup.iterationType,
        iterationContainerId: iterGroup.iterationContainerId,
        groups: [],
      }
      syntheticSubflows.set(subflowKey, subflow)
    }
    subflow.groups.push(iterGroup)
  }

  for (const subflow of syntheticSubflows.values()) {
    const key = `${subflow.iterationType}-${subflow.iterationContainerId}`
    const existing = subflowGroups.get(key)
    if (existing) {
      // Merge synthetic iteration groups into the existing subflow group
      existing.groups.push(...subflow.groups)
      existing.groups.sort((a, b) => a.iterationCurrent - b.iterationCurrent)
    } else {
      subflow.groups.sort((a, b) => a.iterationCurrent - b.iterationCurrent)
      subflowGroups.set(key, subflow)
    }
  }

  const subflowNodes: EntryNode[] = []
  for (const subflowGroup of subflowGroups.values()) {
    const { iterationType, iterationContainerId, groups: iterationGroups } = subflowGroup

    const nestedForThisSubflow = nestedIterationEntries.filter((e) => {
      const parent = e.parentIterations?.[0]
      return parent && parent.iterationContainerId === iterationContainerId
    })

    const allDirectBlocks = iterationGroups.flatMap((g) => g.blocks)
    const allRelevantBlocks = [...allDirectBlocks, ...nestedForThisSubflow]
    if (allRelevantBlocks.length === 0) continue

    const timestamps = allRelevantBlocks.map((b) => new Date(b.startedAt || b.timestamp).getTime())
    const subflowStartMs = Math.min(...timestamps)
    const subflowEndMs = Math.max(
      ...allRelevantBlocks.map((b) => new Date(b.endedAt || b.timestamp).getTime())
    )
    const totalDuration = allRelevantBlocks.reduce((sum, b) => sum + (b.durationMs || 0), 0)
    const subflowDuration =
      iterationType === 'parallel' ? subflowEndMs - subflowStartMs : totalDuration

    const subflowExecutionOrder = Math.min(...allRelevantBlocks.map((b) => b.executionOrder))
    const metadataSource = allRelevantBlocks[0]
    const syntheticSubflow: ConsoleEntry = {
      id: `${idPrefix}subflow-${iterationType}-${iterationContainerId}-${metadataSource.executionId || 'unknown'}`,
      timestamp: new Date(subflowStartMs).toISOString(),
      workflowId: metadataSource.workflowId || '',
      blockId: `${iterationType}-container-${iterationContainerId}`,
      blockName: iterationType.charAt(0).toUpperCase() + iterationType.slice(1),
      blockType: iterationType,
      executionId: metadataSource.executionId,
      startedAt: new Date(subflowStartMs).toISOString(),
      executionOrder: subflowExecutionOrder,
      endedAt: new Date(subflowEndMs).toISOString(),
      durationMs: subflowDuration,
      success: !allRelevantBlocks.some((b) => b.error),
      iterationContainerId,
    }

    const iterationNodes: EntryNode[] = iterationGroups
      .map((iterGroup): EntryNode | null => {
        const matchingNestedEntries = nestedForThisSubflow.filter((e) => {
          const parent = e.parentIterations?.[0]
          return parent?.iterationCurrent === iterGroup.iterationCurrent
        })

        const strippedNestedEntries: ConsoleEntry[] = matchingNestedEntries.map((e) => ({
          ...e,
          parentIterations:
            e.parentIterations && e.parentIterations.length > 1
              ? e.parentIterations.slice(1)
              : undefined,
        }))

        const iterBlocks = iterGroup.blocks
        const allIterEntries = [...iterBlocks, ...strippedNestedEntries]
        if (allIterEntries.length === 0) return null

        const iterStartMs = Math.min(
          ...allIterEntries.map((b) => new Date(b.startedAt || b.timestamp).getTime())
        )
        const iterEndMs = Math.max(
          ...allIterEntries.map((b) => new Date(b.endedAt || b.timestamp).getTime())
        )
        const iterDuration = allIterEntries.reduce((sum, b) => sum + (b.durationMs || 0), 0)
        const iterDisplayDuration =
          iterationType === 'parallel' ? iterEndMs - iterStartMs : iterDuration

        const iterExecutionOrder = Math.min(...allIterEntries.map((b) => b.executionOrder))
        const iterMetadataSource = allIterEntries[0]
        const syntheticIteration: ConsoleEntry = {
          id: `${idPrefix}iteration-${iterationType}-${iterGroup.iterationContainerId}-${iterGroup.iterationCurrent}-${iterMetadataSource.executionId || 'unknown'}`,
          timestamp: new Date(iterStartMs).toISOString(),
          workflowId: iterMetadataSource.workflowId || '',
          blockId: `iteration-${iterGroup.iterationContainerId}-${iterGroup.iterationCurrent}`,
          blockName: `Iteration ${iterGroup.iterationCurrent}${iterGroup.iterationTotal !== undefined ? ` / ${iterGroup.iterationTotal}` : ''}`,
          blockType: iterationType,
          executionId: iterMetadataSource.executionId,
          startedAt: new Date(iterStartMs).toISOString(),
          executionOrder: iterExecutionOrder,
          endedAt: new Date(iterEndMs).toISOString(),
          durationMs: iterDisplayDuration,
          success: !allIterEntries.some((b) => b.error),
          iterationCurrent: iterGroup.iterationCurrent,
          iterationTotal: iterGroup.iterationTotal,
          iterationType: iterationType as 'loop' | 'parallel',
          iterationContainerId: iterGroup.iterationContainerId,
        }

        const childPrefix = `${idPrefix}${iterationContainerId}-${iterGroup.iterationCurrent}-`
        const nestedSubflowNodes =
          strippedNestedEntries.length > 0 ? buildEntryTree(strippedNestedEntries, childPrefix) : []

        // Filter out container completion events when matching nested subflow nodes exist,
        // to avoid duplicating them as both a flat block row and an expandable subflow.
        const hasNestedSubflows = nestedSubflowNodes.length > 0
        const blockNodes: EntryNode[] = iterBlocks
          .filter((block) => {
            if (
              hasNestedSubflows &&
              (block.blockType === 'loop' || block.blockType === 'parallel')
            ) {
              return false
            }
            return true
          })
          .map((block) => {
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

        const allChildren = [...blockNodes, ...nestedSubflowNodes]
        allChildren.sort((a, b) => a.entry.executionOrder - b.entry.executionOrder)

        return {
          entry: syntheticIteration,
          children: allChildren,
          nodeType: 'iteration' as const,
          iterationInfo: {
            current: iterGroup.iterationCurrent,
            total: iterGroup.iterationTotal,
          },
        }
      })
      .filter((node): node is EntryNode => node !== null)

    subflowNodes.push({
      entry: syntheticSubflow,
      children: iterationNodes,
      nodeType: 'subflow' as const,
    })
  }

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

  const regularNodes: EntryNode[] = remainingRegularBlocks.map((entry) => ({
    entry,
    children: [],
    nodeType: 'block' as const,
  }))

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
