/**
 * Workflow execution utilities for client-side execution triggers
 * This is now a thin wrapper around the server-side executor
 */

import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerUtils } from '@/lib/workflows/triggers'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowExecutionUtils')

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

/**
 * Filter out all incoming edges to trigger blocks - triggers are independent entry points
 * This ensures execution and UI only show edges that are actually connected in execution
 * @param blocks - Record of blocks keyed by block ID
 * @param edges - Array of edges to filter
 * @returns Filtered array of edges
 */
export function filterEdgesFromTriggerBlocks(blocks: Record<string, any>, edges: Edge[]): Edge[] {
  return edges.filter((edge) => {
    const sourceBlock = blocks[edge.source]
    const targetBlock = blocks[edge.target]

    if (!sourceBlock || !targetBlock) {
      return true
    }

    const targetIsTrigger = TriggerUtils.isTriggerBlock({
      type: targetBlock.type,
      triggerMode: targetBlock.triggerMode,
    })

    return !targetIsTrigger
  })
}
