import { load as yamlParse } from 'js-yaml'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'

const logger = createLogger('WorkflowYamlImporter')

interface YamlBlock {
  type: string
  name: string
  inputs?: Record<string, any>
  connections?: {
    incoming?: Array<{
      source: string
      sourceHandle?: string
      targetHandle?: string
    }>
    outgoing?: Array<{
      target: string
      sourceHandle?: string
      targetHandle?: string
    }>
  }
  parentId?: string // Add parentId for nested blocks
}

interface YamlWorkflow {
  version: string
  blocks: Record<string, YamlBlock>
}

interface ImportedBlock {
  id: string
  type: string
  name: string
  inputs: Record<string, any>
  position: { x: number; y: number }
  data?: Record<string, any>
  parentId?: string
  extent?: 'parent'
}

interface ImportedEdge {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  type: string
}

interface ImportResult {
  blocks: ImportedBlock[]
  edges: ImportedEdge[]
  errors: string[]
  warnings: string[]
}

/**
 * Parse YAML content and validate its structure
 */
export function parseWorkflowYaml(yamlContent: string): {
  data: YamlWorkflow | null
  errors: string[]
} {
  const errors: string[] = []

  try {
    const data = yamlParse(yamlContent) as any

    // Validate top-level structure
    if (!data || typeof data !== 'object') {
      errors.push('Invalid YAML: Root must be an object')
      return { data: null, errors }
    }

    if (!data.version) {
      errors.push('Missing required field: version')
    }

    if (!data.blocks || typeof data.blocks !== 'object') {
      errors.push('Missing or invalid field: blocks')
      return { data: null, errors }
    }

    // Validate blocks structure
    Object.entries(data.blocks).forEach(([blockId, block]: [string, any]) => {
      if (!block || typeof block !== 'object') {
        errors.push(`Invalid block definition for '${blockId}': must be an object`)
        return
      }

      if (!block.type || typeof block.type !== 'string') {
        errors.push(`Invalid block '${blockId}': missing or invalid 'type' field`)
      }

      if (!block.name || typeof block.name !== 'string') {
        errors.push(`Invalid block '${blockId}': missing or invalid 'name' field`)
      }

      if (block.inputs && typeof block.inputs !== 'object') {
        errors.push(`Invalid block '${blockId}': 'inputs' must be an object`)
      }

      if (block.preceding && !Array.isArray(block.preceding)) {
        errors.push(`Invalid block '${blockId}': 'preceding' must be an array`)
      }

      if (block.following && !Array.isArray(block.following)) {
        errors.push(`Invalid block '${blockId}': 'following' must be an array`)
      }
    })

    if (errors.length > 0) {
      return { data: null, errors }
    }

    return { data: data as YamlWorkflow, errors: [] }
  } catch (error) {
    errors.push(`YAML parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { data: null, errors }
  }
}

/**
 * Validate that block references in connections exist
 */
function validateBlockReferences(yamlWorkflow: YamlWorkflow): string[] {
  const errors: string[] = []
  const blockIds = new Set(Object.keys(yamlWorkflow.blocks))

  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]) => {
    // Check incoming connection references
    if (block.connections?.incoming) {
      block.connections.incoming.forEach((connection) => {
        if (!blockIds.has(connection.source)) {
          errors.push(
            `Block '${blockId}' references non-existent source block '${connection.source}'`
          )
        }
      })
    }

    // Check outgoing connection references
    if (block.connections?.outgoing) {
      block.connections.outgoing.forEach((connection) => {
        if (!blockIds.has(connection.target)) {
          errors.push(
            `Block '${blockId}' references non-existent target block '${connection.target}'`
          )
        }
      })
    }

    // Check parent references
    if (block.parentId && !blockIds.has(block.parentId)) {
      errors.push(`Block '${blockId}' references non-existent parent block '${block.parentId}'`)
    }
  })

  return errors
}

/**
 * Validate that block types exist and are valid
 */
function validateBlockTypes(yamlWorkflow: YamlWorkflow): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]) => {
    // Check if block type exists
    const blockConfig = getBlock(block.type)

    // Special handling for container blocks
    if (block.type === 'loop' || block.type === 'parallel') {
      // These are valid container types
      return
    }

    if (!blockConfig) {
      errors.push(`Unknown block type '${block.type}' for block '${blockId}'`)
      return
    }

    // Validate inputs against block configuration
    if (block.inputs && blockConfig.subBlocks) {
      Object.keys(block.inputs).forEach((inputKey) => {
        const subBlockConfig = blockConfig.subBlocks.find((sb) => sb.id === inputKey)
        if (!subBlockConfig) {
          warnings.push(
            `Block '${blockId}' has unknown input '${inputKey}' for type '${block.type}'`
          )
        }
      })
    }
  })

  return { errors, warnings }
}

/**
 * Calculate positions for blocks based on their connections
 * Uses a simple layered approach similar to the auto-layout algorithm
 */
function calculateBlockPositions(
  yamlWorkflow: YamlWorkflow
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  const blockIds = Object.keys(yamlWorkflow.blocks)

  // Find starter blocks (no incoming connections)
  const starterBlocks = blockIds.filter((id) => {
    const block = yamlWorkflow.blocks[id]
    return !block.connections?.incoming || block.connections.incoming.length === 0
  })

  // If no starter blocks found, use first block as starter
  if (starterBlocks.length === 0 && blockIds.length > 0) {
    starterBlocks.push(blockIds[0])
  }

  // Build layers
  const layers: string[][] = []
  const visited = new Set<string>()
  const queue = [...starterBlocks]

  // BFS to organize blocks into layers
  while (queue.length > 0) {
    const currentLayer: string[] = []
    const currentLayerSize = queue.length

    for (let i = 0; i < currentLayerSize; i++) {
      const blockId = queue.shift()!
      if (visited.has(blockId)) continue

      visited.add(blockId)
      currentLayer.push(blockId)

      // Add following blocks to queue
      const block = yamlWorkflow.blocks[blockId]
      if (block.connections?.outgoing) {
        block.connections.outgoing.forEach((connection) => {
          if (!visited.has(connection.target)) {
            queue.push(connection.target)
          }
        })
      }
    }

    if (currentLayer.length > 0) {
      layers.push(currentLayer)
    }
  }

  // Add any remaining blocks as isolated layer
  const remainingBlocks = blockIds.filter((id) => !visited.has(id))
  if (remainingBlocks.length > 0) {
    layers.push(remainingBlocks)
  }

  // Calculate positions
  const horizontalSpacing = 600
  const verticalSpacing = 200
  const startX = 150
  const startY = 300

  layers.forEach((layer, layerIndex) => {
    const layerX = startX + layerIndex * horizontalSpacing

    layer.forEach((blockId, blockIndex) => {
      const blockY = startY + (blockIndex - layer.length / 2) * verticalSpacing
      positions[blockId] = { x: layerX, y: blockY }
    })
  })

  return positions
}

/**
 * Sort blocks to ensure parents are processed before children
 * This ensures proper creation order for nested blocks
 */
function sortBlocksByParentChildOrder(blocks: ImportedBlock[]): ImportedBlock[] {
  const sorted: ImportedBlock[] = []
  const processed = new Set<string>()
  const visiting = new Set<string>() // Track blocks currently being processed to detect cycles

  // Create a map for quick lookup
  const blockMap = new Map<string, ImportedBlock>()
  blocks.forEach((block) => blockMap.set(block.id, block))

  // Process blocks recursively, ensuring parents are added first
  function processBlock(block: ImportedBlock) {
    if (processed.has(block.id)) {
      return // Already processed
    }

    if (visiting.has(block.id)) {
      // Circular dependency detected - break the cycle by processing this block without its parent
      logger.warn(`Circular parent-child dependency detected for block ${block.id}, breaking cycle`)
      sorted.push(block)
      processed.add(block.id)
      return
    }

    visiting.add(block.id)

    // If this block has a parent, ensure the parent is processed first
    if (block.parentId) {
      const parentBlock = blockMap.get(block.parentId)
      if (parentBlock && !processed.has(block.parentId)) {
        processBlock(parentBlock)
      }
    }

    // Now process this block
    visiting.delete(block.id)
    sorted.push(block)
    processed.add(block.id)
  }

  // Process all blocks
  blocks.forEach((block) => processBlock(block))

  return sorted
}

/**
 * Convert YAML workflow to importable format
 */
export function convertYamlToWorkflow(yamlWorkflow: YamlWorkflow): ImportResult {
  const errors: string[] = []
  const warnings: string[] = []
  const blocks: ImportedBlock[] = []
  const edges: ImportedEdge[] = []

  // Validate block references
  const referenceErrors = validateBlockReferences(yamlWorkflow)
  errors.push(...referenceErrors)

  // Validate block types
  const { errors: typeErrors, warnings: typeWarnings } = validateBlockTypes(yamlWorkflow)
  errors.push(...typeErrors)
  warnings.push(...typeWarnings)

  if (errors.length > 0) {
    return { blocks: [], edges: [], errors, warnings }
  }

  // Calculate positions
  const positions = calculateBlockPositions(yamlWorkflow)

  // Convert blocks
  Object.entries(yamlWorkflow.blocks).forEach(([blockId, yamlBlock]) => {
    const position = positions[blockId] || { x: 100, y: 100 }

    const importedBlock: ImportedBlock = {
      id: blockId,
      type: yamlBlock.type,
      name: yamlBlock.name,
      inputs: yamlBlock.inputs || {},
      position,
    }

    // Add container-specific data
    if (yamlBlock.type === 'loop' || yamlBlock.type === 'parallel') {
      // For loop/parallel blocks, map the inputs to the data field since they don't use subBlocks
      importedBlock.data = {
        width: 500,
        height: 300,
        type: yamlBlock.type === 'loop' ? 'loopNode' : 'parallelNode',
        // Map YAML inputs to data properties for loop/parallel blocks
        ...(yamlBlock.inputs || {}),
      }
      // Clear inputs since they're now in data
      importedBlock.inputs = {}
    }

    // Handle parent-child relationships for nested blocks
    if (yamlBlock.parentId) {
      importedBlock.parentId = yamlBlock.parentId
      importedBlock.extent = 'parent'
      // Also add to data for consistency with how the system works
      if (!importedBlock.data) {
        importedBlock.data = {}
      }
      importedBlock.data.parentId = yamlBlock.parentId
      importedBlock.data.extent = 'parent'
    }

    blocks.push(importedBlock)
  })

  // Convert edges from connections
  Object.entries(yamlWorkflow.blocks).forEach(([blockId, yamlBlock]) => {
    if (yamlBlock.connections?.outgoing) {
      yamlBlock.connections.outgoing.forEach((connection) => {
        const edgeId = `${blockId}-${connection.target}-${Date.now()}`

        const edge: ImportedEdge = {
          id: edgeId,
          source: blockId,
          target: connection.target,
          sourceHandle: connection.sourceHandle || 'source',
          targetHandle: connection.targetHandle || 'target',
          type: 'workflowEdge',
        }

        edges.push(edge)
      })
    }
  })

  // Sort blocks to ensure parents are created before children
  const sortedBlocks = sortBlocksByParentChildOrder(blocks)

  return { blocks: sortedBlocks, edges, errors, warnings }
}

/**
 * Import workflow from YAML by creating complete state upfront (no UI simulation)
 */
export async function importWorkflowFromYaml(
  yamlContent: string,
  workflowActions: {
    addBlock: (
      id: string,
      type: string,
      name: string,
      position: { x: number; y: number },
      data?: Record<string, any>,
      parentId?: string,
      extent?: 'parent'
    ) => void
    addEdge: (edge: any) => void
    applyAutoLayout: () => void
    setSubBlockValue: (blockId: string, subBlockId: string, value: any) => void
    getExistingBlocks: () => Record<string, any>
  },
  targetWorkflowId?: string
): Promise<{ success: boolean; errors: string[]; warnings: string[]; summary?: string }> {
  try {
    // Parse YAML
    const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

    if (!yamlWorkflow || parseErrors.length > 0) {
      return { success: false, errors: parseErrors, warnings: [] }
    }

    // Convert to importable format
    const { blocks, edges, errors, warnings } = convertYamlToWorkflow(yamlWorkflow)

    if (errors.length > 0) {
      return { success: false, errors, warnings }
    }

    // Get the existing workflow state (to preserve starter blocks if they exist)
    let existingBlocks: Record<string, any> = {}

    if (targetWorkflowId) {
      // For target workflow, fetch from API
      try {
        const response = await fetch(`/api/workflows/${targetWorkflowId}`)
        if (response.ok) {
          const workflowData = await response.json()
          existingBlocks = workflowData.data?.state?.blocks || {}
        }
      } catch (error) {
        logger.warn(`Failed to fetch existing blocks for workflow ${targetWorkflowId}:`, error)
      }
    } else {
      // For active workflow, use from store
      existingBlocks = workflowActions.getExistingBlocks()
    }

    const existingStarterBlocks = Object.values(existingBlocks).filter(
      (block: any) => block.type === 'starter'
    )

    // Get stores and current workflow info
    const { useWorkflowStore } = require('@/stores/workflows/workflow/store')
    const { useSubBlockStore } = require('@/stores/workflows/subblock/store')
    const { useWorkflowRegistry } = require('@/stores/workflows/registry/store')

    // Get current workflow state
    const currentWorkflowState = useWorkflowStore.getState()
    const activeWorkflowId = targetWorkflowId || useWorkflowRegistry.getState().activeWorkflowId

    if (!activeWorkflowId) {
      return { success: false, errors: ['No active workflow'], warnings: [] }
    }

    // Build complete blocks object
    const completeBlocks: Record<string, any> = {}
    const completeSubBlockValues: Record<string, Record<string, any>> = {}
    const yamlIdToActualId = new Map<string, string>()

    // Handle starter block
    let starterBlockId: string | null = null
    const starterBlock = blocks.find((block) => block.type === 'starter')

    if (starterBlock) {
      if (existingStarterBlocks.length > 0) {
        // Use existing starter block
        const existingStarter = existingStarterBlocks[0] as any
        starterBlockId = existingStarter.id
        yamlIdToActualId.set(starterBlock.id, existingStarter.id)

        // Keep existing starter but update its inputs
        completeBlocks[existingStarter.id] = {
          ...existingStarter,
          // Update name if provided in YAML
          name: starterBlock.name !== 'Start' ? starterBlock.name : existingStarter.name,
        }

        // Set starter block values
        completeSubBlockValues[existingStarter.id] = {
          ...(currentWorkflowState.blocks[existingStarter.id]?.subBlocks
            ? Object.fromEntries(
                Object.entries(currentWorkflowState.blocks[existingStarter.id].subBlocks).map(
                  ([key, subBlock]: [string, any]) => [key, subBlock.value]
                )
              )
            : {}),
          ...starterBlock.inputs, // Override with YAML values
        }
      } else {
        // Create new starter block
        starterBlockId = crypto.randomUUID()
        yamlIdToActualId.set(starterBlock.id, starterBlockId)

        // Create complete starter block from block config
        const blockConfig = getBlock('starter')
        if (blockConfig) {
          const subBlocks: Record<string, any> = {}
          blockConfig.subBlocks.forEach((subBlock) => {
            subBlocks[subBlock.id] = {
              id: subBlock.id,
              type: subBlock.type,
              value: null,
            }
          })

          completeBlocks[starterBlockId] = {
            id: starterBlockId,
            type: 'starter',
            name: starterBlock.name,
            position: starterBlock.position,
            subBlocks,
            outputs: resolveOutputType(blockConfig.outputs),
            enabled: true,
            horizontalHandles: true,
            isWide: false,
            height: 0,
            data: starterBlock.data || {},
          }

          // Set starter block values
          completeSubBlockValues[starterBlockId] = { ...starterBlock.inputs }
        }
      }
    }

    // Create all other blocks
    // Note: blocks are now sorted to ensure parents come before children,
    // but we still need the two-phase approach because we're generating new UUIDs
    let blocksProcessed = 0
    for (const block of blocks) {
      if (block.type === 'starter') {
        continue // Already handled above
      }

      const blockId = crypto.randomUUID()
      yamlIdToActualId.set(block.id, blockId)

      // Create complete block from block config
      const blockConfig = getBlock(block.type)

      if (!blockConfig && (block.type === 'loop' || block.type === 'parallel')) {
        // Handle loop/parallel blocks
        completeBlocks[blockId] = {
          id: blockId,
          type: block.type,
          name: block.name,
          position: block.position,
          subBlocks: {},
          outputs: {},
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          data: block.data || {}, // Configuration is already in block.data from convertYamlToWorkflow
        }

        // Loop/parallel blocks don't use subBlocks, their config is in data
        // No need to set completeSubBlockValues since they don't have subBlocks
        blocksProcessed++
      } else if (blockConfig) {
        // Handle regular blocks
        const subBlocks: Record<string, any> = {}
        blockConfig.subBlocks.forEach((subBlock) => {
          subBlocks[subBlock.id] = {
            id: subBlock.id,
            type: subBlock.type,
            value: null,
          }
        })

        completeBlocks[blockId] = {
          id: blockId,
          type: block.type,
          name: block.name,
          position: block.position,
          subBlocks,
          outputs: resolveOutputType(blockConfig.outputs),
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          data: block.data || {}, // This already includes parentId and extent from convertYamlToWorkflow
        }

        // Set block input values
        completeSubBlockValues[blockId] = { ...block.inputs }
        blocksProcessed++
      } else {
        logger.warn(`No block config found for type: ${block.type} (block: ${block.id})`)
      }
    }

    // Update parent-child relationships with mapped IDs
    // This two-phase approach is necessary because:
    // 1. We generate new UUIDs for all blocks (can't reuse YAML IDs)
    // 2. Parent references in YAML use the original IDs, need to map to new UUIDs
    // 3. All blocks must exist before we can map their parent references
    for (const [blockId, blockData] of Object.entries(completeBlocks)) {
      if (blockData.data?.parentId) {
        const mappedParentId = yamlIdToActualId.get(blockData.data.parentId)
        if (mappedParentId) {
          blockData.data.parentId = mappedParentId
        } else {
          logger.warn(`Parent block not found for mapping: ${blockData.data.parentId}`)
          // Remove invalid parent reference
          blockData.data.parentId = undefined
          blockData.data.extent = undefined
        }
      }
    }

    // Create complete edges using the ID mapping
    const completeEdges: any[] = []
    for (const edge of edges) {
      const sourceId = yamlIdToActualId.get(edge.source)
      const targetId = yamlIdToActualId.get(edge.target)

      if (sourceId && targetId) {
        completeEdges.push({
          ...edge,
          source: sourceId,
          target: targetId,
        })
      } else {
        logger.warn(`Skipping edge - missing blocks: ${edge.source} -> ${edge.target}`)
      }
    }

    // Create complete workflow state with values already set in subBlocks

    // Merge subblock values directly into block subBlocks
    for (const [blockId, blockData] of Object.entries(completeBlocks)) {
      const blockValues = completeSubBlockValues[blockId] || {}

      // Update subBlock values in place
      for (const [subBlockId, subBlockData] of Object.entries(blockData.subBlocks || {})) {
        if (blockValues[subBlockId] !== undefined && blockValues[subBlockId] !== null) {
          ;(subBlockData as any).value = blockValues[subBlockId]
        }
      }
    }

    // Create final workflow state
    const completeWorkflowState = {
      blocks: completeBlocks,
      edges: completeEdges,
      loops: {},
      parallels: {},
      lastSaved: Date.now(),
      isDeployed: false,
      deployedAt: undefined,
      deploymentStatuses: {},
      hasActiveSchedule: false,
      hasActiveWebhook: false,
    }

    // Save directly to database via API
    const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(completeWorkflowState),
    })

    if (!response.ok) {
      const errorData = await response.json()
      logger.error('Failed to save workflow state:', errorData.error)
      return {
        success: false,
        errors: [`Database save failed: ${errorData.error || 'Unknown error'}`],
        warnings,
      }
    }

    const saveResponse = await response.json()

    // Update local state for immediate UI display (only if importing into active workflow)
    if (!targetWorkflowId) {
      useWorkflowStore.setState(completeWorkflowState)

      // Set subblock values in local store
      useSubBlockStore.setState((state: any) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: completeSubBlockValues,
        },
      }))
    }

    // Brief delay for UI to update
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Apply auto layout
    workflowActions.applyAutoLayout()

    const totalBlocksCreated =
      Object.keys(completeBlocks).length - (existingStarterBlocks.length > 0 ? 1 : 0)

    return {
      success: true,
      errors: [],
      warnings,
      summary: `Imported ${totalBlocksCreated} new blocks and ${completeEdges.length} connections. ${
        existingStarterBlocks.length > 0
          ? 'Updated existing starter block.'
          : 'Created new starter block.'
      }`,
    }
  } catch (error) {
    logger.error('YAML import failed:', error)
    return {
      success: false,
      errors: [`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      warnings: [],
    }
  }
}
