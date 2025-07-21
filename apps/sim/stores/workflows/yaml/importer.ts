import { load as yamlParse } from 'js-yaml'
import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import {
  type ConnectionsFormat,
  expandConditionInputs,
  type ImportedEdge,
  parseBlockConnections,
  validateBlockReferences,
  validateBlockStructure,
} from './parsing-utils'

const logger = createLogger('WorkflowYamlImporter')

interface YamlBlock {
  type: string
  name: string
  inputs?: Record<string, any>
  connections?: ConnectionsFormat
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
    const data = yamlParse(yamlContent) as unknown

    // Validate top-level structure
    if (!data || typeof data !== 'object') {
      errors.push('Invalid YAML: Root must be an object')
      return { data: null, errors }
    }

    // Type guard to check if data has the expected structure
    const parsedData = data as Record<string, unknown>

    if (!parsedData.version) {
      errors.push('Missing required field: version')
    }

    if (!parsedData.blocks || typeof parsedData.blocks !== 'object') {
      errors.push('Missing or invalid field: blocks')
      return { data: null, errors }
    }

    // Validate blocks structure
    const blocks = parsedData.blocks as Record<string, unknown>
    Object.entries(blocks).forEach(([blockId, block]: [string, unknown]) => {
      if (!block || typeof block !== 'object') {
        errors.push(`Invalid block definition for '${blockId}': must be an object`)
        return
      }

      const blockData = block as Record<string, unknown>

      if (!blockData.type || typeof blockData.type !== 'string') {
        errors.push(`Invalid block '${blockId}': missing or invalid 'type' field`)
      }

      if (!blockData.name || typeof blockData.name !== 'string') {
        errors.push(`Invalid block '${blockId}': missing or invalid 'name' field`)
      }

      if (blockData.inputs && typeof blockData.inputs !== 'object') {
        errors.push(`Invalid block '${blockId}': 'inputs' must be an object`)
      }

      if (blockData.preceding && !Array.isArray(blockData.preceding)) {
        errors.push(`Invalid block '${blockId}': 'preceding' must be an array`)
      }

      if (blockData.following && !Array.isArray(blockData.following)) {
        errors.push(`Invalid block '${blockId}': 'following' must be an array`)
      }
    })

    if (errors.length > 0) {
      return { data: null, errors }
    }

    return { data: parsedData as unknown as YamlWorkflow, errors: [] }
  } catch (error) {
    errors.push(`YAML parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { data: null, errors }
  }
}

/**
 * Validate that block types exist and are valid
 */
function validateBlockTypes(yamlWorkflow: YamlWorkflow): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]) => {
    // Use shared structure validation
    const { errors: structureErrors, warnings: structureWarnings } = validateBlockStructure(
      blockId,
      block
    )
    errors.push(...structureErrors)
    warnings.push(...structureWarnings)

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
  const referenceErrors = validateBlockReferences(yamlWorkflow.blocks)
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

    // Expand condition inputs from clean format to internal format
    const processedInputs =
      yamlBlock.type === 'condition'
        ? expandConditionInputs(blockId, yamlBlock.inputs || {})
        : yamlBlock.inputs || {}

    const importedBlock: ImportedBlock = {
      id: blockId,
      type: yamlBlock.type,
      name: yamlBlock.name,
      inputs: processedInputs,
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

  // Convert edges from connections using shared parser
  Object.entries(yamlWorkflow.blocks).forEach(([blockId, yamlBlock]) => {
    const {
      edges: blockEdges,
      errors: connectionErrors,
      warnings: connectionWarnings,
    } = parseBlockConnections(blockId, yamlBlock.connections, yamlBlock.type)

    edges.push(...blockEdges)
    errors.push(...connectionErrors)
    warnings.push(...connectionWarnings)
  })

  // Sort blocks to ensure parents are created before children
  const sortedBlocks = sortBlocksByParentChildOrder(blocks)

  return { blocks: sortedBlocks, edges, errors, warnings }
}

/**
 * Create smart ID mapping that preserves existing block IDs and generates new ones for new blocks
 */
function createSmartIdMapping(
  yamlBlocks: ImportedBlock[],
  existingBlocks: Record<string, any>,
  activeWorkflowId: string,
  forceNewIds = false
): Map<string, string> {
  const yamlIdToActualId = new Map<string, string>()
  const existingBlockIds = new Set(Object.keys(existingBlocks))

  logger.info('Creating smart ID mapping', {
    activeWorkflowId,
    yamlBlockCount: yamlBlocks.length,
    existingBlockCount: Object.keys(existingBlocks).length,
    existingBlockIds: Array.from(existingBlockIds),
    yamlBlockIds: yamlBlocks.map((b) => b.id),
    forceNewIds,
  })

  for (const block of yamlBlocks) {
    if (forceNewIds || !existingBlockIds.has(block.id)) {
      // Force new ID or block ID doesn't exist in current workflow - generate new UUID
      const newId = crypto.randomUUID()
      yamlIdToActualId.set(block.id, newId)
      logger.info(
        `🆕 Mapping new block: ${block.id} -> ${newId} (${forceNewIds ? 'forced new ID' : `not found in workflow ${activeWorkflowId}`})`
      )
    } else {
      // Block ID exists in current workflow - preserve it
      yamlIdToActualId.set(block.id, block.id)
      logger.info(
        `✅ Preserving existing block ID: ${block.id} (exists in workflow ${activeWorkflowId})`
      )
    }
  }

  logger.info('Smart ID mapping completed', {
    mappings: Array.from(yamlIdToActualId.entries()),
    preservedCount: Array.from(yamlIdToActualId.entries()).filter(([old, new_]) => old === new_)
      .length,
    newCount: Array.from(yamlIdToActualId.entries()).filter(([old, new_]) => old !== new_).length,
  })

  return yamlIdToActualId
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
    addEdge: (edge: Edge) => void
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

    // For YAML editor case: reconcile starter blocks to avoid duplicates
    let processedWorkflow = yamlWorkflow
    if (!targetWorkflowId) {
      const existingBlocks = workflowActions.getExistingBlocks()

      // Find starter blocks in YAML
      const yamlStarterEntries = Object.entries(yamlWorkflow.blocks).filter(
        ([_, block]) => block.type === 'starter'
      )

      // Find existing starter block
      const existingStarterEntry = Object.entries(existingBlocks).find(
        ([_, block]) => block.type === 'starter'
      )
      const existingStarterId = existingStarterEntry?.[0]

      // If we have starter blocks in YAML, reconcile them
      if (yamlStarterEntries.length > 0) {
        const targetStarterId = existingStarterId || yamlStarterEntries[0][0]

        // Merge all YAML starter properties
        const mergedInputs = {}
        const mergedConnections = {}
        let mergedName = 'Start'

        yamlStarterEntries.forEach(([_, starterBlock]) => {
          Object.assign(mergedInputs, starterBlock.inputs || {})
          Object.assign(mergedConnections, starterBlock.connections || {})
          if (starterBlock.name && starterBlock.name !== 'Start') {
            mergedName = starterBlock.name
          }
        })

        // Create reconciled blocks
        const reconciledBlocks = { ...yamlWorkflow.blocks }

        // Remove all YAML starter blocks
        yamlStarterEntries.forEach(([starterId]) => {
          delete reconciledBlocks[starterId]
        })

        // Add merged starter with target ID
        reconciledBlocks[targetStarterId] = {
          type: 'starter',
          name: mergedName,
          inputs: mergedInputs,
          connections: mergedConnections,
        }

        // Update connections that pointed to removed starters
        const removedStarterIds = yamlStarterEntries
          .map(([id]) => id)
          .filter((id) => id !== targetStarterId)

        if (removedStarterIds.length > 0) {
          Object.entries(reconciledBlocks).forEach(([blockId, block]) => {
            if (block.connections) {
              const updateConnections = (connections: any): any => {
                if (typeof connections === 'string') {
                  return removedStarterIds.includes(connections) ? targetStarterId : connections
                }
                if (Array.isArray(connections)) {
                  return connections.map((conn) =>
                    removedStarterIds.includes(conn) ? targetStarterId : conn
                  )
                }
                if (typeof connections === 'object' && connections !== null) {
                  const updated: any = {}
                  Object.entries(connections).forEach(([key, value]) => {
                    updated[key] = updateConnections(value)
                  })
                  return updated
                }
                return connections
              }

              reconciledBlocks[blockId] = {
                ...block,
                connections: updateConnections(block.connections),
              }
            }
          })
        }

        processedWorkflow = {
          ...yamlWorkflow,
          blocks: reconciledBlocks,
        }
      }
    }

    // Convert to importable format
    const { blocks, edges, errors, warnings } = convertYamlToWorkflow(processedWorkflow)

    if (errors.length > 0) {
      return { success: false, errors, warnings }
    }

    // Get current workflow state and ID
    const currentWorkflowState = useWorkflowStore.getState()
    const activeWorkflowId = targetWorkflowId || useWorkflowRegistry.getState().activeWorkflowId

    if (!activeWorkflowId) {
      return { success: false, errors: ['No active workflow'], warnings: [] }
    }

    logger.info('Starting YAML import', {
      activeWorkflowId,
      targetWorkflowId,
      yamlBlockCount: blocks.length,
      currentStateBlockCount: Object.keys(currentWorkflowState.blocks).length,
    })

    // Handle two different cases:
    // 1. Import button (targetWorkflowId provided): Everything should be fresh, no preservation
    // 2. Text editor (no targetWorkflowId): Clean workflow except for start block, repurpose start block

    let existingBlocks: Record<string, any> = {}
    let yamlIdToActualId: Map<string, string>

    if (targetWorkflowId) {
      // Import button case: Create everything fresh with new IDs
      logger.info('Import button case: Creating everything fresh with new IDs')
      yamlIdToActualId = new Map()
      for (const block of blocks) {
        const newId = crypto.randomUUID()
        yamlIdToActualId.set(block.id, newId)
        logger.debug(`Import: ${block.id} -> ${newId}`)
      }
    } else {
      // Text editor case: Clean workflow except for start block, use smart ID mapping for start block only
      logger.info(
        'Text editor case: Cleaning workflow except for start block, repurposing start block'
      )
      existingBlocks = workflowActions.getExistingBlocks()

      // Find existing starter block
      const existingStarterEntry = Object.entries(existingBlocks).find(
        ([_, block]) => block.type === 'starter'
      )
      const existingStarterId = existingStarterEntry?.[0]

      logger.info(
        `Got existing blocks from workflow store for active workflow ${activeWorkflowId}`,
        {
          blockCount: Object.keys(existingBlocks).length,
          blockIds: Object.keys(existingBlocks),
          existingStarterId,
        }
      )

      // Create ID mapping - preserve only the starter block ID, generate new IDs for everything else
      yamlIdToActualId = new Map()
      for (const block of blocks) {
        if (block.type === 'starter' && existingStarterId) {
          // Preserve existing starter block ID
          yamlIdToActualId.set(block.id, existingStarterId)
          logger.info(`Preserving existing starter block ID: ${block.id} -> ${existingStarterId}`)
        } else {
          // Generate new ID for all other blocks
          const newId = crypto.randomUUID()
          yamlIdToActualId.set(block.id, newId)
          logger.debug(`Creating new block: ${block.id} -> ${newId}`)
        }
      }
    }

    // Build complete blocks object
    const completeBlocks: Record<string, any> = {}
    const completeSubBlockValues: Record<string, Record<string, any>> = {}

    // For both import and YAML editor cases: Only create blocks from YAML, no preservation
    // This is the key change - YAML editor now behaves like import in terms of cleaning the workflow

    // Process blocks from YAML - these will replace all existing blocks
    for (const block of blocks) {
      const actualId = yamlIdToActualId.get(block.id)
      if (!actualId) {
        logger.warn(`No ID mapping found for block: ${block.id}`)
        continue
      }

      const blockConfig = getBlock(block.type)

      if (!blockConfig && (block.type === 'loop' || block.type === 'parallel')) {
        // Handle loop/parallel blocks
        completeBlocks[actualId] = {
          id: actualId,
          type: block.type,
          name: block.name,
          position: block.position,
          subBlocks: {},
          outputs: {},
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          data: block.data || {},
        }
        logger.debug(`Processed loop/parallel block: ${block.id} -> ${actualId}`)
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

        // Also ensure we have subBlocks for any YAML inputs that might not be in the config
        // This handles cases where hidden fields or dynamic configurations exist
        Object.keys(block.inputs).forEach((inputKey) => {
          if (!subBlocks[inputKey]) {
            subBlocks[inputKey] = {
              id: inputKey,
              type: 'short-input', // Default type for dynamic inputs
              value: null,
            }
          }
        })

        completeBlocks[actualId] = {
          id: actualId,
          type: block.type,
          name: block.name,
          position: block.position,
          subBlocks,
          outputs: resolveOutputType(blockConfig.outputs),
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          data: block.data || {},
        }

        // Set block input values from YAML
        completeSubBlockValues[actualId] = { ...block.inputs }
        logger.debug(`Processed regular block: ${block.id} -> ${actualId}`)
      } else {
        logger.warn(`No block config found for type: ${block.type} (block: ${block.id})`)
      }
    }

    // Update parent-child relationships with mapped IDs
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

    // Handle edges based on the use case
    const completeEdges: any[] = []

    // For both import and YAML editor cases: Only create edges from YAML, no preservation
    // This ensures clean workflow state for both cases
    logger.info('Creating only YAML edges, no preservation')
    for (const edge of edges) {
      const sourceId = yamlIdToActualId.get(edge.source)
      const targetId = yamlIdToActualId.get(edge.target)

      if (sourceId && targetId) {
        const newEdgeId = crypto.randomUUID()
        const newEdge = {
          ...edge,
          id: newEdgeId,
          source: sourceId,
          target: targetId,
        }
        logger.debug(`Creating YAML edge: ${edge.source} -> ${edge.target} with ID ${newEdgeId}`)
        completeEdges.push(newEdge)
      } else {
        logger.warn(`Skipping edge - missing blocks: ${edge.source} -> ${edge.target}`)
      }
    }

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
      hasActiveWebhook: false,
    }

    logger.info('Final workflow state created', {
      totalBlocks: Object.keys(completeBlocks).length,
      totalEdges: completeEdges.length,
      blockIds: Object.keys(completeBlocks),
    })

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

    // Apply auto layout
    workflowActions.applyAutoLayout()

    // Calculate summary for YAML editor case
    const totalBlocksInWorkflow = Object.keys(completeBlocks).length
    const starterBlocksCount = Object.values(completeBlocks).filter(
      (b: any) => b.type === 'starter'
    ).length
    const newBlocksCount = totalBlocksInWorkflow - starterBlocksCount

    return {
      success: true,
      errors: [],
      warnings,
      summary: `Successfully replaced workflow with ${blocks.length} blocks from YAML. Workflow now has ${totalBlocksInWorkflow} blocks (${starterBlocksCount} starter, ${newBlocksCount} new) and ${completeEdges.length} connections.`,
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
