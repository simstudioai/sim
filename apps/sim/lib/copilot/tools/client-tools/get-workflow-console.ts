/**
 * Get Workflow Console - Client-side wrapper that posts to methods route
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class GetWorkflowConsoleClientTool extends BaseTool {
  static readonly id = 'get_workflow_console'

  metadata: ToolMetadata = {
    id: GetWorkflowConsoleClientTool.id,
    displayConfig: {
      states: {
        executing: { displayName: 'Reading workflow console', icon: 'spinner' },
        success: { displayName: 'Read workflow console', icon: 'squareTerminal' },
        rejected: { displayName: 'Skipped reading console', icon: 'skip' },
        errored: { displayName: 'Failed to read console', icon: 'error' },
        aborted: { displayName: 'Aborted reading console', icon: 'abort' },
      },
    },
    schema: {
      name: GetWorkflowConsoleClientTool.id,
      description: 'Get workflow console output and recent executions',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          limit: { type: 'number' },
          includeDetails: { type: 'boolean' },
        },
        required: ['workflowId'],
      },
    },
    requiresInterrupt: false,
  }

  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    const logger = createLogger('GetWorkflowConsoleClientTool')
    const safeStringify = (o:any,m:number=800)=>{try{if(o===undefined)return'undefined';if(o===null)return'null';return JSON.stringify(o).substring(0,m)}catch{return'[unserializable]'}}

    try {
      options?.onStateChange?.('executing')
      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) { toolCall.input = ext.arguments; toolCall.parameters = ext.arguments }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const workflowId = provided.workflowId || provided.workflow_id || ''
      const limit = provided.limit
      const includeDetails = provided.includeDetails ?? provided.include_details

      if (!workflowId) { options?.onStateChange?.('errored'); return { success:false, error:'workflowId is required' } }

      const paramsToSend: any = { workflowId }
      if (typeof limit === 'number') paramsToSend.limit = limit
      if (typeof includeDetails === 'boolean') paramsToSend.includeDetails = includeDetails

      const body = { methodId: 'get_workflow_console', params: paramsToSend, toolCallId: toolCall.id, toolId: toolCall.id }
      logger.info('Sending request', { body: safeStringify(body, 1200) })

      const response = await fetch('/api/copilot/methods', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) })
      if (!response.ok) { const e = await response.json().catch(()=>({})); options?.onStateChange?.('errored'); return { success:false, error: e?.error || 'Failed to get console' } }
      const result = await response.json()
      if (!result.success) { options?.onStateChange?.('errored'); return { success:false, error: result.error || 'Server method failed' } }
      options?.onStateChange?.('success');
      return { success:true, data: result.data }
    } catch (error:any) {
      options?.onStateChange?.('errored')
      return { success:false, error: error?.message || 'Unexpected error' }
    }
  }
} 