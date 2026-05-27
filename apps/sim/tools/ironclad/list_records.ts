import type { IroncladListRecordsParams, IroncladListRecordsResponse } from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const listRecordsTool: ToolConfig<IroncladListRecordsParams, IroncladListRecordsResponse> = {
  id: 'ironclad_list_records',
  name: 'Ironclad List Records',
  description:
    'List all records in Ironclad with pagination and optional filtering by last updated time.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ironclad',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (starting from 0)',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 100)',
    },
    lastUpdated: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter records updated on or after this ISO 8601 timestamp',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://na1.ironcladapp.com/public/api/v1/records')
      if (params.page !== undefined) url.searchParams.set('page', String(params.page))
      if (params.pageSize !== undefined) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.lastUpdated) url.searchParams.set('lastUpdated', params.lastUpdated)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to list records')
    }

    const records = (data.list ?? []).map((r: Record<string, unknown>) => ({
      id: (r.id as string) ?? '',
      name: (r.name as string) ?? null,
      type: (r.type as string) ?? null,
      createdAt: (r.createdAt as string) ?? null,
      updatedAt: (r.updatedAt as string) ?? null,
    }))

    return {
      success: true,
      output: {
        records,
        page: data.page ?? 0,
        pageSize: data.pageSize ?? 20,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    records: { type: 'json', description: 'List of records' },
    page: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of results per page' },
    count: { type: 'number', description: 'Total number of records' },
  },
}
