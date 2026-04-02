import type { RipplingCreateBusinessPartnerParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateBusinessPartnerTool: ToolConfig<RipplingCreateBusinessPartnerParams> = {
  id: 'rippling_create_business_partner',
  name: 'Rippling Create Business Partner',
  description: 'Create a new business partner',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    businessPartnerGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Business partner group ID',
    },
    workerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Worker ID',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/business-partners/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      return {
        business_partner_group_id: params.businessPartnerGroupId,
        worker_id: params.workerId,
      }
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
        business_partner_group_id: (data.business_partner_group_id as string) ?? null,
        worker_id: (data.worker_id as string) ?? null,
        client_group_id: (data.client_group_id as string) ?? null,
        client_group_member_count: (data.client_group_member_count as number) ?? null,
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
  },
}
