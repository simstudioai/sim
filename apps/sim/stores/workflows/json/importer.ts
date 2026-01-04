import { createLogger } from '@sim/logger'
import { regenerateWorkflowIds } from '@/stores/workflows/utils'
import type { WorkflowState } from '../workflow/types'

const logger = createLogger('WorkflowJsonImporter')

/**
 * Normalize subblock values by converting empty strings to null and filtering out invalid subblocks.
 * This provides backwards compatibility for workflows exported before the null sanitization fix,
 * preventing Zod validation errors like "Expected array, received string".
 *
 * Also filters out malformed subBlocks that may have been created by bugs in previous exports:
 * - SubBlocks with key "undefined" (caused by assigning to undefined key)
 * - SubBlocks missing required fields like `id`
 * - SubBlocks with `type: "unknown"` (indicates malformed data)
 */
function normalizeSubblockValues(blocks: Record<string, any>): Record<string, any> {
  const normalizedBlocks: Record<string, any> = {}

  Object.entries(blocks).forEach(([blockId, block]) => {
    const normalizedBlock = { ...block }

    if (block.subBlocks) {
      const normalizedSubBlocks: Record<string, any> = {}

      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
        // Skip subBlocks with invalid keys (literal "undefined" string)
        if (subBlockId === 'undefined') {
          logger.warn(`Skipping malformed subBlock with key "undefined" in block ${blockId}`)
          return
        }

        // Skip subBlocks that are null or not objects
        if (!subBlock || typeof subBlock !== 'object') {
          logger.warn(`Skipping invalid subBlock ${subBlockId} in block ${blockId}: not an object`)
          return
        }

        // Skip subBlocks with type "unknown" (malformed data)
        if (subBlock.type === 'unknown') {
          logger.warn(
            `Skipping malformed subBlock ${subBlockId} in block ${blockId}: type is "unknown"`
          )
          return
        }

        // Skip subBlocks missing required id field
        if (!subBlock.id) {
          logger.warn(
            `Skipping malformed subBlock ${subBlockId} in block ${blockId}: missing id field`
          )
          return
        }

        const normalizedSubBlock = { ...subBlock }

        // Convert empty strings to null for consistency
        if (normalizedSubBlock.value === '') {
          normalizedSubBlock.value = null
        }

        normalizedSubBlocks[subBlockId] = normalizedSubBlock
      })

      normalizedBlock.subBlocks = normalizedSubBlocks
    }

    normalizedBlocks[blockId] = normalizedBlock
  })

  return normalizedBlocks
}

export function parseWorkflowJson(
  jsonContent: string,
  regenerateIdsFlag = true
): {
  data: WorkflowState | null
  errors: string[]
} {
  const errors: string[] = []

  try {
    // Parse JSON content
    let data: any
    try {
      data = JSON.parse(jsonContent)
    } catch (parseError) {
      errors.push(
        `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
      )
      return { data: null, errors }
    }

    // Validate top-level structure
    if (!data || typeof data !== 'object') {
      errors.push('Invalid JSON: Root must be an object')
      return { data: null, errors }
    }

    // Handle new export format (version/exportedAt/state) or old format (blocks/edges at root)
    let workflowData: any
    if (data.version && data.state) {
      // New format with versioning
      logger.info('Parsing workflow JSON with version', {
        version: data.version,
        exportedAt: data.exportedAt,
      })
      workflowData = data.state
    } else {
      // Old format - blocks/edges at root level
      logger.info('Parsing legacy workflow JSON format')
      workflowData = data
    }

    // Validate required fields
    if (!workflowData.blocks || typeof workflowData.blocks !== 'object') {
      errors.push('Missing or invalid field: blocks')
      return { data: null, errors }
    }

    if (!Array.isArray(workflowData.edges)) {
      errors.push('Missing or invalid field: edges (must be an array)')
      return { data: null, errors }
    }

    // Validate blocks have required fields
    Object.entries(workflowData.blocks).forEach(([blockId, block]: [string, any]) => {
      if (!block || typeof block !== 'object') {
        errors.push(`Invalid block ${blockId}: must be an object`)
        return
      }

      if (!block.id) {
        errors.push(`Block ${blockId} missing required field: id`)
      }
      if (!block.type) {
        errors.push(`Block ${blockId} missing required field: type`)
      }
      if (
        !block.position ||
        typeof block.position.x !== 'number' ||
        typeof block.position.y !== 'number'
      ) {
        errors.push(`Block ${blockId} missing or invalid position`)
      }
    })

    // Validate edges have required fields
    workflowData.edges.forEach((edge: any, index: number) => {
      if (!edge || typeof edge !== 'object') {
        errors.push(`Invalid edge at index ${index}: must be an object`)
        return
      }

      if (!edge.id) {
        errors.push(`Edge at index ${index} missing required field: id`)
      }
      if (!edge.source) {
        errors.push(`Edge at index ${index} missing required field: source`)
      }
      if (!edge.target) {
        errors.push(`Edge at index ${index} missing required field: target`)
      }
    })

    // If there are errors, return null
    if (errors.length > 0) {
      return { data: null, errors }
    }

    // Normalize non-string subblock values (convert empty strings to null)
    // This handles exported workflows that may have empty strings for non-string types
    const normalizedBlocks = normalizeSubblockValues(workflowData.blocks || {})

    // Construct the workflow state with defaults
    let workflowState: WorkflowState = {
      blocks: normalizedBlocks,
      edges: workflowData.edges || [],
      loops: workflowData.loops || {},
      parallels: workflowData.parallels || {},
      metadata: workflowData.metadata,
      variables: Array.isArray(workflowData.variables) ? workflowData.variables : undefined,
    }

    if (regenerateIdsFlag) {
      const { idMap: _, ...regeneratedState } = regenerateWorkflowIds(workflowState, {
        clearTriggerRuntimeValues: true,
      })
      workflowState = {
        ...regeneratedState,
        metadata: workflowState.metadata,
        variables: workflowState.variables,
      }
      logger.info('Regenerated IDs for imported workflow to avoid conflicts')
    }

    logger.info('Successfully parsed workflow JSON', {
      blocksCount: Object.keys(workflowState.blocks).length,
      edgesCount: workflowState.edges.length,
      loopsCount: Object.keys(workflowState.loops).length,
      parallelsCount: Object.keys(workflowState.parallels).length,
    })

    return { data: workflowState, errors: [] }
  } catch (error) {
    logger.error('Failed to parse workflow JSON:', error)
    errors.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return { data: null, errors }
  }
}
