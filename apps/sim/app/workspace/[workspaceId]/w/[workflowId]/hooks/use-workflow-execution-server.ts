/**
 * Server-side workflow execution hook using SSE
 * This is the new implementation that offloads execution to the server
 */

import { useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveStartCandidates, StartBlockPath, TriggerUtils } from '@/lib/workflows/triggers'
import { useExecutionStream } from '@/hooks/use-execution-stream'
import type { BlockOutput } from '@/blocks/types'
import type { ExecutionResult } from '@/executor/types'
import { WorkflowValidationError } from '@/serializer'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useCurrentWorkflow } from './use-current-workflow'

const logger = createLogger('useWorkflowExecutionServer')

/**
 * Server-side workflow execution using SSE streaming
 */
export function useWorkflowExecutionServer() {
  const currentWorkflow = useCurrentWorkflow()
  const { activeWorkflowId, workflows } = useWorkflowRegistry()
  const { setIsExecuting, setActiveBlocks, setPendingBlocks } = useExecutionStore()
  const { toggleConsole, addConsole } = useConsoleStore()
  const { getVariablesByWorkflowId } = useVariablesStore()
  const executionStream = useExecutionStream()

  /**
   * Execute workflow on the server via SSE
   */
  const executeWorkflow = useCallback(
    async (
      workflowInput?: any,
      executionId?: string,
      overrideTriggerType?: 'chat' | 'manual' | 'api'
    ): Promise<ExecutionResult> => {
      if (!activeWorkflowId) {
        throw new Error('No active workflow')
      }

      try {
        setIsExecuting(true)

        // Use currentWorkflow
        const { blocks: workflowBlocks, edges: workflowEdges } = currentWorkflow

        // Filter out blocks without type
        const validBlocks = Object.entries(workflowBlocks).reduce(
          (acc, [blockId, block]) => {
            if (block?.type) {
              acc[blockId] = block
            }
            return acc
          },
          {} as typeof workflowBlocks
        )

        const isExecutingFromChat =
          overrideTriggerType === 'chat' ||
          (workflowInput && typeof workflowInput === 'object' && 'input' in workflowInput)

        // Merge subblock states
        const mergedStates = mergeSubblockState(validBlocks, activeWorkflowId)

        // Filter out invalid blocks
        const filteredStates = Object.entries(mergedStates).reduce(
          (acc, [id, block]) => {
            if (!block || !block.type) {
              logger.warn(`Skipping block with undefined type: ${id}`)
              return acc
            }
            acc[id] = block
            return acc
          },
          {} as typeof mergedStates
        )

        // Convert to block states format
        const currentBlockStates = Object.entries(filteredStates).reduce(
          (acc, [id, block]) => {
            acc[id] = Object.entries(block.subBlocks).reduce(
              (subAcc, [key, subBlock]) => {
                subAcc[key] = subBlock.value
                return subAcc
              },
              {} as Record<string, any>
            )
            return acc
          },
          {} as Record<string, Record<string, any>>
        )

        // Get workflow variables
        const workflowVars = getVariablesByWorkflowId(activeWorkflowId)
        const workflowVariables = workflowVars.reduce(
          (acc, variable) => {
            acc[variable.id] = variable
            return acc
          },
          {} as Record<string, any>
        )

        // Determine start block
        let startBlockId: string | undefined
        let finalWorkflowInput = workflowInput

        if (isExecutingFromChat) {
          const startBlock = TriggerUtils.findStartBlock(filteredStates, 'chat')
          if (!startBlock) {
            throw new Error(TriggerUtils.getTriggerValidationMessage('chat', 'missing'))
          }
          startBlockId = startBlock.blockId
        } else {
          const candidates = resolveStartCandidates(filteredStates, {
            execution: 'manual',
          })

          if (candidates.length === 0) {
            throw new Error('Manual run requires a Manual, Input Form, or API Trigger block')
          }

          const selectedCandidate = candidates[0]
          startBlockId = selectedCandidate.blockId

          // Extract test values from input format if available
          const selectedTrigger = selectedCandidate.block
          const inputFormatValue = selectedTrigger.subBlocks?.inputFormat?.value

          if (Array.isArray(inputFormatValue)) {
            const testInput: Record<string, any> = {}
            inputFormatValue.forEach((field: any) => {
              if (field && typeof field === 'object' && field.name && field.value !== undefined) {
                testInput[field.name] = field.value
              }
            })

            if (Object.keys(testInput).length > 0) {
              finalWorkflowInput = testInput
            }
          }
        }

        if (!startBlockId) {
          throw new Error('No valid trigger block found to start execution')
        }

        // Get selected outputs for chat
        let selectedOutputs: string[] | undefined
        if (isExecutingFromChat) {
          const chatStore = await import('@/stores/panel/chat/store').then(
            (mod) => mod.useChatStore
          )
          selectedOutputs = chatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
        }

        // Prepare execution result
        let executionResult: ExecutionResult = {
          success: false,
          output: {},
          logs: [],
        }

        const activeBlocksSet = new Set<string>()
        const streamedContent = new Map<string, string>()

        // Execute via SSE
        await executionStream.execute({
          workflowId: activeWorkflowId,
          input: finalWorkflowInput,
          workflowInput: finalWorkflowInput,
          currentBlockStates,
          workflowVariables,
          selectedOutputs,
          startBlockId,
          callbacks: {
            onExecutionStarted: (data) => {
              logger.info('Execution started:', data)
            },

            onBlockStarted: (data) => {
              activeBlocksSet.add(data.blockId)
              setActiveBlocks(activeBlocksSet)
            },

            onBlockCompleted: (data) => {
              activeBlocksSet.delete(data.blockId)
              setActiveBlocks(activeBlocksSet)

              // Add to console
              addConsole({
                input: {},
                output: data.output,
                success: true,
                durationMs: data.durationMs,
                startedAt: new Date(Date.now() - data.durationMs).toISOString(),
                endedAt: new Date().toISOString(),
                workflowId: activeWorkflowId,
                blockId: data.blockId,
                executionId: executionId || uuidv4(),
                blockName: data.blockName,
                blockType: data.blockType,
              })
            },

            onBlockError: (data) => {
              activeBlocksSet.delete(data.blockId)
              setActiveBlocks(activeBlocksSet)

              // Add error to console
              addConsole({
                input: {},
                output: {},
                success: false,
                error: data.error,
                durationMs: data.durationMs,
                startedAt: new Date(Date.now() - data.durationMs).toISOString(),
                endedAt: new Date().toISOString(),
                workflowId: activeWorkflowId,
                blockId: data.blockId,
                executionId: executionId || uuidv4(),
                blockName: data.blockName,
                blockType: data.blockType,
              })
            },

            onStreamChunk: (data) => {
              const existing = streamedContent.get(data.blockId) || ''
              streamedContent.set(data.blockId, existing + data.chunk)
              // TODO: Update UI with streaming content
            },

            onStreamDone: (data) => {
              logger.info('Stream done for block:', data.blockId)
            },

            onExecutionCompleted: (data) => {
              executionResult = {
                success: data.success,
                output: data.output,
                metadata: {
                  duration: data.duration,
                  startTime: data.startTime,
                  endTime: data.endTime,
                },
                logs: [],
              }
            },

            onExecutionError: (data) => {
              executionResult = {
                success: false,
                output: {},
                error: data.error,
                metadata: {
                  duration: data.duration,
                },
                logs: [],
              }
            },
          },
        })

        setIsExecuting(false)
        setActiveBlocks(new Set())

        return executionResult
      } catch (error: any) {
        setIsExecuting(false)
        setActiveBlocks(new Set())

        logger.error('Workflow execution failed:', error)

        addConsole({
          input: {},
          output: {},
          success: false,
          error: error.message || 'Workflow execution failed',
          durationMs: 0,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          workflowId: activeWorkflowId,
          blockId: 'execution',
          executionId: executionId || uuidv4(),
          blockName: 'Workflow',
          blockType: 'execution',
        })

        throw error
      }
    },
    [
      activeWorkflowId,
      currentWorkflow,
      setIsExecuting,
      setActiveBlocks,
      setPendingBlocks,
      addConsole,
      getVariablesByWorkflowId,
      executionStream,
    ]
  )

  const cancelExecution = useCallback(() => {
    executionStream.cancel()
    setIsExecuting(false)
    setActiveBlocks(new Set())
  }, [executionStream, setIsExecuting, setActiveBlocks])

  return {
    executeWorkflow,
    cancelExecution,
  }
}

