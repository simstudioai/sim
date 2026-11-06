import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { ZOHO_DESK_ACCOUNT_PROPERTIES } from '@/tools/zoho_desk/outputs'
import {
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type { ZohoDeskGetAccountParams, ZohoDeskGetAccountResponse } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskGetAccountTool: ToolConfig<
  ZohoDeskGetAccountParams,
  ZohoDeskGetAccountResponse
> = {
  id: 'zoho_desk_get_account',
  name: 'Zoho Desk Get Account',
  description: 'Get Account in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    accountInclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allowed values are : owner',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the account',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.accountInclude != null && params.accountInclude !== '') {
        query.set('include', String(params.accountInclude))
      }
      return `${getZohoDeskApiBase(params)}/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
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
