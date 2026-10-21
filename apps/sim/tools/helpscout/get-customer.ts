import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutGetCustomerParams,
  HelpScoutGetCustomerResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_CUSTOMER_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  HELPSCOUT_API_BASE,
  parseHelpScoutId,
  projectCustomer,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutGetCustomerTool: ToolConfig<
  HelpScoutGetCustomerParams,
  HelpScoutGetCustomerResponse
> = {
  id: 'helpscout_get_customer',
  name: 'Help Scout Get Customer',
  description:
    'Get a Help Scout customer by ID, including emails, phones, websites, social profiles, and properties.',
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
  },
  request: {
    url: (params) =>
      `${HELPSCOUT_API_BASE}/customers/${parseHelpScoutId(params.customerId, 'customerId')}`,
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { customer: projectCustomer(toRecord(await response.json())) },
  }),
  outputs: {
    customer: {
      type: 'json',
      description: 'Customer details',
      properties: HELPSCOUT_CUSTOMER_PROPERTIES,
    },
  },
}
