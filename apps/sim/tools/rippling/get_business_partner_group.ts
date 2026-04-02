import type { RipplingGetBusinessPartnerGroupParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetBusinessPartnerGroupTool: ToolConfig<RipplingGetBusinessPartnerGroupParams> =
  {
    id: 'rippling_get_business_partner_group',
    name: 'Rippling Get Business Partner Group',
    description: 'Get a specific business partner group by ID',
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
        const base = `https://rest.ripplingapis.com/business-partner-groups/${encodeURIComponent(params.id.trim())}/`
        if (params.expand != null) return `${base}?expand=${encodeURIComponent(params.expand)}`
        return base
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
      return {
        success: true,
        output: {
          id: (data.id as string) ?? '',
          created_at: (data.created_at as string) ?? null,
          updated_at: (data.updated_at as string) ?? null,
          name: (data.name as string) ?? null,
          domain: (data.domain as string) ?? null,
          default_business_partner_id: (data.default_business_partner_id as string) ?? null,
          __meta: data.__meta ?? null,
        },
      }
    },
    outputs: {
      id: { type: 'string', description: 'ID' },
      created_at: { type: 'string', description: 'Creation date', optional: true },
      updated_at: { type: 'string', description: 'Update date', optional: true },
      name: { type: 'string', description: 'Name', optional: true },
      domain: { type: 'string', description: 'Domain', optional: true },
      default_business_partner_id: {
        type: 'string',
        description: 'Default partner ID',
        optional: true,
      },
      __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
    },
  }
