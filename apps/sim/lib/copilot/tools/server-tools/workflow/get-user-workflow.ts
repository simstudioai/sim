import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'
import { BaseCopilotTool } from '../base'

interface GetUserWorkflowParams {
  workflowId: string
  includeMetadata?: boolean
}

class GetUserWorkflowTool extends BaseCopilotTool<GetUserWorkflowParams, string> {
  readonly id = 'get_user_workflow'
  readonly displayName = 'Analyzing your workflow'

  protected async executeImpl(params: GetUserWorkflowParams): Promise<string> {
    return getUserWorkflow(params)
  }
}

// Export the tool instance
export const getUserWorkflowTool = new GetUserWorkflowTool()

// Implementation function
async function getUserWorkflow(params: GetUserWorkflowParams): Promise<string> {
  const logger = createLogger('GetUserWorkflow')
  const { workflowId, includeMetadata = false } = params

  logger.info('Fetching user workflow', { workflowId })

  // Fetch workflow from database
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!workflowRecord) {
    throw new Error(`Workflow ${workflowId} not found`)
  }

  // Try to load from normalized tables first, fallback to JSON blob
  let workflowState: any = null
  const subBlockValues: Record<string, Record<string, any>> = {}

  const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
  if (normalizedData) {
    workflowState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
    }

    // Extract subblock values from normalized data
    Object.entries(normalizedData.blocks).forEach(([blockId, block]) => {
      subBlockValues[blockId] = {}
      Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
        if ((subBlock as any).value !== undefined) {
          subBlockValues[blockId][subBlockId] = (subBlock as any).value
        }
      })
    })
  } else if (workflowRecord.state) {
    // Fallback to JSON blob
    workflowState = workflowRecord.state as any
    // For JSON blob, subblock values are embedded in the block state
    Object.entries((workflowState.blocks as any) || {}).forEach(([blockId, block]) => {
      subBlockValues[blockId] = {}
      Object.entries((block as any).subBlocks || {}).forEach(([subBlockId, subBlock]) => {
        if ((subBlock as any).value !== undefined) {
          subBlockValues[blockId][subBlockId] = (subBlock as any).value
        }
      })
    })
  }

  if (!workflowState || !workflowState.blocks) {
    throw new Error('Workflow state is empty or invalid')
  }

  logger.info('Successfully fetched user workflow as JSON', {
    workflowId,
    blockCount: Object.keys(workflowState.blocks).length,
  })

  // Return the raw JSON workflow state
  return JSON.stringify(workflowState, null, 2)
}
