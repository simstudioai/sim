import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutListCustomerPropertiesParams,
  HelpScoutListCustomerPropertiesResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_CUSTOMER_PROPERTY_DEFINITION_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  embeddedList,
  HELPSCOUT_API_BASE,
  projectCustomerPropertyDefinition,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListCustomerPropertiesTool: ToolConfig<
  HelpScoutListCustomerPropertiesParams,
  HelpScoutListCustomerPropertiesResponse
> = {
  id: 'helpscout_list_customer_properties',
  name: 'Help Scout List Customer Properties',
  description:
    'List the customer property definitions in Help Scout (slug, type, and dropdown options) used by Update Customer Properties.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
  },
  request: {
    url: `${HELPSCOUT_API_BASE}/customer-properties`,
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        customerProperties: embeddedList(data, 'customer-properties').map(
          projectCustomerPropertyDefinition
        ),
      },
    }
  },
  outputs: {
    customerProperties: {
      type: 'array',
      description: 'Customer property definitions',
      items: { type: 'object', properties: HELPSCOUT_CUSTOMER_PROPERTY_DEFINITION_PROPERTIES },
    },
  },
}
