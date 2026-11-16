import type { RipplingListCustomFieldsParams } from '@/tools/rippling/types'
import { CUSTOM_FIELD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import { nextCursorFromLink } from '@/tools/rippling/utils'
import { RIPPLING_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomFieldsTool: ToolConfig<RipplingListCustomFieldsParams> = {
  id: 'rippling_list_custom_fields',
  name: 'Rippling List Custom Fields',
  description: 'List all custom fields',
  version: '1.0.0',
  oauth: RIPPLING_CREDENTIAL_OAUTH,
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
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
      if (params.orderBy != null) query.set('order_by', params.orderBy)
      if (params.cursor != null) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/custom-fields/${qs ? `?${qs}` : ''}`
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
        customFields: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          description: (item.description as string) ?? null,
          required: (item.required as boolean) ?? null,
          type: (item.type as string) ?? null,
          options: (item.options as string[]) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        nextCursor: nextCursorFromLink(data.next_link),
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    customFields: {
      type: 'array',
      description: 'List of customFields',
      items: { type: 'object', properties: CUSTOM_FIELD_OUTPUT_PROPERTIES },
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
