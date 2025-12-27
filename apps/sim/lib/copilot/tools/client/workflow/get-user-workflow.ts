import { createLogger } from '@sim/logger'
import { Loader2, Workflow as WorkflowIcon, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { stripWorkflowDiffMarkers } from '@/lib/workflows/diff'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
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
      [ClientToolCallState.generating]: { text: 'Reading your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Reading your workflow', icon: WorkflowIcon },
      [ClientToolCallState.executing]: { text: 'Reading your workflow', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted reading your workflow', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Read your workflow', icon: WorkflowIcon },
      [ClientToolCallState.error]: { text: 'Failed to read your workflow', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped reading your workflow', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (workflowId) {
        const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
        if (workflowName) {
          switch (state) {
            case ClientToolCallState.success:
              return `Read ${workflowName}`
            case ClientToolCallState.executing:
            case ClientToolCallState.generating:
            case ClientToolCallState.pending:
              return `Reading ${workflowName}`
            case ClientToolCallState.error:
              return `Failed to read ${workflowName}`
            case ClientToolCallState.aborted:
              return `Aborted reading ${workflowName}`
            case ClientToolCallState.rejected:
              return `Skipped reading ${workflowName}`
          }
        }
      }
      return undefined
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

      // Always use main workflow store as the source of truth
      const workflowStore = useWorkflowStore.getState()
      const fullWorkflowState = workflowStore.getWorkflowState()

      let workflowState: any = null

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
        workflowState = stripWorkflowDiffMarkers(fullWorkflowState)
        logger.info('Using workflow state from workflow store', {
          workflowId,
          blockCount: Object.keys(fullWorkflowState.blocks || {}).length,
        })
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

      // Sanitize workflow state for copilot (remove UI-specific data)
      const sanitizedState = sanitizeForCopilot(workflowState)

      // Convert to JSON string for transport
      let workflowJson = ''
      try {
        workflowJson = JSON.stringify(sanitizedState, null, 2)
        logger.info('Successfully stringified sanitized workflow state', {
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
