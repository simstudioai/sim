import type { RipplingListCompaniesParams } from '@/tools/rippling/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import { nextCursorFromLink } from '@/tools/rippling/utils'
import { RIPPLING_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCompaniesTool: ToolConfig<RipplingListCompaniesParams> = {
  id: 'rippling_list_companies',
  name: 'Rippling List Companies',
  description: 'List all companies',
  version: '1.0.0',
  oauth: RIPPLING_CREDENTIAL_OAUTH,
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
      description:
        'Sort field(s), comma-separated; append " desc" for descending (e.g. created_at desc)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the nextCursor output of the previous page',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.expand != null) query.set('expand', params.expand)
      if (params.orderBy != null) query.set('order_by', params.orderBy)
      if (params.cursor != null) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/companies/${qs ? `?${qs}` : ''}`
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
        companies: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          legal_name: (item.legal_name as string) ?? null,
          doing_business_as_name: (item.doing_business_as_name as string) ?? null,
          phone: (item.phone as string) ?? null,
          primary_email: (item.primary_email as string) ?? null,
          parent_legal_entity_id: (item.parent_legal_entity_id as string) ?? null,
          legal_entities_id: (item.legal_entities_id as unknown[]) ?? [],
          physical_address: item.physical_address ?? null,
          parent_legal_entity: item.parent_legal_entity ?? null,
          legal_entities: item.legal_entities ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        nextCursor: nextCursorFromLink(data.next_link),
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    companies: {
      type: 'array',
      description: 'List of companies',
      items: { type: 'object', properties: COMPANY_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    nextCursor: {
      type: 'string',
      description:
        'Cursor for the next page; pass it back as the cursor param (null on the last page)',
      optional: true,
      nullable: true,
    },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
