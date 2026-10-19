import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { ZOHO_DESK_ACCOUNT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskUpdateAccountParams,
  ZohoDeskUpdateAccountResponse,
} from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskUpdateAccountTool: ToolConfig<
  ZohoDeskUpdateAccountParams,
  ZohoDeskUpdateAccountResponse
> = {
  id: 'zoho_desk_update_account',
  name: 'Zoho Desk Update Account',
  description: 'Update Account in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the account',
    },
    accountWebsite: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Website of the account',
    },
    accountName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the account',
    },
    accountPhone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number of the account',
    },
    accountEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email ID of the account',
    },
    accountCountry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country in which the account is based',
    },
    accountCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Zip code',
    },
    accountCustomFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'User-defined fields associated with the account JSON object.',
    },
    accountCity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'City in which the account is based',
    },
    accountStreet: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Address of the account',
    },
    accountAnnualrevenue: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Annual revenue of the account',
    },
    accountDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A short description of the account',
    },
    accountIndustry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Industry in which the account operates',
    },
    accountState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State in which the account is based',
    },
    accountOwnerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of account owner',
    },
    accountFax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fax number of the account',
    },
    accountAssociatedSLAIds: {
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
      return `${getZohoDeskApiBase(params)}/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}`
    },
    method: 'PATCH',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        website: params.accountWebsite,
        accountName: params.accountName,
        phone: params.accountPhone,
        email: params.accountEmail,
        country: params.accountCountry,
        code: params.accountCode,
        cf: parseZohoDeskJson(params.accountCustomFields, 'accountCustomFields', 'object'),
        city: params.accountCity,
        street: params.accountStreet,
        annualrevenue: params.accountAnnualrevenue?.toString(),
        description: params.accountDescription,
        industry: params.accountIndustry,
        state: params.accountState,
        ownerId: params.accountOwnerId,
        fax: params.accountFax,
        associatedSLAIds: parseZohoDeskJson(
          params.accountAssociatedSLAIds,
          'accountAssociatedSLAIds',
          'array'
        ),
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
