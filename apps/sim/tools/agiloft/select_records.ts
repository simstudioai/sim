import type { AgiloftSelectRecordsParams, AgiloftSelectResponse } from '@/tools/agiloft/types'
import { buildSelectRecordsUrl, executeAgiloftRequest } from '@/tools/agiloft/utils'
import type { ToolConfig } from '@/tools/types'

export const agiloftSelectRecordsTool: ToolConfig<
  AgiloftSelectRecordsParams,
  AgiloftSelectResponse
> = {
  id: 'agiloft_select_records',
  name: 'Agiloft Select Records',
  description: 'Select record IDs matching a SQL WHERE clause from an Agiloft table.',
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
      description: 'Table name (e.g., "contracts", "contacts.employees")',
    },
    where: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SQL WHERE clause using database column names (e.g., "summary like \'%new%\'" or "assigned_person=\'John Doe\'")',
    },
  },

  request: {
    url: 'https://placeholder.agiloft.com',
    method: 'GET',
    headers: () => ({}),
  },

  directExecution: async (params) => {
    return executeAgiloftRequest<AgiloftSelectResponse>(
      params,
      (base) => ({
        url: buildSelectRecordsUrl(base, params),
        method: 'GET',
      }),
      async (response) => {
        if (!response.ok) {
          const errorText = await response.text()
          return {
            success: false,
            output: { recordIds: [], totalCount: 0 },
            error: `Agiloft error: ${response.status} - ${errorText}`,
          }
        }

        const data = await response.json()
        const result = data.result ?? data
        const recordIds: string[] = []

        if (Array.isArray(result)) {
          for (const item of result) {
            const id = item.id ?? item.ID ?? item
            recordIds.push(String(id))
          }
        } else if (typeof result === 'object' && result !== null) {
          let i = 0
          while (result[`id_${i}`] !== undefined || result[`EWREST_id_${i}`] !== undefined) {
            const id = result[`id_${i}`] ?? result[`EWREST_id_${i}`]
            recordIds.push(String(id))
            i++
          }
          if (recordIds.length === 0 && result.id !== undefined) {
            recordIds.push(String(result.id))
          }
        }

        const totalCount =
          data.EWREST_id_length ?? data.totalCount ?? data.total ?? data.count ?? recordIds.length

        return {
          success: data.success !== false,
          output: {
            recordIds,
            totalCount: Number(totalCount),
          },
        }
      }
    )
  },

  outputs: {
    recordIds: {
      type: 'array',
      description: 'Array of record IDs matching the query',
      items: {
        type: 'string',
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching records',
    },
  },
}
