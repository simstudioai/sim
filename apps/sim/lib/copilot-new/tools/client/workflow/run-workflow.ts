import { Loader2, Play, XCircle, MinusCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/lib/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { createLogger } from '@/lib/logs/console/logger'

interface RunWorkflowArgs {
  workflowId?: string
  description?: string
  workflow_input?: string
}

export class RunWorkflowClientTool extends BaseClientTool {
  static readonly id = 'run_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, RunWorkflowClientTool.id, RunWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to execute workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Run workflow?', icon: Play },
      [ClientToolCallState.executing]: { text: 'Executing workflow', icon: Loader2 },
      [ClientToolCallState.workflow_accepted]: { text: 'Executing workflow', icon: Loader2 },
      [ClientToolCallState.workflow_rejected]: { text: 'Skipped workflow execution', icon: MinusCircle },
      [ClientToolCallState.success]: { text: 'Executed workflow', icon: Play },
      [ClientToolCallState.error]: { text: 'Failed to execute workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted stream', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async execute(args?: RunWorkflowArgs): Promise<void> {
    const logger = createLogger('RunWorkflowClientTool')
    try {
      const params = args || {}
      logger.debug('execute() called', {
        toolCallId: this.toolCallId,
        state: this.getState(),
        hasArgs: !!args,
        argKeys: args ? Object.keys(args) : [],
      })

      // prevent concurrent execution
      const { isExecuting, setIsExecuting } = useExecutionStore.getState()
      if (isExecuting) {
        logger.debug('Execution prevented: already executing')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(
          409,
          'The workflow is already in the middle of an execution. Try again later'
        )
        return
      }

      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        logger.debug('Execution prevented: no active workflow')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No active workflow found')
        return
      }
      logger.debug('Using active workflow', { activeWorkflowId })

      const workflowInput = params.workflow_input ? { input: params.workflow_input } : undefined
      if (workflowInput?.input) {
        logger.debug('Workflow input provided', {
          inputPreview: String(workflowInput.input).slice(0, 120),
        })
      }

      setIsExecuting(true)
      logger.debug('Set isExecuting(true) and switching state to executing')
      this.setState(ClientToolCallState.executing)

      const executionStartTime = new Date().toISOString()
      logger.debug('Starting workflow execution', {
        executionStartTime,
        executionId: this.toolCallId,
      })

      const result = await executeWorkflowWithFullLogging({
        workflowInput,
        executionId: this.toolCallId,
      })

      setIsExecuting(false)
      logger.debug('Workflow execution finished; cleared isExecuting', {
        hasResult: !!result,
        resultSuccess: (result as any)?.success,
        resultError: (result as any)?.error,
      })

      if (result && (!('success' in result) || result.success !== false)) {
        logger.debug('Execution succeeded; marking complete (200)')
        await this.markToolComplete(200, `Workflow execution completed. Started at: ${executionStartTime}`)
        this.setState(ClientToolCallState.success)
        return
      }

      const errorMessage = (result as any)?.error || 'Workflow execution failed'
      const failedDependency = (result as any)?.failedDependency
      const status = failedDependency ? 400 : 500
      logger.debug('Execution failed; marking complete', {
        status,
        failedDependency: !!failedDependency,
        errorMessage,
      })
      await this.markToolComplete(status, failedDependency ? undefined : errorMessage)
      this.setState(ClientToolCallState.error)
    } catch (error: any) {
      const { setIsExecuting } = useExecutionStore.getState()
      setIsExecuting(false)
      const errorMessage = error?.message || 'An unknown error occurred'
      const failedDependency = error?.failedDependency
      const status = failedDependency ? 400 : 500
      logger.debug('Execution threw exception; marking complete', {
        status,
        failedDependency: !!failedDependency,
        errorMessage,
      })
      await this.markToolComplete(status, `Workflow execution failed: ${errorMessage}`)
      this.setState(ClientToolCallState.error)
    }
  }
} 