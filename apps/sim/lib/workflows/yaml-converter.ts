import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { generateWorkflowYaml } from '@/lib/workflows/yaml-generator'
import { getBlock } from '@/blocks'
import { resolveOutputType } from '@/blocks/utils'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { convertYamlToWorkflow, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'
import type { ImportedEdge } from '@/stores/workflows/yaml/parsing-utils'

// Define local types that aren't exported from importer
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

const logger = createLogger('YamlConverter')

/**
 * Unified YAML converter that handles all YAML<->WorkflowState conversions
 * This consolidates logic from multiple places to avoid duplication
 */

export interface YamlConversionResult {
  success: boolean
  workflowState?: WorkflowState
  errors: string[]
  warnings: string[]
  idMapping?: Map<string, string>
}

export interface WorkflowToYamlResult {
  success: boolean
  yaml?: string
  error?: string
}

/**
 * Convert YAML content to a complete WorkflowState
 * This consolidates logic from diff store, copilot store, and API routes
 */
export async function convertYamlToWorkflowState(
  yamlContent: string,
  options: {
    generateNewIds?: boolean
    existingBlocks?: Record<string, BlockState>
    preservePositions?: boolean
  } = {}
): Promise<YamlConversionResult> {
  const { generateNewIds = true, existingBlocks = {}, preservePositions = false } = options

  // Step 1: Parse YAML
  const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

  if (!yamlWorkflow || parseErrors.length > 0) {
    return {
      success: false,
      errors: parseErrors,
      warnings: [],
    }
  }

  // Step 2: Convert YAML to imported blocks/edges
  const { blocks, edges, errors: convertErrors, warnings } = convertYamlToWorkflow(yamlWorkflow)

  if (convertErrors.length > 0) {
    return {
      success: false,
      errors: convertErrors,
      warnings,
    }
  }

  // Step 3: Create ID mapping
  const idMapping = new Map<string, string>()

  if (generateNewIds) {
    blocks.forEach((block) => {
      const newId = uuidv4()
      idMapping.set(block.id, newId)
    })
  } else {
    // Use existing IDs
    blocks.forEach((block) => {
      idMapping.set(block.id, block.id)
    })
  }

  // Step 4: Build WorkflowState with proper block configuration
  const workflowBlocks: Record<string, BlockState> = {}

  // First pass: Update all parentIds in imported blocks before creating BlockStates
  blocks.forEach((importedBlock) => {
    if (importedBlock.parentId) {
      const mappedParentId = idMapping.get(importedBlock.parentId)
      if (mappedParentId) {
        logger.info(
          `Updating parentId for block ${importedBlock.id}: ${importedBlock.parentId} -> ${mappedParentId}`
        )
        importedBlock.parentId = mappedParentId
      } else {
        logger.warn(
          `Parent ID ${importedBlock.parentId} not found in ID mapping for block ${importedBlock.id}`
        )
      }
    }
  })

  // Second pass: Create the blocks
  for (const importedBlock of blocks) {
    const blockId = idMapping.get(importedBlock.id)!

    // Handle special blocks (loop/parallel)
    if (importedBlock.type === 'loop' || importedBlock.type === 'parallel') {
      workflowBlocks[blockId] = createContainerBlock(blockId, importedBlock)
      continue
    }

    // Get block configuration
    const blockConfig = getBlock(importedBlock.type)
    if (!blockConfig) {
      logger.warn(`Unknown block type: ${importedBlock.type}`)
      continue
    }

    // Create block with proper subBlocks
    workflowBlocks[blockId] = createRegularBlock(blockId, importedBlock, blockConfig)
  }

  // Step 5: Update block references in subblock values
  updateBlockReferences(workflowBlocks, idMapping)

  // Step 6: Create edges with mapped IDs
  const workflowEdges = edges.map((edge) => ({
    id: uuidv4(),
    source: idMapping.get(edge.source) || edge.source,
    target: idMapping.get(edge.target) || edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type || 'default',
  }))

  // Step 7: Generate loops and parallels
  const loops = generateLoopBlocks(workflowBlocks)
  const parallels = generateParallelBlocks(workflowBlocks)

  // Debug: Log parent-child relationships
  logger.info('=== Parent-Child Relationships ===')
  Object.values(workflowBlocks).forEach((block) => {
    const parentNode = (block as any).parentNode
    const parentId = block.data?.parentId
    if (parentNode || parentId) {
      logger.info(`Block ${block.id} (${block.name}):`, {
        parentNode,
        parentId,
        parentExists: parentNode ? !!workflowBlocks[parentNode] : 'N/A',
      })
    }
  })

  // Step 8: Create final WorkflowState
  const workflowState: WorkflowState = {
    blocks: workflowBlocks,
    edges: workflowEdges,
    loops,
    parallels,
    lastSaved: Date.now(),
  }

  return {
    success: true,
    workflowState,
    errors: [],
    warnings,
    idMapping,
  }
}

/**
 * Convert WorkflowState to YAML
 */
export function convertWorkflowStateToYaml(
  workflowState: WorkflowState,
  subBlockValues?: Record<string, Record<string, any>>
): WorkflowToYamlResult {
  try {
    const yaml = generateWorkflowYaml(workflowState, subBlockValues)
    return {
      success: true,
      yaml,
    }
  } catch (error) {
    logger.error('Failed to generate YAML:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a container block (loop/parallel)
 */
function createContainerBlock(blockId: string, importedBlock: ImportedBlock): BlockState {
  const block: BlockState = {
    id: blockId,
    type: importedBlock.type,
    name: importedBlock.name,
    position: importedBlock.position,
    subBlocks: {},
    outputs: {},
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    height: 0,
    data: {
      ...importedBlock.data,
      // Ensure container has dimensions
      width: importedBlock.data?.width || 500,
      height: importedBlock.data?.height || 300,
      type: importedBlock.type === 'loop' ? 'loopNode' : 'parallelNode',
      ...(importedBlock.parentId && {
        parentId: importedBlock.parentId,
        extent: importedBlock.extent,
      }),
    },
  }

  // Add parentNode for ReactFlow if this block is inside another container
  if (importedBlock.parentId) {
    ;(block as any).parentNode = importedBlock.parentId
  }

  return block
}

/**
 * Create a regular block with proper subBlocks
 */
function createRegularBlock(
  blockId: string,
  importedBlock: ImportedBlock,
  blockConfig: any
): BlockState {
  // Initialize subBlocks from block configuration
  const subBlocks: Record<string, any> = {}

  blockConfig.subBlocks.forEach((subBlock: any) => {
    const subBlockId = subBlock.id
    const yamlValue = importedBlock.inputs[subBlockId]

    subBlocks[subBlockId] = {
      id: subBlockId,
      type: subBlock.type,
      value: yamlValue !== undefined ? yamlValue : null,
    }
  })

  // Also ensure we have subBlocks for any YAML inputs not in block config
  Object.keys(importedBlock.inputs).forEach((inputKey) => {
    if (!subBlocks[inputKey]) {
      subBlocks[inputKey] = {
        id: inputKey,
        type: 'short-input',
        value: importedBlock.inputs[inputKey],
      }
    }
  })

  const outputs = resolveOutputType(blockConfig.outputs)

  const block: BlockState = {
    id: blockId,
    type: importedBlock.type,
    name: importedBlock.name,
    position: importedBlock.position,
    subBlocks,
    outputs,
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    height: 0,
    data: {
      ...importedBlock.data,
      ...(importedBlock.parentId && {
        parentId: importedBlock.parentId,
        extent: importedBlock.extent,
      }),
    },
  }

  // Add parentNode for ReactFlow if this block is inside a loop/parallel
  if (importedBlock.parentId) {
    ;(block as any).parentNode = importedBlock.parentId
  }

  return block
}

/**
 * Update block references in subblock values
 */
function updateBlockReferences(
  blocks: Record<string, BlockState>,
  idMapping: Map<string, string>
): void {
  Object.values(blocks).forEach((block) => {
    Object.values(block.subBlocks).forEach((subBlock) => {
      if (subBlock.value !== null && subBlock.value !== undefined) {
        subBlock.value = updateValueReferences(subBlock.value, idMapping)
      }
    })
  })
}

/**
 * Recursively update block references in a value
 */
function updateValueReferences(value: any, idMapping: Map<string, string>): any {
  if (typeof value === 'string' && value.includes('<') && value.includes('>')) {
    let processedValue = value
    const blockMatches = value.match(/<([^>]+)>/g)

    if (blockMatches) {
      for (const match of blockMatches) {
        const path = match.slice(1, -1)
        const [blockRef] = path.split('.')

        // Skip system references
        if (['start', 'loop', 'parallel', 'variable'].includes(blockRef.toLowerCase())) {
          continue
        }

        // Check if this references an old block ID that needs mapping
        const newMappedId = idMapping.get(blockRef)
        if (newMappedId) {
          processedValue = processedValue.replace(
            new RegExp(`<${blockRef}\\.`, 'g'),
            `<${newMappedId}.`
          )
          processedValue = processedValue.replace(
            new RegExp(`<${blockRef}>`, 'g'),
            `<${newMappedId}>`
          )
        }
      }
    }

    return processedValue
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => updateValueReferences(item, idMapping))
  }

  // Handle objects
  if (value !== null && typeof value === 'object') {
    const result = { ...value }
    for (const key in result) {
      result[key] = updateValueReferences(result[key], idMapping)
    }
    return result
  }

  return value
}

/**
 * Apply auto layout to workflow blocks
 */
export async function applyAutoLayoutToBlocks(
  blocks: Record<string, BlockState>,
  edges: any[]
): Promise<{
  success: boolean
  layoutedBlocks?: Record<string, BlockState>
  error?: string
}> {
  logger.info('=== applyAutoLayoutToBlocks called ===', {
    blockCount: Object.keys(blocks).length,
    edgeCount: edges.length,
  })

  try {
    // Try to import from the actual auto-layout location
    logger.info('Attempting to import auto-layout module...')
    const autoLayoutModule = await import(
      '@/app/workspace/[workspaceId]/w/[workflowId]/utils/auto-layout'
    )

    if (autoLayoutModule.applyAutoLayoutToBlocks) {
      logger.info('Using auto-layout module function')
      // Use the existing auto-layout function
      return await autoLayoutModule.applyAutoLayoutToBlocks(blocks, edges)
    }

    // Fallback to autolayout service
    logger.info('Falling back to autolayout service')
    const { autoLayoutWorkflow } = await import('@/lib/autolayout/service')

    logger.info('Calling autoLayoutWorkflow with options')
    const layoutedBlocks = await autoLayoutWorkflow(blocks, edges, {
      strategy: 'smart',
      direction: 'auto',
      spacing: {
        horizontal: 500,
        vertical: 400,
        layer: 700,
      },
      alignment: 'center',
      padding: {
        x: 250,
        y: 250,
      },
    })

    logger.info('autoLayoutWorkflow returned:', {
      hasLayoutedBlocks: !!layoutedBlocks,
      layoutedBlockCount: layoutedBlocks ? Object.keys(layoutedBlocks).length : 0,
    })

    return {
      success: true,
      layoutedBlocks,
    }
  } catch (error) {
    logger.error('Auto layout failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Auto layout failed',
    }
  }
}
