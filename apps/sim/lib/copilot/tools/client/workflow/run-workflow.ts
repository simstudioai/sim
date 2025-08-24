import { Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/lib/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
      [ClientToolCallState.generating]: { text: 'Preparing to run your workflow', icon: Play },
      [ClientToolCallState.pending]: { text: 'Run this workflow?', icon: Play },
      [ClientToolCallState.executing]: { text: 'Running your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Workflow executed', icon: Play },
      [ClientToolCallState.error]: { text: 'Errored running workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Workflow execution skipped', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted workflow execution', icon: MinusCircle },
      [ClientToolCallState.background]: { text: 'Running in background', icon: Play },
    },
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: RunWorkflowArgs): Promise<void> {
    const logger = createLogger('RunWorkflowClientTool')
    try {
      const params = args || {}
      logger.debug('handleAccept() called', {
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
      logger.debug('Set isExecuting(false) and switching state to success')
      this.setState(ClientToolCallState.success)

      await this.markToolComplete(
        200,
        `Workflow execution completed. Started at: ${executionStartTime}`
      )
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      const failedDependency = typeof message === 'string' && /dependency/i.test(message)
      const status = failedDependency ? 424 : 500

      logger.error('Run workflow failed', { message })

      this.setState(ClientToolCallState.error)
      await this.markToolComplete(status, failedDependency ? undefined : message)
    }
  }

  async execute(args?: RunWorkflowArgs): Promise<void> {
    // For compatibility if execute() is explicitly invoked, route to handleAccept
    await this.handleAccept(args)
  }
}
