import type { RipplingListWorkersParams } from '@/tools/rippling/types'
import { WORKER_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListWorkersTool: ToolConfig<RipplingListWorkersParams> = {
  id: 'rippling_list_workers',
  name: 'Rippling List Workers',
  description: 'List all workers with optional filtering and pagination',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field. Prefix with - for descending',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.filter != null) query.set('filter', params.filter)
      if (params.expand != null) query.set('expand', params.expand)
      if (params.orderBy != null) query.set('order_by', params.orderBy)
      if (params.cursor != null) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/workers/${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    const results = data.results ?? []
    return {
      success: true,
      output: {
        workers: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          user_id: (item.user_id as string) ?? null,
          is_manager: (item.is_manager as boolean) ?? null,
          manager_id: (item.manager_id as string) ?? null,
          legal_entity_id: (item.legal_entity_id as string) ?? null,
          country: (item.country as string) ?? null,
          start_date: (item.start_date as string) ?? null,
          end_date: (item.end_date as string) ?? null,
          number: (item.number as number) ?? null,
          work_email: (item.work_email as string) ?? null,
          personal_email: (item.personal_email as string) ?? null,
          status: (item.status as string) ?? null,
          employment_type_id: (item.employment_type_id as string) ?? null,
          department_id: (item.department_id as string) ?? null,
          teams_id: (item.teams_id as unknown[]) ?? [],
          title: (item.title as string) ?? null,
          level_id: (item.level_id as string) ?? null,
          compensation_id: (item.compensation_id as string) ?? null,
          overtime_exemption: (item.overtime_exemption as string) ?? null,
          title_effective_date: (item.title_effective_date as string) ?? null,
          business_partners_id: (item.business_partners_id as unknown[]) ?? [],
          location: item.location ?? null,
          gender: (item.gender as string) ?? null,
          date_of_birth: (item.date_of_birth as string) ?? null,
          race: (item.race as string) ?? null,
          ethnicity: (item.ethnicity as string) ?? null,
          citizenship: (item.citizenship as string) ?? null,
          termination_details: item.termination_details ?? null,
          custom_fields: item.custom_fields ?? null,
          country_fields: item.country_fields ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    workers: {
      type: 'array',
      description: 'List of workers',
      items: { type: 'object', properties: WORKER_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
