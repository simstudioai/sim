import { load as yamlParse } from 'js-yaml'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'

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
    // Check preceding references
    if (block.preceding) {
      block.preceding.forEach((precedingId) => {
        if (!blockIds.has(precedingId)) {
          errors.push(`Block '${blockId}' references non-existent preceding block '${precedingId}'`)
        }
      })
    }

    // Check following references
    if (block.following) {
      block.following.forEach((followingId) => {
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

  // Find starter blocks (no preceding connections)
  const starterBlocks = blockIds.filter((id) => {
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
        block.following.forEach((followingId) => {
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
      yamlBlock.following.forEach((targetId) => {
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
  logger.info('Starting YAML workflow import (complete state creation)')

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

    logger.info(
      `Creating complete workflow state with ${blocks.length} blocks and ${edges.length} edges`
    )
    logger.debug(
      'Blocks to import:',
      blocks.map((b) => `${b.id} (${b.type}): ${b.name}`)
    )

    // Get the existing workflow state (to preserve starter blocks if they exist)
    let existingBlocks: Record<string, any> = {}

    if (targetWorkflowId) {
      // For target workflow, fetch from API
      try {
        const response = await fetch(`/api/workflows/${targetWorkflowId}`)
        if (response.ok) {
          const workflowData = await response.json()
          existingBlocks = workflowData.data?.state?.blocks || {}
          logger.debug(
            `Fetched existing blocks for target workflow ${targetWorkflowId}:`,
            Object.keys(existingBlocks)
          )
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
    logger.debug(`Found ${existingStarterBlocks.length} existing starter blocks`)

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

    logger.info(
      `Importing YAML into workflow: ${activeWorkflowId} ${targetWorkflowId ? '(specified target)' : '(active workflow)'}`
    )

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

        logger.debug(`Using existing starter block: ${existingStarter.id}`)
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

          logger.debug(`Created new starter block: ${starterBlockId}`)
        }
      }
    }

    // Create all other blocks
    let blocksProcessed = 0
    for (const block of blocks) {
      if (block.type === 'starter') {
        logger.debug(`Skipping starter block: ${block.id} (already handled)`)
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
          data: block.data || {},
        }

        completeSubBlockValues[blockId] = { ...block.inputs }
        blocksProcessed++
        logger.debug(`Prepared ${block.type} block: ${blockId} -> ${block.name}`)
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
          data: block.data || {},
        }

        // Set block input values
        completeSubBlockValues[blockId] = { ...block.inputs }
        blocksProcessed++
        logger.debug(`Prepared ${block.type} block: ${blockId} -> ${block.name}`)
      } else {
        logger.warn(`No block config found for type: ${block.type} (block: ${block.id})`)
      }
    }

    logger.info(
      `Processed ${blocksProcessed} non-starter blocks, total blocks in state: ${Object.keys(completeBlocks).length}`
    )

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
        logger.debug(`Prepared edge: ${sourceId} -> ${targetId}`)
      } else {
        logger.warn(`Skipping edge - missing blocks: ${edge.source} -> ${edge.target}`)
      }
    }

    // Create complete workflow state with values already set in subBlocks
    logger.info('Creating complete workflow state with embedded values...')

    // Merge subblock values directly into block subBlocks
    for (const [blockId, blockData] of Object.entries(completeBlocks)) {
      const blockValues = completeSubBlockValues[blockId] || {}

      // Update subBlock values in place
      for (const [subBlockId, subBlockData] of Object.entries(blockData.subBlocks || {})) {
        if (blockValues[subBlockId] !== undefined && blockValues[subBlockId] !== null) {
          ;(subBlockData as any).value = blockValues[subBlockId]
          logger.debug(
            `Embedded value in block: ${blockId}.${subBlockId} = ${blockValues[subBlockId]}`
          )
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
    logger.info('Saving complete workflow state directly to database...')
    logger.debug('Sample block being saved:', {
      firstBlockId: Object.keys(completeBlocks)[0],
      firstBlock: Object.values(completeBlocks)[0],
      firstBlockSubBlocks: Object.values(completeBlocks)[0]?.subBlocks,
    })

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
    logger.info('Successfully saved to database:', saveResponse)

    // Update local state for immediate UI display (only if importing into active workflow)
    if (!targetWorkflowId) {
      logger.info('Updating local state for immediate display (active workflow)...')
      useWorkflowStore.setState(completeWorkflowState)

      // Set subblock values in local store
      logger.debug('Setting SubBlockStore with values:', completeSubBlockValues)
      useSubBlockStore.setState((state: any) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: completeSubBlockValues,
        },
      }))

      // Verify SubBlockStore was updated
      const subBlockStoreValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
      logger.debug('SubBlockStore after update:', subBlockStoreValues)
    } else {
      logger.info('Skipping local state update (importing into non-active workflow)')
    }

    // Brief delay for UI to update
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Apply auto layout
    logger.info('Applying auto layout...')
    workflowActions.applyAutoLayout()

    const totalBlocksCreated =
      Object.keys(completeBlocks).length - (existingStarterBlocks.length > 0 ? 1 : 0)

    logger.info(
      `Successfully imported workflow: ${totalBlocksCreated} blocks created, ${completeEdges.length} edges, values set for ${Object.keys(completeSubBlockValues).length} blocks`
    )

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
