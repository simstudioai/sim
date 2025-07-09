import { dump as yamlDump } from 'js-yaml'
import { createLogger } from '@/lib/logs/console-logger'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowYamlGenerator')

interface YamlBlock {
  type: string
  name: string
  inputs?: Record<string, any>
  preceding?: string[]
  following?: string[]
  parentId?: string // Add parentId for nested blocks
}

interface YamlWorkflow {
  version: string
  blocks: Record<string, YamlBlock>
}

/**
 * Extract input values from a block's subBlocks based on its configuration
 * This version works without client-side stores by using the provided subblock values
 */
function extractBlockInputs(
  blockState: BlockState,
  blockId: string,
  subBlockValues?: Record<string, Record<string, any>>
): Record<string, any> {
  const blockConfig = getBlock(blockState.type)
  const inputs: Record<string, any> = {}

  // Get subblock values for this block (if provided)
  const blockSubBlockValues = subBlockValues?.[blockId] || {}

  // Special handling for loop and parallel blocks
  if (blockState.type === 'loop' || blockState.type === 'parallel') {
    // Extract configuration from blockState.data instead of subBlocks
    if (blockState.data) {
      Object.entries(blockState.data).forEach(([key, value]) => {
        // Include relevant configuration properties
        if (
          key === 'count' ||
          key === 'loopType' ||
          key === 'collection' ||
          key === 'parallelType' ||
          key === 'distribution'
        ) {
          if (value !== undefined && value !== null && value !== '') {
            inputs[key] = value
          }
        }
        // Also include any override values from subBlockValues if they exist
        const overrideValue = blockSubBlockValues[key]
        if (overrideValue !== undefined && overrideValue !== null && overrideValue !== '') {
          inputs[key] = overrideValue
        }
      })
    }

    // Include any additional values from subBlockValues that might not be in data
    Object.entries(blockSubBlockValues).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '' && !Object.hasOwn(inputs, key)) {
        inputs[key] = value
      }
    })

    return inputs
  }

  if (!blockConfig) {
    // For other custom blocks without config, extract available subBlock values
    Object.entries(blockState.subBlocks || {}).forEach(([subBlockId, subBlockState]) => {
      const value = blockSubBlockValues[subBlockId] ?? subBlockState.value
      if (value !== undefined && value !== null && value !== '') {
        inputs[subBlockId] = value
      }
    })
    return inputs
  }

  // Process each subBlock configuration for regular blocks
  blockConfig.subBlocks.forEach((subBlockConfig: SubBlockConfig) => {
    const subBlockId = subBlockConfig.id

    // Skip hidden or conditional fields that aren't active
    if (subBlockConfig.hidden) return

    // Get value from provided values or fallback to block state
    const value = blockSubBlockValues[subBlockId] ?? blockState.subBlocks[subBlockId]?.value

    // Include value if it exists and isn't empty
    if (value !== undefined && value !== null && value !== '') {
      // Handle different input types appropriately
      switch (subBlockConfig.type) {
        case 'table':
          // Tables are arrays of objects
          if (Array.isArray(value) && value.length > 0) {
            inputs[subBlockId] = value
          }
          break

        case 'checkbox-list':
          // Checkbox lists return arrays
          if (Array.isArray(value) && value.length > 0) {
            inputs[subBlockId] = value
          }
          break

        case 'code':
          // Code blocks should preserve formatting
          if (typeof value === 'string' && value.trim()) {
            inputs[subBlockId] = value
          } else if (typeof value === 'object') {
            inputs[subBlockId] = value
          }
          break

        case 'switch':
          // Boolean values
          inputs[subBlockId] = Boolean(value)
          break

        case 'slider':
          // Numeric values
          if (
            typeof value === 'number' ||
            (typeof value === 'string' && !Number.isNaN(Number(value)))
          ) {
            inputs[subBlockId] = Number(value)
          }
          break

        default:
          // Text inputs, dropdowns, etc.
          if (typeof value === 'string' && value.trim()) {
            inputs[subBlockId] = value.trim()
          } else if (
            typeof value === 'object' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            inputs[subBlockId] = value
          }
          break
      }
    }
  })

  return inputs
}

/**
 * Find preceding blocks for a given block ID
 */
function findPrecedingBlocks(blockId: string, edges: any[]): string[] {
  return edges
    .filter((edge) => edge.target === blockId)
    .map((edge) => edge.source)
    .filter((source, index, arr) => arr.indexOf(source) === index) // Remove duplicates
}

/**
 * Find following blocks for a given block ID
 */
function findFollowingBlocks(blockId: string, edges: any[]): string[] {
  return edges
    .filter((edge) => edge.source === blockId)
    .map((edge) => edge.target)
    .filter((target, index, arr) => arr.indexOf(target) === index) // Remove duplicates
}

/**
 * Generate YAML representation of the workflow
 * This is the core function extracted from the client store, made server-compatible
 */
export function generateWorkflowYaml(
  workflowState: WorkflowState,
  subBlockValues?: Record<string, Record<string, any>>
): string {
  try {
    const yamlWorkflow: YamlWorkflow = {
      version: '1.0',
      blocks: {},
    }

    // Process each block
    Object.entries(workflowState.blocks).forEach(([blockId, blockState]) => {
      const inputs = extractBlockInputs(blockState, blockId, subBlockValues)
      const preceding = findPrecedingBlocks(blockId, workflowState.edges)
      const following = findFollowingBlocks(blockId, workflowState.edges)

      const yamlBlock: YamlBlock = {
        type: blockState.type,
        name: blockState.name,
      }

      // Only include inputs if they exist
      if (Object.keys(inputs).length > 0) {
        yamlBlock.inputs = inputs
      }

      // Only include connections if they exist
      if (preceding.length > 0) {
        yamlBlock.preceding = preceding
      }

      if (following.length > 0) {
        yamlBlock.following = following
      }

      // Include parent-child relationship for nested blocks
      if (blockState.data?.parentId) {
        yamlBlock.parentId = blockState.data.parentId
      }

      yamlWorkflow.blocks[blockId] = yamlBlock
    })

    // Convert to YAML with clean formatting
    return yamlDump(yamlWorkflow, {
      indent: 2,
      lineWidth: -1, // Disable line wrapping
      noRefs: true,
      sortKeys: false,
    })
  } catch (error) {
    logger.error('Failed to generate workflow YAML:', error)
    return `# Error generating YAML: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}
