import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutUpdateCustomerParams,
  HelpScoutUpdateCustomerResponse,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildContactEntries,
  buildHelpScoutHeaders,
  CUSTOMER_PROFILE_PARAMS,
  collectCustomerProfile,
  HELPSCOUT_API_BASE,
  parseHelpScoutId,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutUpdateCustomerTool: ToolConfig<
  HelpScoutUpdateCustomerParams,
  HelpScoutUpdateCustomerResponse
> = {
  id: 'helpscout_update_customer',
  name: 'Help Scout Update Customer',
  description:
    'Update profile fields on a Help Scout customer and add an email address or phone number. Only the fields you provide are changed.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    customerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer ID',
    },
    ...CUSTOMER_PROFILE_PARAMS,
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to add to the customer',
    },
    emailType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'work, home, or other (defaults to work)',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number to add to the customer',
    },
    phoneType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'work, home, mobile, fax, pager, or other (defaults to work)',
    },
  },
  request: {
    url: (params) =>
      `${HELPSCOUT_API_BASE}/customers/${parseHelpScoutId(params.customerId, 'customerId')}`,
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      const contact = buildContactEntries(params)
      const operations: Array<{ op: string; path: string; value: unknown }> = Object.entries(
        collectCustomerProfile(params)
      ).map(([field, value]) => ({ op: 'replace', path: `/${field}`, value }))
      if (contact.email) operations.push({ op: 'add', path: '/emails', value: contact.email })
      if (contact.phone) operations.push({ op: 'add', path: '/phones', value: contact.phone })
      if (operations.length === 0) throw new Error('Provide at least one field to update')
      return operations
    },
  },
  transformResponse: async (_response, params) => ({
    success: true,
    output: {
      customerId: params ? parseHelpScoutId(params.customerId, 'customerId') : null,
    },
  }),
  outputs: {
    customerId: { type: 'number', description: 'ID of the updated customer', nullable: true },
  },
}
