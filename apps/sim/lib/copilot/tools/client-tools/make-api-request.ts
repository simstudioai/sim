/**
 * Make API Request - Client-side wrapper that posts to methods route (requires interrupt)
 */

import { BaseTool } from '@/lib/copilot/tools/base-tool'
import type { CopilotToolCall, ToolExecuteResult, ToolExecutionOptions, ToolMetadata } from '@/lib/copilot/tools/types'
import { createLogger } from '@/lib/logs/console/logger'

export class MakeApiRequestClientTool extends BaseTool {
  static readonly id = 'make_api_request'

  metadata: ToolMetadata = {
    id: MakeApiRequestClientTool.id,
    displayConfig: {
      states: {
        pending: { displayName: 'Make API request?', icon: 'edit' },
        executing: { displayName: 'Making API request', icon: 'spinner' },
        success: { displayName: 'Made API request', icon: 'globe' },
        rejected: { displayName: 'Skipped API request', icon: 'skip' },
        errored: { displayName: 'Failed to make API request', icon: 'error' },
        aborted: { displayName: 'Aborted API request', icon: 'abort' },
      },
    },
    schema: {
      name: MakeApiRequestClientTool.id,
      description: 'Make an HTTP API request',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT'] },
          queryParams: { type: 'object' },
          headers: { type: 'object' },
          body: { type: 'object' },
        },
        required: ['url', 'method'],
      },
    },
    requiresInterrupt: true,
  }

  async execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    const logger = createLogger('MakeApiRequestClientTool')

    try {
      options?.onStateChange?.('executing')

      const ext = toolCall as CopilotToolCall & { arguments?: any }
      if (ext.arguments && !toolCall.parameters && !toolCall.input) { toolCall.input = ext.arguments; toolCall.parameters = ext.arguments }
      const provided = toolCall.parameters || toolCall.input || ext.arguments || {}

      const url = provided.url
      const method = provided.method
      const queryParams = provided.queryParams
      const headers = provided.headers
      const body = provided.body

      if (!url || !method) { options?.onStateChange?.('errored'); return { success:false, error:'url and method are required' } }

      const requestBody = { methodId: 'make_api_request', params: { url, method, ...(queryParams?{queryParams}:{}) , ...(headers?{headers}:{}) , ...(body?{body}:{}) }, toolCallId: toolCall.id, toolId: toolCall.id }

      const response = await fetch('/api/copilot/methods', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(requestBody) })
      if (!response.ok) { const e = await response.json().catch(()=>({})); options?.onStateChange?.('errored'); return { success:false, error: e?.error || 'Failed to make API request' } }

      const result = await response.json()
      if (!result.success) { options?.onStateChange?.('errored'); return { success:false, error: result.error || 'Server method failed' } }

      options?.onStateChange?.('success')
      return { success:true, data: result.data }
    } catch (error:any) {
      options?.onStateChange?.('errored')
      return { success:false, error: error?.message || 'Unexpected error' }
    }
  }
} 