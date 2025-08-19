import { BaseCopilotTool } from '@/lib/copilot/tools/server-tools/base'

interface RunWorkflowServerParams {
  status: 'success' | 'errored' | 'rejected'
  message?: string
  workflowId?: string
  description?: string
  startedAt?: string
  finishedAt?: string
}

interface RunWorkflowServerResult extends RunWorkflowServerParams {}

class RunWorkflowServerTool extends BaseCopilotTool<
  RunWorkflowServerParams,
  RunWorkflowServerResult
> {
  readonly id = 'run_workflow'
  readonly displayName = 'Run workflow'
  readonly requiresInterrupt = false

  protected async executeImpl(params: RunWorkflowServerParams): Promise<RunWorkflowServerResult> {
    // Echo back the status and metadata for completion callback
    return {
      status: params.status,
      message: params.message,
      workflowId: params.workflowId,
      description: params.description,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
    }
  }
}

export const runWorkflowServerTool = new RunWorkflowServerTool()
