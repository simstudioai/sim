import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomDetachContactFromCompanyParams {
  accessToken: string
  contactId: string
  companyId: string
}

export interface IntercomDetachContactFromCompanyV2Response {
  success: boolean
  output: {
    company: any
    companyId: string
    name: string | null
  }
}

const detachContactFromCompanyBase = {
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
      description: 'The ID of the contact to detach from the company',
    },
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the company to detach the contact from',
    },
  },

  request: {
    url: (params: IntercomDetachContactFromCompanyParams) =>
      buildIntercomUrl(`/contacts/${params.contactId}/companies/${params.companyId}`),
    method: 'DELETE',
    headers: (params: IntercomDetachContactFromCompanyParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomDetachContactFromCompanyParams, any>, 'params' | 'request'>

export const intercomDetachContactFromCompanyV2Tool: ToolConfig<
  IntercomDetachContactFromCompanyParams,
  IntercomDetachContactFromCompanyV2Response
> = {
  ...detachContactFromCompanyBase,
  id: 'intercom_detach_contact_from_company_v2',
  name: 'Detach Contact from Company in Intercom',
  description: 'Remove a contact from a company in Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'detach_contact_from_company')
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
        },
        companyId: data.id,
        name: data.name ?? null,
      },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'The company object the contact was detached from',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the company' },
        type: { type: 'string', description: 'Object type (company)' },
        company_id: { type: 'string', description: 'The company_id you defined' },
        name: { type: 'string', description: 'Name of the company' },
      },
    },
    companyId: { type: 'string', description: 'ID of the company' },
    name: { type: 'string', description: 'Name of the company', optional: true },
  },
}
