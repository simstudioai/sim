import type { ToolConfig } from '@/tools/types'

interface TargetedUpdatesParams {
  operations: Array<{
    operation_type: 'add' | 'edit' | 'delete'
    block_id: string
    params?: any
  }>
  _context?: {
    workflowId?: string
  }
}

interface TargetedUpdatesResponse {
  success: boolean
  output: {
    results: Array<{
      operation: any
      success: boolean
      error?: string
    }>
    processedOperations: number
    blockIdMapping?: Record<string, string>
    failedOperations?: Array<{
      operation: any
      success: boolean
      error?: string
    }>
  }
}

export const targetedUpdatesTool: ToolConfig<TargetedUpdatesParams, TargetedUpdatesResponse> = {
  id: 'targeted_updates',
  name: 'Targeted Updates',
  description:
    'Make targeted updates to the workflow with atomic add, edit, or delete operations. Allows precise modifications to specific blocks without affecting the entire workflow.',
  version: '1.0.0',

  params: {
    operations: {
      type: 'array',
      required: true,
      description: 'Array of targeted update operations to perform',
    },
  },

  request: {
    url: '/api/copilot/targeted-updates',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      operations: params.operations,
      workflowId: params._context?.workflowId,
    }),
    isInternalRoute: true,
  },

  transformResponse: async (
    response: Response,
    params?: TargetedUpdatesParams
  ): Promise<TargetedUpdatesResponse> => {
    if (!response.ok) {
      throw new Error(`Targeted updates failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Targeted updates failed')
    }

    return {
      success: true,
      output: data.data || {
        results: [],
        processedOperations: 0,
      },
    }
  },

  transformError: (error: any): string => {
    if (error instanceof Error) {
      return `Targeted updates failed: ${error.message}`
    }
    return 'An unexpected error occurred while performing targeted updates'
  },
}
