import type { Edge } from 'reactflow'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface WorkflowValidationError {
  blockId: string
  blockName: string
  message: string
}

/**
 * Check whether a sub-block's `required` condition is satisfied given current block state.
 */
function isSubBlockRequired(
  subBlockConfig: SubBlockConfig,
  blockState: BlockState
): boolean {
  const req = subBlockConfig.required
  if (req === undefined || req === false) return false
  if (req === true) return true

  // Conditional requirement: check field value
  const fieldValue = blockState.subBlocks[req.field]?.value
  const matches = Array.isArray(req.value)
    ? req.value.includes(fieldValue as string | number | boolean)
    : fieldValue === req.value
  const fieldSatisfied = req.not ? !matches : matches

  if (req.and) {
    const andValue = blockState.subBlocks[req.and.field]?.value
    const andMatches = Array.isArray(req.and.value)
      ? req.and.value.includes(andValue as string | number | boolean)
      : andValue === req.and.value
    const andSatisfied = req.and.not ? !andMatches : andMatches
    return fieldSatisfied && andSatisfied
  }

  return fieldSatisfied
}

/**
 * Validate that all required sub-block fields in a workflow are filled
 * and that non-trigger blocks have at least one incoming connection.
 */
export function validateWorkflowBlocks(
  blocks: Record<string, BlockState>,
  edges: Edge[]
): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = []

  // Build set of block IDs that have incoming edges
  const blocksWithIncoming = new Set<string>()
  for (const edge of edges) {
    blocksWithIncoming.add(edge.target)
  }

  for (const [blockId, blockState] of Object.entries(blocks)) {
    if (!blockState.enabled) continue

    const blockConfig = getBlock(blockState.type)
    if (!blockConfig) continue

    // Skip container-type blocks (loops, parallels)
    if (blockState.data?.type === 'loop' || blockState.data?.type === 'parallel') continue

    // Check required sub-block fields
    for (const subBlockConfig of blockConfig.subBlocks) {
      if (!isSubBlockRequired(subBlockConfig, blockState)) continue

      const subBlockState = blockState.subBlocks[subBlockConfig.id]
      const value = subBlockState?.value
      const isEmpty =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)

      if (isEmpty) {
        errors.push({
          blockId,
          blockName: blockState.name,
          message: `Missing required field: ${subBlockConfig.title || subBlockConfig.id}`,
        })
      }
    }

    // Non-trigger blocks should have at least one incoming connection
    if (blockConfig.category !== 'triggers' && !blocksWithIncoming.has(blockId)) {
      errors.push({
        blockId,
        blockName: blockState.name,
        message: 'Block is not connected to any input',
      })
    }
  }

  return errors
}
