import { fullEnrichRetrievalHosting } from '@/tools/fullenrich/hosting'
import {
  fullEnrichGetEnrichmentResponseSchema,
  fullEnrichIdSchema,
} from '@/tools/fullenrich/schemas'
import type {
  FullEnrichGetEnrichmentResponse,
  FullEnrichGetReverseEmailParams,
} from '@/tools/fullenrich/types'
import { extractFullEnrichError } from '@/tools/fullenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const getReverseEmailTool: ToolConfig<
  FullEnrichGetReverseEmailParams,
  FullEnrichGetEnrichmentResponse
> = {
  id: 'fullenrich_get_reverse_email',
  name: 'FullEnrich Get Reverse Email',
  description:
    'Retrieve the status, matched profiles, and historical credit usage for a reverse lookup.',
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
      description: 'Enrichment ID returned by Start Reverse Email',
    },
  },
  request: {
    url: (params) =>
      `https://app.fullenrich.com/api/v2/contact/reverse/email/bulk/${encodeURIComponent(fullEnrichIdSchema.parse(params.enrichmentId))}`,
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
    id: { type: 'string', description: 'Reverse lookup ID' },
    name: { type: 'string', description: 'Reverse lookup name' },
    status: { type: 'string', description: 'Current reverse-lookup status' },
    records: {
      type: 'array',
      description: 'Reverse-email records with input, custom, and matched profile fields',
      items: {
        type: 'object',
        description: 'Reverse-email result record',
        properties: {
          input: { type: 'json', description: 'Original email input' },
          custom: { type: 'json', description: 'Custom string fields returned unchanged' },
          profile: { type: 'json', description: 'Matched professional person profile' },
        },
      },
    },
    costCredits: {
      type: 'number',
      description: 'Historical credits consumed by the lookup; retrieval itself is free',
    },
  },
}
