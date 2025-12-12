import { load as yamlParse } from 'js-yaml'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks'
import {
  type ConnectionsFormat,
  expandConditionInputs,
  type ImportedEdge,
  parseBlockConnections,
  validateBlockReferences,
  validateBlockStructure,
} from '@/stores/workflows/yaml/parsing-utils'

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

  // Precompute counts that are used in validations to avoid O(n^2) checks
  const apiTriggerCount = Object.values(yamlWorkflow.blocks).filter(
    (b) => b.type === 'api_trigger'
  ).length

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

  // Enforce only one API trigger in YAML (single check outside the loop)
  if (apiTriggerCount > 1) {
    errors.push('Only one API trigger is allowed per workflow (YAML contains multiple).')
  }

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

  // First pass: position all blocks as if they're root level
  layers.forEach((layer, layerIndex) => {
    const layerX = startX + layerIndex * horizontalSpacing

    layer.forEach((blockId, blockIndex) => {
      const blockY = startY + (blockIndex - layer.length / 2) * verticalSpacing
      positions[blockId] = { x: layerX, y: blockY }
    })
  })

  // Second pass: adjust positions for child blocks to be relative to their parent
  Object.entries(yamlWorkflow.blocks).forEach(([blockId, block]) => {
    if (block.parentId && positions[blockId] && positions[block.parentId]) {
      // Convert absolute position to relative position within parent
      const parentPos = positions[block.parentId]
      const childPos = positions[blockId]

      // Calculate relative position inside the parent container
      // Start child blocks at a reasonable offset inside the parent
      positions[blockId] = {
        x: 50 + (childPos.x - parentPos.x) * 0.3, // Scale down and offset
        y: 100 + (childPos.y - parentPos.y) * 0.3, // Scale down and offset
      }
    }
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
      const inputs = yamlBlock.inputs || {}

      // Apply defaults for loop blocks
      if (yamlBlock.type === 'loop') {
        importedBlock.data = {
          width: 500,
          height: 300,
          type: 'subflowNode',
          loopType: inputs.loopType || 'for',
          count: inputs.iterations || inputs.count || 5,
          collection: inputs.collection || '',
          maxConcurrency: inputs.maxConcurrency || 1,
          // Include any other inputs provided
          ...inputs,
        }
      } else {
        // Parallel blocks
        importedBlock.data = {
          width: 500,
          height: 300,
          type: 'subflowNode',
          ...inputs,
        }
      }

      // Clear inputs since they're now in data
      importedBlock.inputs = {}
    }

    // Handle parent-child relationships for nested blocks
    if (yamlBlock.parentId) {
      importedBlock.parentId = yamlBlock.parentId
      importedBlock.extent = 'parent' // Always 'parent' when parentId exists
      // Also add to data for consistency with how the system works
      if (!importedBlock.data) {
        importedBlock.data = {}
      }
      importedBlock.data.parentId = yamlBlock.parentId
      importedBlock.data.extent = 'parent' // Always 'parent' when parentId exists
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
      const newId = uuidv4()
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
