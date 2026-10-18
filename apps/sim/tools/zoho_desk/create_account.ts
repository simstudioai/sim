import type { ToolConfig } from '@/tools/types'
import { ZOHO_DESK_ACCOUNT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskCreateAccountParams,
  ZohoDeskCreateAccountResponse,
} from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskCreateAccountTool: ToolConfig<
  ZohoDeskCreateAccountParams,
  ZohoDeskCreateAccountResponse
> = {
  id: 'zoho_desk_create_account',
  name: 'Zoho Desk Create Account',
  description: 'Create Account in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Website of the account',
    },
    accountName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the account',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the account',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email ID of the account',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country in which the account is based',
    },
    code: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Zip code' },
    customFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'User-defined fields associated with the account JSON object.',
    },
    city: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City in which the account is based',
    },
    street: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Address of the account',
    },
    annualrevenue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Annual revenue of the account',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A short description of the account',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Industry in which the account operates',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State in which the account is based',
    },
    ownerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of account owner',
    },
    fax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fax number of the account',
    },
    associatedSLAIds: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      required: false,
      visibility: 'user-or-llm',
      description:
        'IDs of the SLAs associated with the account. An account can have multiple SLAs, but only one SLA per department can be mapped to it. JSON array.',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/accounts`
    },
    method: 'POST',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        website: params.website,
        accountName: params.accountName,
        phone: params.phone,
        email: params.email,
        country: params.country,
        code: params.code,
        cf: parseZohoDeskJson(params.customFields, 'customFields', 'object'),
        city: params.city,
        street: params.street,
        annualrevenue: params.annualrevenue,
        description: params.description,
        industry: params.industry,
        state: params.state,
        ownerId: params.ownerId,
        fax: params.fax,
        associatedSLAIds: parseZohoDeskJson(params.associatedSLAIds, 'associatedSLAIds', 'array'),
      })
      return body
    },
  },
  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { account: projectZohoDeskResource(data, ZOHO_DESK_ACCOUNT_PROPERTIES) },
    }
  },
  outputs: {
    account: {
      type: 'object',
      description: 'The account',
      properties: ZOHO_DESK_ACCOUNT_PROPERTIES,
    },
  },
}
