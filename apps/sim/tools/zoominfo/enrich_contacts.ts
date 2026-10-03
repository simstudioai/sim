import type { InternalToolConfig } from '@/tools/types'
import type {
  ZoomInfoEnrichContactsParams,
  ZoomInfoEnrichContactsResponse,
} from '@/tools/zoominfo/types'
import { extractDataArray, transformZoomInfoResponse } from '@/tools/zoominfo/utils'

export const zoominfoEnrichContactsTool: InternalToolConfig<
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

  operation: {
    input: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoResponse(response)
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
