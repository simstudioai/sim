import type { RipplingListBusinessPartnerGroupsParams } from '@/tools/rippling/types'
import { BUSINESS_PARTNER_GROUP_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListBusinessPartnerGroupsTool: ToolConfig<RipplingListBusinessPartnerGroupsParams> =
  {
    id: 'rippling_list_business_partner_groups',
    name: 'Rippling List Business Partner Groups',
    description: 'List all business partner groups',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
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
        if (params.expand != null) query.set('expand', params.expand)
        if (params.orderBy != null) query.set('order_by', params.orderBy)
        if (params.cursor != null) query.set('cursor', params.cursor)
        const qs = query.toString()
        return `https://rest.ripplingapis.com/business-partner-groups/${qs ? `?${qs}` : ''}`
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
      const results = data.results ?? []
      return {
        success: true,
        output: {
          businessPartnerGroups: results.map((item: Record<string, unknown>) => ({
            id: (item.id as string) ?? '',
            created_at: (item.created_at as string) ?? null,
            updated_at: (item.updated_at as string) ?? null,
            name: (item.name as string) ?? null,
            domain: (item.domain as string) ?? null,
            default_business_partner_id: (item.default_business_partner_id as string) ?? null,
          })),
          totalCount: results.length,
          nextLink: (data.next_link as string) ?? null,
          __meta: data.__meta ?? null,
        },
      }
    },
    outputs: {
      businessPartnerGroups: {
        type: 'array',
        description: 'List of businessPartnerGroups',
        items: { type: 'object', properties: BUSINESS_PARTNER_GROUP_OUTPUT_PROPERTIES },
      },
      totalCount: { type: 'number', description: 'Number of items returned' },
      nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
      __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
    },
  }
