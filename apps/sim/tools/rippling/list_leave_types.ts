import type {
  RipplingListLeaveTypesParams,
  RipplingListLeaveTypesResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListLeaveTypesTool: ToolConfig<
  RipplingListLeaveTypesParams,
  RipplingListLeaveTypesResponse
> = {
  id: 'rippling_list_leave_types',
  name: 'Rippling List Leave Types',
  description: 'List company leave types configured in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    managedBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter leave types by manager',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.managedBy) query.set('managedBy', params.managedBy)
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/company_leave_types${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const results = Array.isArray(data) ? data : (data.results ?? [])

    const leaveTypes = results.map((lt: Record<string, unknown>) => ({
      id: (lt.id as string) ?? '',
      name: (lt.name as string) ?? '',
      managedBy: (lt.managedBy as string) ?? null,
    }))

    return {
      success: true,
      output: {
        leaveTypes,
        totalCount: leaveTypes.length,
      },
    }
  },

  outputs: {
    leaveTypes: {
      type: 'array',
      description: 'List of company leave types',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Leave type ID' },
          name: { type: 'string', description: 'Leave type name' },
          managedBy: { type: 'string', description: 'Manager of this leave type' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of leave types returned',
    },
  },
}
