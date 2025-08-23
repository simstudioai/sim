import { Loader2, Workflow as WorkflowIcon, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface GetUserWorkflowArgs {
  workflowId?: string
  includeMetadata?: boolean
}

const logger = createLogger('GetUserWorkflowClientTool')

export class GetUserWorkflowClientTool extends BaseClientTool {
  static readonly id = 'get_user_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, GetUserWorkflowClientTool.id, GetUserWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Analyzing your workflow', icon: WorkflowIcon },
      [ClientToolCallState.executing]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted analyzing your workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Analyzed your workflow', icon: WorkflowIcon },
      [ClientToolCallState.error]: { text: 'Failed to analyze your workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped analyzing your workflow', icon: XCircle },
    },
  }

  async execute(args?: GetUserWorkflowArgs): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      // Determine workflow ID (explicit or active)
      let workflowId = args?.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (!activeWorkflowId) {
          await this.markToolComplete(400, 'No active workflow found')
          this.setState(ClientToolCallState.error)
          return
        }
        workflowId = activeWorkflowId as any
      }

      logger.info('Fetching user workflow from stores', {
        workflowId,
        includeMetadata: args?.includeMetadata,
      })

      // Prefer diff/preview store if available; otherwise use main workflow store
      let workflowState: any = null

      const diffStore = useWorkflowDiffStore.getState()
      if (diffStore.diffWorkflow && Object.keys(diffStore.diffWorkflow.blocks || {}).length > 0) {
        workflowState = diffStore.diffWorkflow
        logger.info('Using workflow from diff/preview store', { workflowId })
      } else {
        const workflowStore = useWorkflowStore.getState()
        const fullWorkflowState = workflowStore.getWorkflowState()

        if (!fullWorkflowState || !fullWorkflowState.blocks) {
          const workflowRegistry = useWorkflowRegistry.getState()
          const wfKey = String(workflowId)
          const workflow = (workflowRegistry as any).workflows?.[wfKey]

          if (!workflow) {
            await this.markToolComplete(404, `Workflow ${workflowId} not found in any store`)
            this.setState(ClientToolCallState.error)
            return
          }

          logger.warn('No workflow state found, using workflow metadata only', { workflowId })
          workflowState = workflow
        } else {
          workflowState = fullWorkflowState
          logger.info('Using workflow state from workflow store', {
            workflowId,
            blockCount: Object.keys(fullWorkflowState.blocks || {}).length,
          })
        }
      }

      // Normalize required properties
      if (workflowState) {
        if (!workflowState.loops) workflowState.loops = {}
        if (!workflowState.parallels) workflowState.parallels = {}
        if (!workflowState.edges) workflowState.edges = []
        if (!workflowState.blocks) workflowState.blocks = {}
      }

      // Merge latest subblock values so edits are reflected
      try {
        if (workflowState?.blocks) {
          workflowState = {
            ...workflowState,
            blocks: mergeSubblockState(workflowState.blocks, workflowId as any),
          }
          logger.info('Merged subblock values into workflow state', {
            workflowId,
            blockCount: Object.keys(workflowState.blocks || {}).length,
          })
        }
      } catch (mergeError) {
        logger.warn('Failed to merge subblock values; proceeding with raw workflow state', {
          workflowId,
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        })
      }

      logger.info('Validating workflow state', {
        workflowId,
        hasWorkflowState: !!workflowState,
        hasBlocks: !!workflowState?.blocks,
        workflowStateType: typeof workflowState,
      })

      if (!workflowState || !workflowState.blocks) {
        await this.markToolComplete(422, 'Workflow state is empty or invalid')
        this.setState(ClientToolCallState.error)
        return
      }

      // Convert to JSON string for transport
      let workflowJson = ''
      try {
        workflowJson = JSON.stringify(workflowState, null, 2)
        logger.info('Successfully stringified workflow state', {
          workflowId,
          jsonLength: workflowJson.length,
        })
      } catch (stringifyError) {
        await this.markToolComplete(
          500,
          `Failed to convert workflow to JSON: ${
            stringifyError instanceof Error ? stringifyError.message : 'Unknown error'
          }`
        )
        this.setState(ClientToolCallState.error)
        return
      }

      // Mark complete with data; keep state success for store render
      await this.markToolComplete(200, 'Workflow analyzed', { userWorkflow: workflowJson })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Error in tool execution', {
        toolCallId: this.toolCallId,
        error,
        message,
      })
      await this.markToolComplete(500, message || 'Failed to fetch workflow')
      this.setState(ClientToolCallState.error)
    }
  }
}
