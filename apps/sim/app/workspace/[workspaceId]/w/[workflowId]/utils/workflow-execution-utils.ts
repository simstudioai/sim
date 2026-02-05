import { v4 as uuidv4 } from 'uuid'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { useExecutionStore } from '@/stores/execution'
import { useTerminalConsoleStore } from '@/stores/terminal'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export interface WorkflowExecutionOptions {
  workflowInput?: any
  onStream?: (se: StreamingExecution) => Promise<void>
  executionId?: string
  onBlockComplete?: (blockId: string, output: any) => Promise<void>
  overrideTriggerType?: 'chat' | 'manual' | 'api'
}

/**
 * Execute workflow with full logging (used by copilot tools)
 * Handles SSE streaming and populates console logs in real-time
 */
export async function executeWorkflowWithFullLogging(
  options: WorkflowExecutionOptions = {}
): Promise<ExecutionResult | StreamingExecution> {
  const { activeWorkflowId } = useWorkflowRegistry.getState()

  if (!activeWorkflowId) {
    throw new Error('No active workflow')
  }

  const executionId = options.executionId || uuidv4()
  const { addConsole } = useTerminalConsoleStore.getState()
  const { setActiveBlocks, setBlockRunStatus, setEdgeRunStatus } = useExecutionStore.getState()
  const workflowEdges = useWorkflowStore.getState().edges

  const activeBlocksSet = new Set<string>()

  const payload: any = {
    input: options.workflowInput,
    stream: true,
    triggerType: options.overrideTriggerType || 'manual',
    useDraftState: true,
    isClientSession: true,
  }

  const response = await fetch(`/api/workflows/${activeWorkflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Workflow execution failed')
  }

  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let executionResult: ExecutionResult = {
    success: false,
    output: {},
    logs: [],
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue

        const data = line.substring(6).trim()
        if (data === '[DONE]') continue

        try {
          const event = JSON.parse(data)

          switch (event.type) {
            case 'block:started': {
              activeBlocksSet.add(event.data.blockId)
              setActiveBlocks(new Set(activeBlocksSet))

              const incomingEdges = workflowEdges.filter(
                (edge) => edge.target === event.data.blockId
              )
              incomingEdges.forEach((edge) => {
                setEdgeRunStatus(edge.id, 'success')
              })
              break
            }

            case 'block:completed':
              activeBlocksSet.delete(event.data.blockId)
              setActiveBlocks(new Set(activeBlocksSet))

              setBlockRunStatus(event.data.blockId, 'success')

              addConsole({
                input: event.data.input || {},
                output: event.data.output,
                success: true,
                durationMs: event.data.durationMs,
                startedAt: new Date(Date.now() - event.data.durationMs).toISOString(),
                executionOrder: event.data.executionOrder,
                endedAt: new Date().toISOString(),
                workflowId: activeWorkflowId,
                blockId: event.data.blockId,
                executionId,
                blockName: event.data.blockName,
                blockType: event.data.blockType,
                iterationCurrent: event.data.iterationCurrent,
                iterationTotal: event.data.iterationTotal,
                iterationType: event.data.iterationType,
              })

              if (options.onBlockComplete) {
                options.onBlockComplete(event.data.blockId, event.data.output).catch(() => {})
              }
              break

            case 'block:error':
              activeBlocksSet.delete(event.data.blockId)
              setActiveBlocks(new Set(activeBlocksSet))

              setBlockRunStatus(event.data.blockId, 'error')

              addConsole({
                input: event.data.input || {},
                output: {},
                success: false,
                error: event.data.error,
                durationMs: event.data.durationMs,
                startedAt: new Date(Date.now() - event.data.durationMs).toISOString(),
                executionOrder: event.data.executionOrder,
                endedAt: new Date().toISOString(),
                workflowId: activeWorkflowId,
                blockId: event.data.blockId,
                executionId,
                blockName: event.data.blockName,
                blockType: event.data.blockType,
                iterationCurrent: event.data.iterationCurrent,
                iterationTotal: event.data.iterationTotal,
                iterationType: event.data.iterationType,
              })
              break

            case 'execution:completed':
              executionResult = {
                success: event.data.success,
                output: event.data.output,
                logs: [],
                metadata: {
                  duration: event.data.duration,
                  startTime: event.data.startTime,
                  endTime: event.data.endTime,
                },
              }
              break

            case 'execution:error':
              throw new Error(event.data.error || 'Execution failed')
          }
        } catch (parseError) {
          // Skip malformed SSE events
        }
      }
    }
  } finally {
    reader.releaseLock()
    setActiveBlocks(new Set())
  }

  return executionResult
}
