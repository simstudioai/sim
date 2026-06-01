import { prospeoHosting } from '@/tools/prospeo/hosting'
import {
  extractProspeoError,
  type ProspeoBulkEnrichCompanyParams,
  type ProspeoBulkEnrichCompanyResponse,
} from '@/tools/prospeo/types'
import { parseDataArray } from '@/tools/prospeo/utils'
import type { ToolConfig } from '@/tools/types'

export const bulkEnrichCompanyTool: ToolConfig<
  ProspeoBulkEnrichCompanyParams,
  ProspeoBulkEnrichCompanyResponse
> = {
  id: 'prospeo_bulk_enrich_company',
  name: 'Prospeo Bulk Enrich Company',
  description: 'Enrich up to 50 company records at once.',
  version: '1.0.0',

  hosting: prospeoHosting<ProspeoBulkEnrichCompanyParams>((_params, output) => {
    // Prospeo reports the exact credits spent for the batch in total_cost.
    if (typeof output.total_cost !== 'number') {
      throw new Error('Prospeo bulk enrich company response missing total_cost')
    }
    return output.total_cost
  }),

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Prospeo API key',
    },
    data: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of up to 50 company records to enrich. Each must include an "identifier" plus one of: company_website, company_linkedin_url, company_name, or company_id.',
    },
  },

  request: {
    url: 'https://api.prospeo.io/bulk-enrich-company',
    method: 'POST',
    headers: (params) => ({
      'X-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ data: parseDataArray(params.data) }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await extractProspeoError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        total_cost: data.total_cost ?? 0,
        matched: data.matched ?? [],
        not_matched: data.not_matched ?? [],
        invalid_datapoints: data.invalid_datapoints ?? [],
      },
    }
  },

  outputs: {
    total_cost: { type: 'number', description: 'Total credits spent by the request' },
    matched: {
      type: 'array',
      description: 'Matched company records (identifier, company)',
      items: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The identifier you submitted for this record',
          },
          company: { type: 'json', description: 'The matched company object', optional: true },
        },
      },
    },
    not_matched: {
      type: 'array',
      description: 'Identifiers of records we could not match',
      items: { type: 'string' },
    },
    invalid_datapoints: {
      type: 'array',
      description: 'Identifiers of records that did not meet the minimum matching requirements',
      items: { type: 'string' },
    },
  },
}
