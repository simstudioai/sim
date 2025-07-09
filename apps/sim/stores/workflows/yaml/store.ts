import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { dump as yamlDump } from 'js-yaml'
import { getBlock } from '@/blocks'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowStore } from '../workflow/store'
import { useSubBlockStore } from '../subblock/store'
import type { BlockState, WorkflowState } from '../workflow/types'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('WorkflowYamlStore')

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

interface WorkflowYamlState {
  yaml: string
  lastGenerated?: number
}

interface WorkflowYamlActions {
  generateYaml: () => void
  getYaml: () => string
  refreshYaml: () => void
}

type WorkflowYamlStore = WorkflowYamlState & WorkflowYamlActions

/**
 * Extract input values from a block's subBlocks based on its configuration
 */
function extractBlockInputs(blockState: BlockState, blockId: string): Record<string, any> {
  const blockConfig = getBlock(blockState.type)
  const subBlockStore = useSubBlockStore.getState()
  const inputs: Record<string, any> = {}

  if (!blockConfig) {
    // For custom blocks like loops/parallels, extract available subBlock values
    Object.entries(blockState.subBlocks || {}).forEach(([subBlockId, subBlockState]) => {
      const value = subBlockStore.getValue(blockId, subBlockId) ?? subBlockState.value
      if (value !== undefined && value !== null && value !== '') {
        inputs[subBlockId] = value
      }
    })
    return inputs
  }

  // Process each subBlock configuration
  blockConfig.subBlocks.forEach((subBlockConfig: SubBlockConfig) => {
    const subBlockId = subBlockConfig.id
    
    // Skip hidden or conditional fields that aren't active
    if (subBlockConfig.hidden) return
    
    // Get value from subblock store or fallback to block state
    const value = subBlockStore.getValue(blockId, subBlockId) ?? 
                  blockState.subBlocks[subBlockId]?.value

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
          if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)))) {
            inputs[subBlockId] = Number(value)
          }
          break
        
        default:
          // Text inputs, dropdowns, etc.
          if (typeof value === 'string' && value.trim()) {
            inputs[subBlockId] = value.trim()
          } else if (typeof value === 'object' || typeof value === 'number' || typeof value === 'boolean') {
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
    .filter(edge => edge.target === blockId)
    .map(edge => edge.source)
    .filter((source, index, arr) => arr.indexOf(source) === index) // Remove duplicates
}

/**
 * Find following blocks for a given block ID
 */
function findFollowingBlocks(blockId: string, edges: any[]): string[] {
  return edges
    .filter(edge => edge.source === blockId)
    .map(edge => edge.target)
    .filter((target, index, arr) => arr.indexOf(target) === index) // Remove duplicates
}

/**
 * Generate YAML representation of the workflow
 */
function generateWorkflowYaml(workflowState: WorkflowState): string {
  try {
    const yamlWorkflow: YamlWorkflow = {
      version: '1.0',
      blocks: {}
    }

    // Process each block
    Object.entries(workflowState.blocks).forEach(([blockId, blockState]) => {
      const inputs = extractBlockInputs(blockState, blockId)
      const preceding = findPrecedingBlocks(blockId, workflowState.edges)
      const following = findFollowingBlocks(blockId, workflowState.edges)

      const yamlBlock: YamlBlock = {
        type: blockState.type,
        name: blockState.name
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

      yamlWorkflow.blocks[blockId] = yamlBlock
    })

    // Convert to YAML with clean formatting
    return yamlDump(yamlWorkflow, {
      indent: 2,
      lineWidth: -1, // Disable line wrapping
      noRefs: true,
      sortKeys: false
    })
  } catch (error) {
    logger.error('Failed to generate workflow YAML:', error)
    return `# Error generating YAML: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

export const useWorkflowYamlStore = create<WorkflowYamlStore>()(
  devtools(
    (set, get) => ({
      yaml: '',
      lastGenerated: undefined,

      generateYaml: () => {
        const workflowState = useWorkflowStore.getState()
        const yaml = generateWorkflowYaml(workflowState)
        
        set({
          yaml,
          lastGenerated: Date.now()
        })
      },

      getYaml: () => {
        const currentTime = Date.now()
        const { yaml, lastGenerated } = get()
        
        // Auto-refresh if data is stale (older than 1 second) or never generated
        if (!lastGenerated || currentTime - lastGenerated > 1000) {
          get().generateYaml()
          return get().yaml
        }
        
        return yaml
      },

      refreshYaml: () => {
        get().generateYaml()
      }
    }),
    {
      name: 'workflow-yaml-store'
    }
  )
)

// Auto-refresh YAML when workflow state changes
let lastWorkflowState: { blockCount: number; edgeCount: number } | null = null

useWorkflowStore.subscribe((state) => {
  const currentState = {
    blockCount: Object.keys(state.blocks).length,
    edgeCount: state.edges.length
  }
  
  // Only refresh if the structure has changed
  if (!lastWorkflowState || 
      lastWorkflowState.blockCount !== currentState.blockCount ||
      lastWorkflowState.edgeCount !== currentState.edgeCount) {
    
    lastWorkflowState = currentState
    
    // Debounce the refresh to avoid excessive updates
    const refreshYaml = useWorkflowYamlStore.getState().refreshYaml
    setTimeout(refreshYaml, 100)
  }
})

// Subscribe to subblock store changes
let lastSubBlockChangeTime = 0

useSubBlockStore.subscribe((state) => {
  const currentTime = Date.now()
  
  // Debounce rapid changes
  if (currentTime - lastSubBlockChangeTime > 100) {
    lastSubBlockChangeTime = currentTime
    
    const refreshYaml = useWorkflowYamlStore.getState().refreshYaml
    setTimeout(refreshYaml, 100)
  }
}) 