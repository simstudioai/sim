import { fullEnrichRetrievalHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichGetEnrichmentResponseSchema,
  fullEnrichIdSchema,
} from '@/tools/fullenrich/schemas'
import type {
  FullEnrichGetContactEnrichmentParams,
  FullEnrichGetEnrichmentResponse,
} from '@/tools/fullenrich/types'
import { extractFullEnrichError } from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const getContactEnrichmentTool: ToolConfig<
  FullEnrichGetContactEnrichmentParams,
  FullEnrichGetEnrichmentResponse
> = {
  id: 'fullenrich_get_contact_enrichment',
  name: 'FullEnrich Get Contact Enrichment',
  description:
    'Retrieve the status, contact records, and historical credit usage for an enrichment.',
  version: '1.0.0',
  hosting: fullEnrichRetrievalHosting(),
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'FullEnrich API key',
    },
    enrichmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Enrichment ID returned by Start Contact Enrichment',
    },
    forceResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return available records before the whole enrichment finishes',
    },
  },
  request: {
    url: (params) => {
      const url = new URL(
        `https://app.fullenrich.com/api/v2/contact/enrich/bulk/${encodeURIComponent(fullEnrichIdSchema.parse(params.enrichmentId))}`
      )
      if (params.forceResults !== undefined) {
        url.searchParams.set('forceResults', String(params.forceResults))
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}` }),
  },
  transformResponse: async (response) => {
    if (!response.ok) throw new Error(await extractFullEnrichError(response))
    const data = fullEnrichGetEnrichmentResponseSchema.parse(await response.json())
    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        status: data.status,
        records: data.data,
        costCredits: data.cost.credits,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Enrichment ID' },
    name: { type: 'string', description: 'Enrichment name' },
    status: { type: 'string', description: 'Current enrichment status' },
    records: {
      type: 'array',
      description:
        'Contact enrichment records with input, custom, contact_info, and profile fields',
      items: {
        type: 'object',
        description: 'Enriched contact record',
        properties: {
          input: { type: 'json', description: 'Original contact enrichment input' },
          custom: { type: 'json', description: 'Custom string fields returned unchanged' },
          contact_info: {
            type: 'json',
            description: 'Found work emails, personal emails, and mobile phones',
          },
          profile: { type: 'json', description: 'Full professional person profile' },
        },
      },
    },
    costCredits: {
      type: 'number',
      description: 'Historical credits consumed by the enrichment; retrieval itself is free',
    },
  },
}
