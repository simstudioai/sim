import { createLogger } from '@sim/logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { hasValidStartBlockInState } from '@/lib/workflows/triggers/trigger-utils'

const logger = createLogger('TriggerUtils')

/**
 * Check if a workflow has a valid start block by loading from database
 */
export async function hasValidStartBlock(workflowId: string): Promise<boolean> {
  try {
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    return hasValidStartBlockInState(normalizedData)
  } catch (error) {
    logger.warn('Error checking for start block:', error)
    return false
  }
}
