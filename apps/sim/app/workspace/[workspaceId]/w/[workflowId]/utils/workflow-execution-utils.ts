import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export interface WorkflowExecutionOptions {
  workflowInput?: any
  onStream?: (se: StreamingExecution) => Promise<void>
  executionId?: string
  onBlockComplete?: (blockId: string, output: any) => Promise<void>
  overrideTriggerType?: 'chat' | 'manual' | 'api'
}

/**
 * Execute workflow with full logging (used by copilot tools)
 * This now delegates to the server-side executor via API
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const { activeWorkflowId } = useWorkflowRegistry.getState()

  if (!activeWorkflowId) {
    throw new Error('No active workflow')
  }

  // For copilot tool calls, we use non-SSE execution to get a simple result
  const response = await fetch(`/api/workflows/${activeWorkflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: options.workflowInput,
      stream: false, // Copilot doesn't need SSE streaming
      triggerType: options.overrideTriggerType || 'manual',
      useDraftState: true,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Workflow execution failed')
  }

  const result = await response.json()
  return result as ExecutionResult
}
