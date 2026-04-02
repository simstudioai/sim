import type { RipplingListEntitlementsParams } from '@/tools/rippling/types'
import { ENTITLEMENT_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListEntitlementsTool: ToolConfig<RipplingListEntitlementsParams> = {
  id: 'rippling_list_entitlements',
  name: 'Rippling List Entitlements',
  description: 'List all entitlements',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/entitlements/`,
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
        entitlements: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          description: (item.description as string) ?? null,
          display_name: (item.display_name as string) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    entitlements: {
      type: 'array',
      description: 'List of entitlements',
      items: { type: 'object', properties: ENTITLEMENT_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
