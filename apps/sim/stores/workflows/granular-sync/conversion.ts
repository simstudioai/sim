/**
 * Conversion utilities between legacy workflow format and granular format
 */

import { createLogger } from '@/lib/logs/console-logger'
import type { BlockState } from '../workflow/types'
import type {
  ConversionResult,
  GranularWorkflowEdge,
  GranularWorkflowLoop,
  GranularWorkflowNode,
  GranularWorkflowParallel,
  LegacyWorkflowState,
} from './types'

const logger = createLogger('GranularConversion')

/**
 * Converts legacy workflow state to granular format
 */
export function convertLegacyToGranular(
  workflowId: string,
  legacyState: LegacyWorkflowState,
  userId?: string
): ConversionResult {
  const now = new Date()

  // Convert blocks to nodes
  const nodes: GranularWorkflowNode[] = Object.entries(legacyState.blocks || {}).map(
    ([id, block]) => {
      const blockState = block as BlockState

      return {
        id,
        workflowId,
        type: blockState.type,
        name: blockState.name,
        positionX: Math.round(blockState.position.x),
        positionY: Math.round(blockState.position.y),
        subBlocks: blockState.subBlocks || {},
        outputs: blockState.outputs || {},
        enabled: blockState.enabled ?? true,
        horizontalHandles: blockState.horizontalHandles,
        isWide: blockState.isWide,
        height: blockState.height,
        advancedMode: blockState.advancedMode,
        data: blockState.data || {},
        parentId: blockState.data?.parentId,
        extent: blockState.data?.extent,
        version: 1,
        lastModified: now,
        modifiedBy: userId,
      }
    }
  )

  // Convert edges
  const edges: GranularWorkflowEdge[] = (legacyState.edges || []).map((edge) => ({
    id: edge.id,
    workflowId,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type || 'default',
    animated: edge.animated || false,
    style: edge.style || {},
    data: edge.data || {},
    version: 1,
    lastModified: now,
    modifiedBy: userId,
  }))

  // Convert loops
  const loops: GranularWorkflowLoop[] = Object.entries(legacyState.loops || {}).map(
    ([id, loop]) => ({
      id,
      workflowId,
      nodes: loop.nodes || [],
      iterations: loop.iterations || 1,
      loopType: loop.loopType || 'for',
      forEachItems: loop.forEachItems,
      executionState: loop.executionState || {},
      version: 1,
      lastModified: now,
      modifiedBy: userId,
    })
  )

  // Convert parallels
  const parallels: GranularWorkflowParallel[] = Object.entries(legacyState.parallels || {}).map(
    ([id, parallel]) => ({
      id,
      workflowId,
      nodes: parallel.nodes || [],
      distribution: parallel.distribution,
      executionState: parallel.executionState || {},
      version: 1,
      lastModified: now,
      modifiedBy: userId,
    })
  )

  logger.info(`Converted legacy workflow ${workflowId}:`, {
    nodes: nodes.length,
    edges: edges.length,
    loops: loops.length,
    parallels: parallels.length,
  })

  return { nodes, edges, loops, parallels }
}

/**
 * Converts granular format back to legacy workflow state
 */
export function convertGranularToLegacy(
  nodes: GranularWorkflowNode[],
  edges: GranularWorkflowEdge[],
  loops: GranularWorkflowLoop[],
  parallels: GranularWorkflowParallel[],
  metadata?: Partial<LegacyWorkflowState>
): LegacyWorkflowState {
  // Convert nodes back to blocks
  const blocks: Record<string, BlockState> = {}
  nodes.forEach((node) => {
    blocks[node.id] = {
      id: node.id,
      type: node.type,
      name: node.name,
      position: {
        x: node.positionX,
        y: node.positionY,
      },
      subBlocks: node.subBlocks,
      outputs: node.outputs,
      enabled: node.enabled,
      horizontalHandles: node.horizontalHandles,
      isWide: node.isWide,
      height: node.height,
      advancedMode: node.advancedMode,
      data: {
        ...node.data,
        parentId: node.parentId,
        extent: node.extent,
      },
    }
  })

  // Convert edges
  const legacyEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }))

  // Convert loops
  const legacyLoops: Record<string, any> = {}
  loops.forEach((loop) => {
    legacyLoops[loop.id] = {
      id: loop.id,
      nodes: loop.nodes,
      iterations: loop.iterations,
      loopType: loop.loopType,
      forEachItems: loop.forEachItems,
      executionState: loop.executionState,
    }
  })

  // Convert parallels
  const legacyParallels: Record<string, any> = {}
  parallels.forEach((parallel) => {
    legacyParallels[parallel.id] = {
      id: parallel.id,
      nodes: parallel.nodes,
      distribution: parallel.distribution,
      executionState: parallel.executionState,
    }
  })

  return {
    blocks,
    edges: legacyEdges,
    loops: legacyLoops,
    parallels: legacyParallels,
    lastSaved: Date.now(),
    lastUpdate: Date.now(),
    ...metadata,
  }
}

/**
 * Merges granular changes with existing legacy state
 * Useful for hybrid mode during migration
 */
export function mergeGranularChangesWithLegacy(
  legacyState: LegacyWorkflowState,
  granularChanges: Partial<ConversionResult>
): LegacyWorkflowState {
  const updatedState = { ...legacyState }

  // If we have granular changes, merge them
  if (
    granularChanges.nodes ||
    granularChanges.edges ||
    granularChanges.loops ||
    granularChanges.parallels
  ) {
    const converted = convertGranularToLegacy(
      granularChanges.nodes || [],
      granularChanges.edges || [],
      granularChanges.loops || [],
      granularChanges.parallels || [],
      legacyState
    )

    // Merge blocks (nodes)
    if (granularChanges.nodes) {
      updatedState.blocks = { ...updatedState.blocks, ...converted.blocks }
    }

    // Merge edges
    if (granularChanges.edges) {
      const existingEdgeIds = new Set((updatedState.edges || []).map((e) => e.id))
      const newEdges = converted.edges.filter((e) => !existingEdgeIds.has(e.id))
      updatedState.edges = [...(updatedState.edges || []), ...newEdges]
    }

    // Merge loops
    if (granularChanges.loops) {
      updatedState.loops = { ...updatedState.loops, ...converted.loops }
    }

    // Merge parallels
    if (granularChanges.parallels) {
      updatedState.parallels = { ...updatedState.parallels, ...converted.parallels }
    }

    updatedState.lastUpdate = Date.now()
  }

  return updatedState
}

/**
 * Detects differences between two workflow states
 * Returns what changed for efficient syncing
 */
export function detectChanges(
  oldState: ConversionResult,
  newState: ConversionResult
): {
  nodes: { created: GranularWorkflowNode[]; updated: GranularWorkflowNode[]; deleted: string[] }
  edges: { created: GranularWorkflowEdge[]; updated: GranularWorkflowEdge[]; deleted: string[] }
  loops: { created: GranularWorkflowLoop[]; updated: GranularWorkflowLoop[]; deleted: string[] }
  parallels: {
    created: GranularWorkflowParallel[]
    updated: GranularWorkflowParallel[]
    deleted: string[]
  }
} {
  // Helper function to detect entity changes
  function detectEntityChanges<T extends { id: string; version: number; lastModified: Date }>(
    oldEntities: T[],
    newEntities: T[]
  ): { created: T[]; updated: T[]; deleted: string[] } {
    const oldMap = new Map(oldEntities.map((e) => [e.id, e]))
    const newMap = new Map(newEntities.map((e) => [e.id, e]))

    const created: T[] = []
    const updated: T[] = []
    const deleted: string[] = []

    // Find created and updated entities
    for (const [id, newEntity] of newMap) {
      const oldEntity = oldMap.get(id)
      if (!oldEntity) {
        created.push(newEntity)
      } else if (
        newEntity.version > oldEntity.version ||
        newEntity.lastModified > oldEntity.lastModified
      ) {
        updated.push(newEntity)
      }
    }

    // Find deleted entities
    for (const [id] of oldMap) {
      if (!newMap.has(id)) {
        deleted.push(id)
      }
    }

    return { created, updated, deleted }
  }

  return {
    nodes: detectEntityChanges(oldState.nodes, newState.nodes),
    edges: detectEntityChanges(oldState.edges, newState.edges),
    loops: detectEntityChanges(oldState.loops, newState.loops),
    parallels: detectEntityChanges(oldState.parallels, newState.parallels),
  }
}

/**
 * Validates granular workflow data integrity
 */
export function validateGranularData(data: ConversionResult): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for orphaned edges (edges pointing to non-existent nodes)
  const nodeIds = new Set(data.nodes.map((n) => n.id))
  data.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} has invalid source node: ${edge.source}`)
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} has invalid target node: ${edge.target}`)
    }
  })

  // Check for orphaned loop/parallel nodes
  const allConstructs = [...data.loops, ...data.parallels]
  allConstructs.forEach((construct) => {
    construct.nodes.forEach((nodeId: string) => {
      if (!nodeIds.has(nodeId)) {
        errors.push(`${construct.id} references non-existent node: ${nodeId}`)
      }
    })
  })

  // Check for duplicate IDs
  const allIds = [
    ...data.nodes.map((n) => n.id),
    ...data.edges.map((e) => e.id),
    ...data.loops.map((l) => l.id),
    ...data.parallels.map((p) => p.id),
  ]
  const uniqueIds = new Set(allIds)
  if (allIds.length !== uniqueIds.size) {
    errors.push('Duplicate IDs found in workflow data')
  }

  // Check for missing required fields
  data.nodes.forEach((node) => {
    if (!node.name || !node.type) {
      errors.push(`Node ${node.id} is missing required fields (name or type)`)
    }
  })

  // Warnings for potentially problematic data
  if (data.nodes.length === 0) {
    warnings.push('Workflow has no nodes')
  }

  if (data.edges.length === 0 && data.nodes.length > 1) {
    warnings.push('Workflow has multiple nodes but no edges')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}
