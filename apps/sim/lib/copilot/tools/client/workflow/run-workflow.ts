import { createLogger } from '@sim/logger'
import { Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
  WORKFLOW_EXECUTION_TIMEOUT_MS,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { executeWorkflowWithFullLogging } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import { useExecutionStore } from '@/stores/execution'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface RunWorkflowArgs {
  workflowId?: string
  description?: string
  workflow_input?: Record<string, any>
}

export class RunWorkflowClientTool extends BaseClientTool {
  static readonly id = 'run_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, RunWorkflowClientTool.id, RunWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to run your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Run this workflow?', icon: Play },
      [ClientToolCallState.executing]: { text: 'Running your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Executed workflow', icon: Play },
      [ClientToolCallState.error]: { text: 'Errored running workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped workflow execution', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted workflow execution', icon: MinusCircle },
      [ClientToolCallState.background]: { text: 'Running in background', icon: Play },
    },
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
    },
    uiConfig: {
      isSpecial: true,
      interrupt: {
        accept: { text: 'Run', icon: Play },
        reject: { text: 'Skip', icon: MinusCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
      secondaryAction: {
        text: 'Move to Background',
        title: 'Move to Background',
        variant: 'tertiary',
        showInStates: [ClientToolCallState.executing],
        completionMessage:
          'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete',
        targetState: ClientToolCallState.background,
      },
      paramsTable: {
        columns: [
          { key: 'input', label: 'Input', width: '36%' },
          { key: 'value', label: 'Value', width: '64%', editable: true, mono: true },
        ],
        extractRows: (params) => {
          let inputs = params.input || params.inputs || params.workflow_input
          if (typeof inputs === 'string') {
            try {
              inputs = JSON.parse(inputs)
            } catch {
              inputs = {}
            }
          }
          if (params.workflow_input && typeof params.workflow_input === 'object') {
            inputs = params.workflow_input
          }
          if (!inputs || typeof inputs !== 'object') {
            const { workflowId, workflow_input, ...rest } = params
            inputs = rest
          }
          const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
          return Object.entries(safeInputs).map(([key, value]) => [key, key, String(value)])
        },
      },
    },
    getDynamicText: (params, state) => {
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (workflowId) {
        const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
        if (workflowName) {
          switch (state) {
            case ClientToolCallState.success:
              return `Ran ${workflowName}`
            case ClientToolCallState.executing:
              return `Running ${workflowName}`
            case ClientToolCallState.generating:
              return `Preparing to run ${workflowName}`
            case ClientToolCallState.pending:
              return `Run ${workflowName}?`
            case ClientToolCallState.error:
              return `Failed to run ${workflowName}`
            case ClientToolCallState.rejected:
              return `Skipped running ${workflowName}`
            case ClientToolCallState.aborted:
              return `Aborted running ${workflowName}`
            case ClientToolCallState.background:
              return `Running ${workflowName} in background`
          }
        }
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: RunWorkflowArgs): Promise<void> {
    const logger = createLogger('RunWorkflowClientTool')

    // Use longer timeout for workflow execution (10 minutes)
    await this.executeWithTimeout(async () => {
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

      const workflowInput = params.workflow_input || undefined
      if (workflowInput) {
        logger.debug('Workflow input provided', {
          inputFields: Object.keys(workflowInput),
          inputPreview: JSON.stringify(workflowInput).slice(0, 120),
        })
      }

      setIsExecuting(true)
      logger.debug('Set isExecuting(true) and switching state to executing')
      this.setState(ClientToolCallState.executing)

      const executionId = uuidv4()
      const executionStartTime = new Date().toISOString()
      logger.debug('Starting workflow execution', {
        executionStartTime,
        executionId,
        toolCallId: this.toolCallId,
      })

      try {
        const result = await executeWorkflowWithFullLogging({
          workflowInput,
          executionId,
        })

        // Determine success for both non-streaming and streaming executions
        let succeeded = true
        let errorMessage: string | undefined
        try {
          if (result && typeof result === 'object' && 'success' in (result as any)) {
            succeeded = Boolean((result as any).success)
            if (!succeeded) {
              errorMessage = (result as any)?.error || (result as any)?.output?.error
            }
          } else if (
            result &&
            typeof result === 'object' &&
            'execution' in (result as any) &&
            (result as any).execution &&
            typeof (result as any).execution === 'object'
          ) {
            succeeded = Boolean((result as any).execution.success)
            if (!succeeded) {
              errorMessage =
                (result as any).execution?.error || (result as any).execution?.output?.error
            }
          }
        } catch {}

        if (succeeded) {
          logger.debug('Workflow execution finished with success')
          this.setState(ClientToolCallState.success)
          await this.markToolComplete(
            200,
            `Workflow execution completed. Started at: ${executionStartTime}`
          )
        } else {
          const msg = errorMessage || 'Workflow execution failed'
          logger.error('Workflow execution finished with failure', { message: msg })
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(500, msg)
        }
      } finally {
        // Always clean up execution state
        setIsExecuting(false)
      }
    }, WORKFLOW_EXECUTION_TIMEOUT_MS)
  }

  async execute(args?: RunWorkflowArgs): Promise<void> {
    // For compatibility if execute() is explicitly invoked, route to handleAccept
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(RunWorkflowClientTool.id, RunWorkflowClientTool.metadata.uiConfig!)
