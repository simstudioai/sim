/**
 * Edit Workflow - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type {
  CopilotToolCall,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
} from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class EditWorkflowClientTool extends BaseTool {
  static readonly id = 'edit_workflow'

  metadata: ToolMetadata = {
    id: EditWorkflowClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Editing workflow', icon: 'spinner' },
        success: { displayName: 'Edited workflow', icon: 'grid2x2Check' },
        ready_for_review: { displayName: 'Ready for review', icon: 'grid2x2' },
        rejected: { displayName: 'Skipped editing workflow', icon: 'skip' },
        errored: { displayName: 'Failed to edit workflow', icon: 'error' },
        aborted: { displayName: 'Aborted editing workflow', icon: 'abort' },
      },
    },
    schema: {
      name: EditWorkflowClientTool.id,
      description: 'Edit the current workflow with targeted operations',
      parameters: {
        type: 'object',
        properties: {
          operations: { type: 'array', items: { type: 'object' } },
          workflowId: { type: 'string' },
          currentUserWorkflow: { type: 'string' },
        },
        required: ['operations', 'workflowId'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('EditWorkflowClientTool')
    const safeStringify = (o: any, m = 800) => {
      try {
        if (o === undefined) return 'undefined'
        if (o === null) return 'null'
        return JSON.stringify(o).substring(0, m)
      } catch {
        return '[unserializable]'
      }
    }

    try {
      options?.onStateChange?.('executing')
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) {
        toolCall.input = ext.arguments
        toolCall.parameters = ext.arguments
      }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const operations = provided.operations || provided.ops || []
      let workflowId = provided.workflowId || provided.workflow_id || ''
      const currentUserWorkflow = provided.currentUserWorkflow || provided.current_workflow

      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) workflowId = activeWorkflowId
      }

      if (!Array.isArray(operations) || !workflowId) {
        options?.onStateChange?.('errored')
        return { success: false, error: 'operations and workflowId are required' }
      }

      const body = {
        methodId: 'edit_workflow',
        params: { operations, workflowId, ...(currentUserWorkflow ? { currentUserWorkflow } : {}) },
        toolCallId: toolCall.id,
        toolId: toolCall.id,
      }

      const response = await fetch('/api/copilot/methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const e = await response.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return { success: false, error: e?.error || 'Failed to edit workflow' }
      }
      const result = await response.json()
      if (!result.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: result.error || 'Server method failed' }
      }

      // If server returned YAML, trigger diff view
      try {
        const yamlContent: string | undefined = result?.data?.yamlContent
        if (yamlContent && typeof yamlContent === 'string') {
          await useWorkflowDiffStore.getState().setProposedChanges(yamlContent)
          logger.info('Diff store updated from edit_workflow result', {
            yamlLength: yamlContent.length,
          })
        }
      } catch (e) {
        logger.warn('Failed to update diff store from edit_workflow result', {
          error: e instanceof Error ? e.message : String(e),
        })
      }

      options?.onStateChange?.('success')
      options?.onStateChange?.('ready_for_review')
      return { success: true, data: result.data }
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
