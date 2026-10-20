import { isRecordLike } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutUpdateCustomerPropertiesParams,
  HelpScoutUpdateCustomerResponse,
} from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  HELPSCOUT_API_BASE,
  parseHelpScoutId,
  parseJsonParam,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

const PROPERTY_SLUG_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

/** A null value removes the property; anything else replaces it. */
function buildPropertyOperations(value: unknown) {
  const parsed = parseJsonParam(value, 'properties')
  if (!isRecordLike(parsed) || Object.keys(parsed).length === 0) {
    throw new Error('properties must be a JSON object of { "slug": value }')
  }
  return Object.entries(parsed).map(([slug, propertyValue]) => {
    if (!PROPERTY_SLUG_PATTERN.test(slug)) throw new Error(`Invalid property slug: ${slug}`)
    return propertyValue === null
      ? { op: 'remove', path: `/${slug}` }
      : { op: 'replace', path: `/${slug}`, value: propertyValue }
  })
}

export const helpScoutUpdateCustomerPropertiesTool: ToolConfig<
  HelpScoutUpdateCustomerPropertiesParams,
  HelpScoutUpdateCustomerResponse
> = {
  id: 'helpscout_update_customer_properties',
  name: 'Help Scout Update Customer Properties',
  description:
    'Set or remove customer property values (for example plan or MRR) on a Help Scout customer, keyed by property slug.',
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
    properties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Property values keyed by slug, e.g. {"plan": "Plus", "employees": 25}. Use null to remove a value. Dates use YYYY-MM-DD and dropdowns take the option ID or label.',
    },
  },
  request: {
    url: (params) =>
      `${HELPSCOUT_API_BASE}/customers/${parseHelpScoutId(params.customerId, 'customerId')}/properties`,
    method: 'PATCH',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => buildPropertyOperations(params.properties),
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
