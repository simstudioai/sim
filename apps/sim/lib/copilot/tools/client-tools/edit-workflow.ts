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
import { useCopilotStore } from '@/stores/copilot/store'

export class EditWorkflowClientTool extends BaseTool {
  static readonly id = 'edit_workflow'

  metadata: ToolMetadata = {
    id: EditWorkflowClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Editing workflow', icon: 'spinner' },
        success: { displayName: 'Edited workflow', icon: 'grid2x2Check' },
        ready_for_review: { displayName: 'Ready for review', icon: 'grid2x2' },
        rejected: { displayName: 'Skipped editing workflow', icon: 'circle-slash' },
        errored: { displayName: 'Failed to edit workflow', icon: 'error' },
        aborted: { displayName: 'Aborted editing workflow', icon: 'abort' },
        accepted: { displayName: 'Edited workflow', icon: 'grid2x2Check' },
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

      // 1) Call logic-only execute route to get YAML without emitting completion
      const execResp = await fetch('/api/copilot/workflows/edit/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ operations, workflowId, ...(currentUserWorkflow ? { currentUserWorkflow } : {}) }),
      })
      if (!execResp.ok) {
        const e = await execResp.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return { success: false, error: e?.error || 'Failed to edit workflow' }
      }
      const execResult = await execResp.json()
      if (!execResult.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: execResult.error || 'Server method failed' }
      }

      // 2) Update diff first
      try {
        const yamlContent: string | undefined = execResult?.data?.yamlContent
        if (yamlContent && typeof yamlContent === 'string') {
          const { isSendingMessage } = useCopilotStore.getState()
          if (isSendingMessage) {
            const start = Date.now()
            while (useCopilotStore.getState().isSendingMessage && Date.now() - start < 5000) {
              await new Promise((r) => setTimeout(r, 100))
            }
          }

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

      // 3) Notify completion to agent without re-executing logic
      try {
        await fetch('/api/copilot/tools/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            toolId: toolCall.id,
            methodId: 'edit_workflow',
            success: true,
            data: execResult.data,
          }),
        })
      } catch {}

      options?.onStateChange?.('success')
      options?.onStateChange?.('ready_for_review')
      return { success: true, data: execResult.data }
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
