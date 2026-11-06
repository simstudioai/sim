import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutCreateCustomerParams,
  HelpScoutCreateCustomerResponse,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildContactEntries,
  buildHelpScoutHeaders,
  CUSTOMER_PROFILE_PARAMS,
  collectCustomerProfile,
  HELPSCOUT_API_BASE,
  parseOptionalHelpScoutId,
  readResourceId,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutCreateCustomerTool: ToolConfig<
  HelpScoutCreateCustomerParams,
  HelpScoutCreateCustomerResponse
> = {
  id: 'helpscout_create_customer',
  name: 'Help Scout Create Customer',
  description: 'Create a Help Scout customer with a profile, email address, and phone number.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    ...CUSTOMER_PROFILE_PARAMS,
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address',
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
      description: 'Phone number',
    },
    phoneType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'work, home, mobile, fax, pager, or other (defaults to work)',
    },
    organizationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the organization the customer belongs to',
    },
  },
  request: {
    url: `${HELPSCOUT_API_BASE}/customers`,
    method: 'POST',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => {
      const profile = collectCustomerProfile(params)
      const contact = buildContactEntries(params)
      if (!contact.email && !contact.phone && Object.keys(profile).length === 0) {
        throw new Error('Provide at least a name, email, or phone for the customer')
      }
      const organizationId = parseOptionalHelpScoutId(params.organizationId, 'organizationId')
      return {
        ...profile,
        ...(organizationId !== undefined ? { organizationId } : {}),
        ...(contact.email ? { emails: [contact.email] } : {}),
        ...(contact.phone ? { phones: [contact.phone] } : {}),
      }
    },
  },
  transformResponse: async (response) => ({
    success: true,
    output: { id: readResourceId(response) },
  }),
  outputs: {
    id: { type: 'number', description: 'ID of the new customer', nullable: true },
  },
}
