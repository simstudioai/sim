import type { RipplingCreateBusinessPartnerGroupParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateBusinessPartnerGroupTool: ToolConfig<RipplingCreateBusinessPartnerGroupParams> =
  {
    id: 'rippling_create_business_partner_group',
    name: 'Rippling Create Business Partner Group',
    description: 'Create a new business partner group',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
      },
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Group name',
      },
      domain: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Domain (HR, IT, FINANCE, RECRUITING, OTHER)',
      },
      defaultBusinessPartnerId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Default business partner ID',
      },
    },
    request: {
      url: `https://rest.ripplingapis.com/business-partner-groups/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: (params) => {
        const body: Record<string, unknown> = { name: params.name }
        if (params.domain != null) body.domain = params.domain
        if (params.defaultBusinessPartnerId != null)
          body.default_business_partner_id = params.defaultBusinessPartnerId
        return body
      },
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
    },
  }
