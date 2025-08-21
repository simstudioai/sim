import { Loader2, Workflow as WorkflowIcon, XCircle, MinusCircle, CheckCircle } from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { mergeSubblockState } from '@/stores/workflows/utils'

interface GetUserWorkflowArgs {
  workflowId?: string
  includeMetadata?: boolean
}

export class GetUserWorkflowClientTool extends BaseClientTool {
  static readonly id = 'get_user_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, GetUserWorkflowClientTool.id, GetUserWorkflowClientTool.metadata)
  }

  // Display metadata mapping states to UI display
  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to analyze workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Analyze current workflow?', icon: WorkflowIcon },
      [ClientToolCallState.executing]: { text: 'Analyzing your workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted workflow analysis', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Workflow analyzed', icon: WorkflowIcon },
      [ClientToolCallState.error]: { text: 'Failed to analyze workflow', icon: XCircle },
    },
  }

  async execute(args?: GetUserWorkflowArgs): Promise<void> {
    const logger = createLogger('GetUserWorkflowClientTool')
    this.setState(ClientToolCallState.executing)

    try {
      const params = args || {}

      // Determine workflow ID (explicit or active)
      let workflowId = params.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (!activeWorkflowId) {
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(400, 'No active workflow found')
          return
        }
        workflowId = activeWorkflowId
      }

      logger.info('Fetching user workflow from stores', {
        workflowId,
        includeMetadata: params.includeMetadata,
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
          const workflow = workflowRegistry.workflows[workflowId]

          if (!workflow) {
            this.setState(ClientToolCallState.error)
            await this.markToolComplete(404, `Workflow ${workflowId} not found in any store`)
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
            blocks: mergeSubblockState(workflowState.blocks, workflowId),
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
        logger.error('Workflow state validation failed', {
          workflowId,
          workflowState: workflowState,
          hasBlocks: !!workflowState?.blocks,
        })
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(422, 'Workflow state is empty or invalid')
        return
      }

      // Include metadata if requested (already present if available)
      if (params.includeMetadata && workflowState.metadata) {
        // nothing to do
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
        logger.error('Error stringifying workflow state', {
          workflowId,
          error: stringifyError,
        })
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(
          500,
          `Failed to convert workflow to JSON: ${
            stringifyError instanceof Error ? stringifyError.message : 'Unknown error'
          }`
        )
        return
      }

      // Notify server of success via new mark-complete API
      const message = { userWorkflow: workflowJson }
      const ok = await this.markToolComplete(200, message)

      if (!ok) {
        this.setState(ClientToolCallState.error)
        return
      }

      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      createLogger('GetUserWorkflowClientTool').error('Error in client tool execution', {
        toolCallId: this.toolCallId,
        error,
        message,
      })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, message || 'Failed to fetch workflow')
    }
  }
}
