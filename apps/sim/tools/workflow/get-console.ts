import type { ToolConfig } from '@/tools/types'

interface GetConsoleParams {
  limit?: number
  includeDetails?: boolean
  _context?: {
    workflowId: string
  }
}

interface GetConsoleResponse {
  entries: Array<{
    id: string
    executionId: string
    level?: string
    message?: string
    trigger?: string
    startedAt: string
    endedAt: string | null
    durationMs: number | null
    blockCount?: number
    successCount?: number
    errorCount?: number
    totalCost?: number | null
    type: 'execution' | 'block'
    // Block-specific fields (when includeDetails=true)
    blockId?: string
    blockName?: string
    blockType?: string
    status?: string
    success?: boolean
    error?: string | null
    input?: any
    output?: any
    cost?: number | null
    tokens?: number | null
  }>
  totalEntries: number
  workflowId: string
  retrievedAt: string
  hasBlockDetails: boolean
}

export const getWorkflowConsoleTool: ToolConfig<GetConsoleParams, GetConsoleResponse> = {
  id: 'get_workflow_console',
  name: 'Get Workflow Console Logs',
  description:
    'Get console logs and execution history from the current workflow. Returns recent execution logs including block inputs, outputs, execution times, costs, and any errors from workflow runs.',
  version: '1.0.0',

  params: {
    limit: {
      type: 'number',
      required: false,
      description: 'Maximum number of console entries to return (default: 50, max: 100)',
    },
    includeDetails: {
      type: 'boolean',
      required: false,
      description:
        'Whether to include detailed block-level logs for the most recent execution (default: false)',
    },
  },

  // Use API endpoint to access database from server side
  request: {
    url: '/api/tools/get-workflow-console',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      workflowId: params._context?.workflowId,
      limit: params.limit || 50,
      includeDetails: params.includeDetails || false,
    }),
    isInternalRoute: true,
  },
}
