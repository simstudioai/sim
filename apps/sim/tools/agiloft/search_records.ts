import type { AgiloftSearchRecordsParams, AgiloftSearchResponse } from '@/tools/agiloft/types'
import { buildSearchRecordsUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftSearchRecordsTool: ToolConfig<
  AgiloftSearchRecordsParams,
  AgiloftSearchResponse
> = {
  id: 'agiloft_search_records',
  name: 'Agiloft Search Records',
  description: 'Search for records in an Agiloft table using a query.',
  version: '1.0.0',

  params: {
    instanceUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft instance URL (e.g., https://mycompany.agiloft.com)',
    },
    knowledgeBase: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Knowledge base name',
    },
    login: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Agiloft password',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Table name to search in (e.g., "contracts", "contacts.employees")',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Search query using Agiloft query syntax (e.g., "status=\'Active\'" or "company_name~=\'Acme\'")',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of field names to include in the results',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number for paginated results (starting from 0)',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of records to return per page',
    },
  },

  request: {
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftSearchResponse>(
      params,
      (base) => ({
        url: buildSearchRecordsUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { records: [], totalCount: 0, page: 0, limit: 25 },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = (await response.json()) as Record<string, unknown>
        const records: Record<string, unknown>[] = []

        if (data.result && Array.isArray(data.result)) {
          for (const item of data.result as Record<string, unknown>[]) {
            records.push(item)
          }
        } else if (Array.isArray(data)) {
          for (const item of data as Record<string, unknown>[]) {
            records.push(item)
          }
        } else if (data.results && Array.isArray(data.results)) {
          for (const item of data.results as Record<string, unknown>[]) {
            records.push(item)
          }
        } else if (data.records && Array.isArray(data.records)) {
          for (const item of data.records as Record<string, unknown>[]) {
            records.push(item)
          }
        } else if (typeof data.EWREST_length === 'number') {
          const count = data.EWREST_length as number
          for (let i = 0; i < count; i++) {
            const record: Record<string, unknown> = {}
            for (const key of Object.keys(data)) {
              const match = key.match(/^EWREST_(.+)_(\d+)$/)
              if (match && Number(match[2]) === i) {
                record[match[1]] = data[key]
              }
            }
            if (Object.keys(record).length > 0) {
              records.push(record)
            }
          }
        }

        const totalCount =
          (data.totalCount as number) ??
          (data.total as number) ??
          (data.count as number) ??
          (data.EWREST_length as number) ??
          records.length
        const page = params.page ? Number(params.page) : 0
        const limit = params.limit ? Number(params.limit) : 25

        return {
          success: data.success !== false,
          output: {
            records,
            totalCount,
            page,
            limit,
          },
        }
      }
    )
  },

  outputs: {
    records: {
      type: 'json',
      description: 'Array of matching records with their field values',
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching records',
    },
    page: {
      type: 'number',
      description: 'Current page number',
    },
    limit: {
      type: 'number',
      description: 'Records per page',
    },
  },
}
