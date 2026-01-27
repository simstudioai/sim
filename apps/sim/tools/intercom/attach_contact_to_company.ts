import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomAttachContactToCompanyParams {
  accessToken: string
  contactId: string
  companyId: string
}

export interface IntercomAttachContactToCompanyV2Response {
  success: boolean
  output: {
    company: any
    companyId: string
    name: string | null
  }
}

const attachContactToCompanyBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the contact to attach to the company',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the company to attach the contact to',
    },
  },

  request: {
    url: (params: IntercomAttachContactToCompanyParams) =>
      buildIntercomUrl(`/contacts/${params.contactId}/companies`),
    method: 'POST',
    headers: (params: IntercomAttachContactToCompanyParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomAttachContactToCompanyParams) => ({
      id: params.companyId,
    }),
  },
} satisfies Pick<ToolConfig<IntercomAttachContactToCompanyParams, any>, 'params' | 'request'>

export const intercomAttachContactToCompanyV2Tool: ToolConfig<
  IntercomAttachContactToCompanyParams,
  IntercomAttachContactToCompanyV2Response
> = {
  ...attachContactToCompanyBase,
  id: 'intercom_attach_contact_to_company_v2',
  name: 'Attach Contact to Company in Intercom',
  description: 'Attach a contact to a company in Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'attach_contact_to_company')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        company: {
          id: data.id,
          type: data.type ?? 'company',
          company_id: data.company_id ?? null,
          name: data.name ?? null,
          created_at: data.created_at ?? null,
          updated_at: data.updated_at ?? null,
          user_count: data.user_count ?? null,
          session_count: data.session_count ?? null,
          monthly_spend: data.monthly_spend ?? null,
          plan: data.plan ?? null,
        },
        companyId: data.id,
        name: data.name ?? null,
      },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'The company object the contact was attached to',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the company' },
        type: { type: 'string', description: 'Object type (company)' },
        company_id: { type: 'string', description: 'The company_id you defined' },
        name: { type: 'string', description: 'Name of the company' },
        created_at: { type: 'number', description: 'Unix timestamp when company was created' },
        updated_at: { type: 'number', description: 'Unix timestamp when company was updated' },
        user_count: { type: 'number', description: 'Number of users in the company' },
        session_count: { type: 'number', description: 'Number of sessions' },
        monthly_spend: { type: 'number', description: 'Monthly spend amount' },
        plan: { type: 'object', description: 'Company plan details' },
      },
    },
    companyId: { type: 'string', description: 'ID of the company' },
    name: { type: 'string', description: 'Name of the company', optional: true },
  },
}
