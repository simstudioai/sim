import { load as yamlParse } from 'js-yaml'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'

const logger = createLogger('WorkflowYamlImporter')

interface YamlBlock {
  type: string
  name: string
  inputs?: Record<string, any>
  preceding?: string[]
  following?: string[]
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
export function parseWorkflowYaml(yamlContent: string): { data: YamlWorkflow | null; errors: string[] } {
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
    // Check preceding references
    if (block.preceding) {
      block.preceding.forEach(precedingId => {
        if (!blockIds.has(precedingId)) {
          errors.push(`Block '${blockId}' references non-existent preceding block '${precedingId}'`)
        }
      })
    }
    
    // Check following references
    if (block.following) {
      block.following.forEach(followingId => {
        if (!blockIds.has(followingId)) {
          errors.push(`Block '${blockId}' references non-existent following block '${followingId}'`)
        }
      })
    }
  })
  
  return errors
}

/**
 * Validate that block types exist and are valid
 */
function validateBlockTypes(yamlWorkflow: YamlWorkflow): { errors: string[], warnings: string[] } {
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
      Object.keys(block.inputs).forEach(inputKey => {
        const subBlockConfig = blockConfig.subBlocks.find(sb => sb.id === inputKey)
        if (!subBlockConfig) {
          warnings.push(`Block '${blockId}' has unknown input '${inputKey}' for type '${block.type}'`)
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
function calculateBlockPositions(yamlWorkflow: YamlWorkflow): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  const blockIds = Object.keys(yamlWorkflow.blocks)
  
  // Find starter blocks (no preceding connections)
  const starterBlocks = blockIds.filter(id => {
    const block = yamlWorkflow.blocks[id]
    return !block.preceding || block.preceding.length === 0
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
      if (block.following) {
        block.following.forEach(followingId => {
          if (!visited.has(followingId)) {
            queue.push(followingId)
          }
        })
      }
    }
    
    if (currentLayer.length > 0) {
      layers.push(currentLayer)
    }
  }
  
  // Add any remaining blocks as isolated layer
  const remainingBlocks = blockIds.filter(id => !visited.has(id))
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
      importedBlock.data = {
        width: 500,
        height: 300,
        type: yamlBlock.type === 'loop' ? 'loopNode' : 'parallelNode',
      }
    }
    
    blocks.push(importedBlock)
  })
  
  // Convert edges from connections
  Object.entries(yamlWorkflow.blocks).forEach(([blockId, yamlBlock]) => {
    if (yamlBlock.following) {
      yamlBlock.following.forEach(targetId => {
        const edgeId = `${blockId}-${targetId}-${Date.now()}`
        
        const edge: ImportedEdge = {
          id: edgeId,
          source: blockId,
          target: targetId,
          sourceHandle: 'source',
          targetHandle: 'target',
          type: 'workflowEdge',
        }
        
        edges.push(edge)
      })
    }
  })
  
  return { blocks, edges, errors, warnings }
}

/**
 * Import workflow from YAML and create blocks/edges using workflow functions
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
  }
): Promise<{ success: boolean; errors: string[]; warnings: string[]; summary?: string }> {
  logger.info('Starting YAML workflow import')
  
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
    
    logger.info(`Importing ${blocks.length} blocks and ${edges.length} edges`)
    
    // Check for existing blocks (new workflows already have a starter block)
    const existingBlocks = workflowActions.getExistingBlocks()
    const existingStarterBlocks = Object.values(existingBlocks).filter((block: any) => block.type === 'starter')
    
    let actualBlocksCreated = 0
    let starterBlockId: string | null = null
    
    // Create blocks, but handle starter blocks specially
    for (const block of blocks) {
      if (block.type === 'starter') {
        if (existingStarterBlocks.length > 0) {
          // Use existing starter block
          const existingStarter = existingStarterBlocks[0] as any
          starterBlockId = existingStarter.id
          logger.debug(`Using existing starter block: ${starterBlockId}`)
          
          // Update the starter block's inputs if needed
          Object.entries(block.inputs).forEach(([inputKey, inputValue]) => {
            if (inputValue !== undefined && inputValue !== null && starterBlockId !== null) {
              logger.debug(`Setting starter input: ${starterBlockId}.${inputKey} = ${inputValue}`)
              workflowActions.setSubBlockValue(starterBlockId, inputKey, inputValue)
            }
          })
        } else {
          // Create new starter block with generated ID (let the system generate it)
          const generatedId = crypto.randomUUID()
          starterBlockId = generatedId
          logger.debug(`Creating new starter block: ${generatedId}`)
          workflowActions.addBlock(
            generatedId,
            block.type,
            block.name,
            block.position,
            block.data,
            block.parentId,
            block.extent
          )
          actualBlocksCreated++
        }
      } else {
        // Create non-starter blocks with generated IDs to avoid conflicts
        const generatedId = crypto.randomUUID()
        logger.debug(`Creating block: ${generatedId} (${block.type}) originally ${block.id}`)
        workflowActions.addBlock(
          generatedId,
          block.type,
          block.name,
          block.position,
          block.data,
          block.parentId,
          block.extent
        )
        actualBlocksCreated++
        
        // Update edges to use the new generated ID
        edges.forEach(edge => {
          if (edge.source === block.id) {
            edge.source = generatedId
          }
          if (edge.target === block.id) {
            edge.target = generatedId
          }
        })
        
        // Store mapping for setting inputs later
        block.id = generatedId
      }
      
      // Update edges to use the starter block ID
      if (block.type === 'starter' && starterBlockId !== null) {
        const starterId = starterBlockId // TypeScript now knows this is string
        edges.forEach(edge => {
          if (edge.source === block.id) {
            edge.source = starterId
          }
          if (edge.target === block.id) {
            edge.target = starterId
          }
        })
      }
    }
    
    // Small delay to ensure blocks are created before adding edges
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Create edges
    let edgesCreated = 0
    for (const edge of edges) {
      try {
        logger.debug(`Creating edge: ${edge.source} -> ${edge.target}`)
        workflowActions.addEdge({
          ...edge,
          id: crypto.randomUUID() // Generate unique edge ID
        })
        edgesCreated++
      } catch (error) {
        logger.warn(`Failed to create edge ${edge.source} -> ${edge.target}:`, error)
        warnings.push(`Failed to create connection from ${edge.source} to ${edge.target}`)
      }
    }
    
    // Small delay before setting input values
    await new Promise(resolve => setTimeout(resolve, 200))
    
    // Set input values for non-starter blocks
    for (const block of blocks) {
      if (block.type !== 'starter') {
        Object.entries(block.inputs).forEach(([inputKey, inputValue]) => {
          if (inputValue !== undefined && inputValue !== null) {
            try {
              logger.debug(`Setting input: ${block.id}.${inputKey} = ${inputValue}`)
              workflowActions.setSubBlockValue(block.id, inputKey, inputValue)
            } catch (error) {
              logger.warn(`Failed to set input ${block.id}.${inputKey}:`, error)
              warnings.push(`Failed to set input ${inputKey} for block ${block.id}`)
            }
          }
        })
      }
    }
    
    // Apply auto layout after a delay
    setTimeout(() => {
      logger.debug('Applying auto layout')
      workflowActions.applyAutoLayout()
    }, 800)
    
    const summary = `Successfully imported ${actualBlocksCreated} new blocks and ${edgesCreated} connections`
    logger.info(summary)
    
    return {
      success: true,
      errors: [],
      warnings,
      summary
    }
    
  } catch (error) {
    const errorMessage = `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    logger.error(errorMessage, error)
    return {
      success: false,
      errors: [errorMessage],
      warnings: []
    }
  }
} 