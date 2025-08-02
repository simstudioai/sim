/**
 * Run Workflow Tool
 */

import { BaseTool } from '../base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolMetadata, ToolExecutionOptions } from '../types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { Executor } from '@/executor'
import { Serializer } from '@/serializer'
import { getBlock } from '@/blocks'

interface RunWorkflowParams {
  workflowId?: string
  description?: string
  workflow_input?: string
}

export class RunWorkflowTool extends BaseTool {
  static readonly id = 'run_workflow'

  metadata: ToolMetadata = {
    id: RunWorkflowTool.id,
    displayConfig: {
      states: {
        pending: {
          displayName: 'Run workflow?',
          icon: 'play'
        },
        executing: {
          displayName: 'Running workflow',
          icon: 'loader'
        },
        accepted: {
          displayName: 'Running workflow',
          icon: 'play'
        },
        success: {
          displayName: 'Executed workflow',
          icon: 'check'
        },
        rejected: {
          displayName: 'Skipped workflow execution',
          icon: 'skip'
        },
        errored: {
          displayName: 'Failed to execute workflow',
          icon: 'error'
        },
        background: {
          displayName: 'Running workflow in background',
          icon: 'background'
        }
      }
    },
    schema: {
      name: RunWorkflowTool.id,
      description: 'Execute a workflow with optional input',
      parameters: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'The ID of the workflow to run'
          },
          description: {
            type: 'string',
            description: 'Description of what the workflow does'
          },
          workflow_input: {
            type: 'string',
            description: 'Input text to pass to the workflow chat'
          }
        },
        required: []
      }
    },
    requiresInterrupt: true,
    allowBackgroundExecution: true,
    stateMessages: {
      success: 'Workflow successfully executed',
      background: 'User moved workflow exectuion to background. The workflow execution is not complete, but will continue to run in the background.',
      error: 'Error during workflow execution',
      rejected: 'The user chose to skip the workflow execution'
    }
  }

  /**
   * Execute the tool - run the workflow
   * This includes showing a background prompt and handling background vs foreground execution
   */
  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    try {
      // Parse parameters from either toolCall.parameters or toolCall.input
      const rawParams = toolCall.parameters || toolCall.input || {}
      const params = rawParams as RunWorkflowParams
      
      console.log('Run workflow execute called with params:', params)
      console.log('Tool call object:', toolCall)
      
      // Check if workflow is already executing
      const { isExecuting } = useExecutionStore.getState()
      if (isExecuting) {
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: 'The workflow is already in the middle of an execution. Try again later'
        }
      }

      // Get current workflow and execution context
      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        options?.onStateChange?.('errored')
        return {
          success: false,
          error: 'No active workflow found'
        }
      }

      // Get current workflow state
      const workflowState = useWorkflowStore.getState().getWorkflowState()
      const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore.getState()
      
      // Determine which workflow to use - same logic as useCurrentWorkflow
      const shouldUseDiff = isShowingDiff && isDiffReady && !!diffWorkflow
      const currentWorkflow = shouldUseDiff ? diffWorkflow : workflowState

      const {
        blocks: workflowBlocks,
        edges: workflowEdges,
        loops: workflowLoops,
        parallels: workflowParallels,
      } = currentWorkflow

      // Filter out blocks without type (these are layout-only blocks)
      const validBlocks = Object.entries(workflowBlocks).reduce(
        (acc, [blockId, block]) => {
          if (block?.type) {
            acc[blockId] = block
          }
          return acc
        },
        {} as typeof workflowBlocks
      )

      // Prepare workflow input
      const chatInput = params.workflow_input
      const workflowInput = chatInput ? { input: chatInput } : undefined
      const isExecutingFromChat = !!workflowInput

      console.log('Executing workflow', {
        isDiffMode: shouldUseDiff,
        isExecutingFromChat,
        totalBlocksCount: Object.keys(workflowBlocks).length,
        validBlocksCount: Object.keys(validBlocks).length,
        edgesCount: workflowEdges.length,
      })

      // Merge subblock states from the appropriate store
      const mergedStates = mergeSubblockState(validBlocks)

      // Filter out trigger blocks for manual execution
      const filteredStates = Object.entries(mergedStates).reduce(
        (acc, [id, block]) => {
          // Skip blocks with undefined type
          if (!block || !block.type) {
            console.warn(`Skipping block with undefined type: ${id}`, block)
            return acc
          }

          const blockConfig = getBlock(block.type)
          const isTriggerBlock = blockConfig?.category === 'triggers'

          // Skip trigger blocks during manual execution
          if (!isTriggerBlock) {
            acc[id] = block
          }
          return acc
        },
        {} as typeof mergedStates
      )

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

      // Get environment variables
      const { getAllVariables } = useEnvironmentStore.getState()
      const { getVariablesByWorkflowId } = useVariablesStore.getState()
      const envVars = getAllVariables()
      const envVarValues = Object.entries(envVars).reduce(
        (acc, [key, variable]: [string, any]) => {
          acc[key] = variable.value
          return acc
        },
        {} as Record<string, string>
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

      // Filter edges to exclude connections to/from trigger blocks
      const triggerBlockIds = Object.keys(mergedStates).filter((id) => {
        const blockConfig = getBlock(mergedStates[id].type)
        return blockConfig?.category === 'triggers'
      })

      const filteredEdges = workflowEdges.filter(
        (edge) => !triggerBlockIds.includes(edge.source) && !triggerBlockIds.includes(edge.target)
      )

      // Create serialized workflow with filtered blocks and edges
      const workflow = new Serializer().serializeWorkflow(
        filteredStates,
        filteredEdges,
        workflowLoops || {},
        workflowParallels || {}
      )

      // If this is a chat execution, get the selected outputs
      let selectedOutputIds: string[] | undefined
      if (isExecutingFromChat) {
        const { useChatStore } = await import('@/stores/panel/chat/store')
        selectedOutputIds = useChatStore.getState().getSelectedWorkflowOutput(activeWorkflowId)
      }

      // Create executor options
      const executorOptions = {
        workflow,
        currentBlockStates,
        envVarValues,
        workflowInput,
        workflowVariables,
        contextExtensions: {
          stream: isExecutingFromChat,
          selectedOutputIds,
          edges: workflow.connections.map((conn) => ({
            source: conn.source,
            target: conn.target,
          })),
          executionId: toolCall.id,
        },
      }

      // Create executor and execute
      const executor = new Executor(executorOptions)
      const { setExecutor, setIsExecuting } = useExecutionStore.getState()
      
      setExecutor(executor)
      setIsExecuting(true)

      // Start execution
      console.log('Starting workflow execution...')
      options?.onStateChange?.('executing')
      
      const result = await executor.execute(activeWorkflowId)
      
      console.log('Workflow execution result:', result)

      // Handle execution completion
      setIsExecuting(false)

      // Check if execution was successful
      if (result && (!('success' in result) || result.success !== false)) {
        // Notify success - workflow actually completed
        await this.notify(
          toolCall.id,
          'success',
          'Workflow execution completed successfully'
        )
        
        options?.onStateChange?.('success')
        
        return {
          success: true,
          data: {
            workflowId: params.workflowId || activeWorkflowId,
            description: params.description,
            message: 'Workflow execution finished successfully'
          }
        }
      } else {
        // Execution failed - notify error
        const errorMessage = result?.error || 'Workflow execution failed'
        
        await this.notify(
          toolCall.id,
          'errored',
          `Workflow execution failed: ${errorMessage}`
        )
        
        options?.onStateChange?.('errored')
        
        return {
          success: false,
          error: errorMessage
        }
      }
    } catch (error) {
      console.error('Error in run workflow tool:', error)
      
      // Reset execution state
      const { setIsExecuting } = useExecutionStore.getState()
      setIsExecuting(false)
      
      // Notify error - actual error occurred during execution
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.notify(
        toolCall.id,
        'errored',
        `Workflow execution error: ${errorMessage}`
      )
      
      options?.onStateChange?.('errored')
      
      return {
        success: false,
        error: errorMessage
      }
    }
  }

} 