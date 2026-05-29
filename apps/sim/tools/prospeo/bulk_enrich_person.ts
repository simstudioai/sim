import { prospeoHosting } from '@/tools/prospeo/hosting'
import {
  extractProspeoError,
  type ProspeoBulkEnrichPersonParams,
  type ProspeoBulkEnrichPersonResponse,
} from '@/tools/prospeo/types'
import { parseDataArray } from '@/tools/prospeo/utils'
import type { ToolConfig } from '@/tools/types'

export const bulkEnrichPersonTool: ToolConfig<
  ProspeoBulkEnrichPersonParams,
  ProspeoBulkEnrichPersonResponse
> = {
  id: 'prospeo_bulk_enrich_person',
  name: 'Prospeo Bulk Enrich Person',
  description: 'Enrich up to 50 person records at once.',
  version: '1.0.0',

  hosting: prospeoHosting<ProspeoBulkEnrichPersonParams>((_params, output) => {
    // Prospeo reports the exact credits spent for the batch in total_cost.
    if (typeof output.total_cost !== 'number') {
      throw new Error('Prospeo bulk enrich person response missing total_cost')
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
        'Array of up to 50 person records to enrich. Each must include an "identifier" plus one of: linkedin_url, email, person_id, or (first_name + last_name + company_*), or (full_name + company_*).',
    },
    only_verified_email: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return records with a verified email',
    },
    enrich_mobile: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reveal mobile numbers (10 credits per match; email included)',
    },
    only_verified_mobile: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return records that have a mobile (implies enrich_mobile)',
    },
  },

  request: {
    url: 'https://api.prospeo.io/bulk-enrich-person',
    method: 'POST',
    headers: (params) => ({
      'X-KEY': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { data: parseDataArray(params.data) }
      if (params.only_verified_email !== undefined)
        body.only_verified_email = params.only_verified_email
      if (params.enrich_mobile !== undefined) body.enrich_mobile = params.enrich_mobile
      if (params.only_verified_mobile !== undefined)
        body.only_verified_mobile = params.only_verified_mobile
      return body
    },
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
      description: 'Matched records (identifier, person, company)',
      items: {
        type: 'object',
        properties: {
          identifier: {
            type: 'string',
            description: 'The identifier you submitted for this record',
          },
          person: { type: 'json', description: 'The matched person object', optional: true },
          company: {
            type: 'json',
            description: 'The current company of the matched person',
            optional: true,
          },
        },
      },
    },
    not_matched: {
      type: 'array',
      description: 'Identifiers of records we could not match given the filters',
      items: { type: 'string' },
    },
    invalid_datapoints: {
      type: 'array',
      description: 'Identifiers of records that did not meet the minimum matching requirements',
      items: { type: 'string' },
    },
  },
}
