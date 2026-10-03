import type { InternalToolConfig } from '@/tools/types'
import type {
  ZoomInfoEnrichCompaniesParams,
  ZoomInfoEnrichCompaniesResponse,
} from '@/tools/zoominfo/types'
import { extractDataArray, transformZoomInfoResponse } from '@/tools/zoominfo/utils'

export const zoominfoEnrichCompaniesTool: InternalToolConfig<
  ZoomInfoEnrichCompaniesParams,
  ZoomInfoEnrichCompaniesResponse
> = {
  id: 'zoominfo_enrich_companies',
  name: 'ZoomInfo Enrich Companies',
  description:
    'Enrich up to 25 companies in one request with detailed firmographics, industry, financials, and more.',
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
    matchCompanyInput: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array (1-25 items) of company matching criteria, e.g. [{"companyName":"Acme","companyWebsite":"acme.com"}]',
    },
    outputFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array or comma-separated list of fields to return (e.g. ["id","name","website","revenue","employeeCount"]). Defaults to a standard firmographic set if omitted.',
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
