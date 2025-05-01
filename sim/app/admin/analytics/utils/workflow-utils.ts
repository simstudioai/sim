/**
 * Extracts blocks from a workflow state
 * @param state The workflow state object
 * @returns Array of block objects with type property
 */

// Define a more specific type for block data
interface BlockData {
    [key: string]: string | number | boolean | null | undefined
  }
  
  interface WorkflowBlock {
    id: string
    type: string
    data?: BlockData
  }
  
  interface WorkflowState {
    blocks: WorkflowBlock[] | Record<string, WorkflowBlock>
  }
  
  export function getBlocksFromState(state: WorkflowState | null | undefined): WorkflowBlock[] {
    // Check if state exists and has blocks property
    if (!state || !state.blocks) return []
    
    // Handle array format
    if (Array.isArray(state.blocks)) {
      return state.blocks
    }
    
    // Handle object format - ensure blocks is not null before calling Object.values
    if (typeof state.blocks === 'object' && state.blocks !== null) {
      return Object.values(state.blocks)
    }
    
    return []
  } 