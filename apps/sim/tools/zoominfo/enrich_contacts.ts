import type { ToolConfig } from '@/tools/types'
import type {
  ZoomInfoEnrichContactsParams,
  ZoomInfoEnrichContactsResponse,
} from '@/tools/zoominfo/types'
import {
  buildProxyBody,
  extractDataArray,
  parseCsvOrJson,
  parseJsonField,
  transformZoomInfoEnvelope,
  ZOOMINFO_PROXY_URL,
} from '@/tools/zoominfo/utils'

/**
 * Default output fields used when the caller does not specify any. ZoomInfo's
 * ContactEnrich schema requires `outputFields`, so we send a useful contact set
 * rather than letting the request fail. All values are valid ContactEnrich fields.
 */
const DEFAULT_CONTACT_OUTPUT_FIELDS = [
  'id',
  'firstName',
  'lastName',
  'email',
  'phone',
  'mobilePhone',
  'jobTitle',
  'jobFunction',
  'managementLevel',
  'city',
  'state',
  'country',
  'contactAccuracyScore',
  'validDate',
  'lastUpdatedDate',
  'companyId',
  'companyName',
  'companyWebsite',
  'companyPhone',
]

export const zoominfoEnrichContactsTool: ToolConfig<
  ZoomInfoEnrichContactsParams,
  ZoomInfoEnrichContactsResponse
> = {
  id: 'zoominfo_enrich_contacts',
  name: 'ZoomInfo Enrich Contacts',
  description:
    'Enrich up to 25 contacts in one request with verified emails, phone numbers, job details, and more.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client secret',
    },
    matchPersonInput: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array (1-25 items) of contact matching criteria, e.g. [{"firstName":"Jane","lastName":"Doe","companyName":"Acme"}]',
    },
    outputFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array or comma-separated list of fields to return (e.g. ["id","firstName","email","phone","jobTitle"]). Defaults to a standard contact set if omitted.',
    },
    requiredFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array or comma-separated list of fields that must exist in results (e.g. ["email"])',
    },
  },

  request: {
    url: ZOOMINFO_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const matchPersonInput = parseJsonField<unknown>(params.matchPersonInput, 'matchPersonInput')
      if (!Array.isArray(matchPersonInput) || matchPersonInput.length === 0) {
        throw new Error('matchPersonInput must be a non-empty JSON array')
      }
      if (matchPersonInput.length > 25) {
        throw new Error('matchPersonInput supports a maximum of 25 entries per request')
      }

      const outputFields = parseCsvOrJson(params.outputFields, 'outputFields')
      const attributes: Record<string, unknown> = {
        matchPersonInput,
        outputFields: outputFields ?? DEFAULT_CONTACT_OUTPUT_FIELDS,
      }
      const requiredFields = parseCsvOrJson(params.requiredFields, 'requiredFields')
      if (requiredFields) attributes.requiredFields = requiredFields

      return {
        ...buildProxyBody(params),
        path: '/data/v1/contacts/enrich',
        method: 'POST',
        body: {
          data: {
            type: 'ContactEnrich',
            attributes,
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoEnvelope(response)
    const results = extractDataArray(data)
    return {
      success: true,
      output: { results },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Enrichment results, one per input with match status and attributes',
      items: { type: 'json' },
    },
  },
}
