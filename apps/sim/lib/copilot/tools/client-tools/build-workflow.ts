/**
 * Build Workflow - Client-side wrapper that posts to methods route
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

export class BuildWorkflowClientTool extends BaseTool {
  static readonly id = 'build_workflow'

  metadata: ToolMetadata = {
    id: BuildWorkflowClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Building workflow from YAML', icon: 'spinner' },
        success: { displayName: 'Built workflow', icon: 'grid2x2Check' },
        ready_for_review: { displayName: 'Ready for review', icon: 'grid2x2' },
        rejected: { displayName: 'Skipped building workflow', icon: 'skip' },
        errored: { displayName: 'Failed to build workflow', icon: 'error' },
        aborted: { displayName: 'Aborted building workflow', icon: 'abort' },
      },
    },
    schema: {
      name: BuildWorkflowClientTool.id,
      description: 'Build a new workflow from YAML',
      parameters: {
        type: 'object',
        properties: {
          yamlContent: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['yamlContent'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult> {
    const logger = createLogger('BuildWorkflowClientTool')
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

      const yamlContent: string = provided.yamlContent || provided.yaml || provided.content || ''
      const description: string | undefined = provided.description || provided.desc

      if (!yamlContent || typeof yamlContent !== 'string') {
        options?.onStateChange?.('errored')
        return { success: false, error: 'yamlContent is required' }
      }

      // 1) Call logic-only execute route to get build result without emitting completion
      const execResp = await fetch('/api/copilot/workflows/build/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ yamlContent, ...(description ? { description } : {}) }),
      })
      if (!execResp.ok) {
        const e = await execResp.json().catch(() => ({}))
        options?.onStateChange?.('errored')
        return { success: false, error: e?.error || 'Failed to build workflow' }
      }
      const execResult = await execResp.json()
      if (!execResult.success) {
        options?.onStateChange?.('errored')
        return { success: false, error: execResult.error || 'Server method failed' }
      }

      // 2) Update diff from YAML
      try {
        await useWorkflowDiffStore.getState().setProposedChanges(yamlContent)
        logger.info('Diff store updated from build_workflow YAML')
      } catch (e) {
        logger.warn('Failed to update diff from build_workflow YAML', {
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
            methodId: 'build_workflow',
            success: true,
            data: execResult.data,
          }),
        })
      } catch {}

      // Transition to ready_for_review for store compatibility
      options?.onStateChange?.('success')
      options?.onStateChange?.('ready_for_review')

      return {
        success: true,
        data: {
          yamlContent,
          ...(description ? { description } : {}),
          ...(execResult?.data ? { data: execResult.data } : {}),
        },
      }
    } catch (error: any) {
      options?.onStateChange?.('errored')
      return { success: false, error: error?.message || 'Unexpected error' }
    }
  }
}
