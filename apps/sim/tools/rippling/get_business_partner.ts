import type { RipplingGetBusinessPartnerParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetBusinessPartnerTool: ToolConfig<RipplingGetBusinessPartnerParams> = {
  id: 'rippling_get_business_partner',
  name: 'Rippling Get Business Partner',
  description: 'Get a specific business partner by ID',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand',
    },
  },
  request: {
    url: (params) => {
      const base = `https://rest.ripplingapis.com/business-partners/${encodeURIComponent(params.id.trim())}/`
      if (params.expand != null) return `${base}?expand=${encodeURIComponent(params.expand)}`
      return base
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
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        business_partner_group_id: (data.business_partner_group_id as string) ?? null,
        worker_id: (data.worker_id as string) ?? null,
        client_group_id: (data.client_group_id as string) ?? null,
        client_group_member_count: (data.client_group_member_count as number) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    business_partner_group_id: { type: 'string', description: 'Group ID', optional: true },
    worker_id: { type: 'string', description: 'Worker ID', optional: true },
    client_group_id: { type: 'string', description: 'Client group ID', optional: true },
    client_group_member_count: {
      type: 'number',
      description: 'Client group member count',
      optional: true,
    },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
