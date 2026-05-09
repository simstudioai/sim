import type {
  ApolloPeopleBulkEnrichParams,
  ApolloPeopleBulkEnrichResponse,
} from '@/tools/apollo/types'
import type { ToolConfig } from '@/tools/types'

export const apolloPeopleBulkEnrichTool: ToolConfig<
  ApolloPeopleBulkEnrichParams,
  ApolloPeopleBulkEnrichResponse
> = {
  id: 'apollo_people_bulk_enrich',
  name: 'Apollo Bulk People Enrichment',
  description: 'Enrich data for up to 10 people at once using Apollo',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Apollo API key',
    },
    people: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of people to enrich (max 10)',
    },
    reveal_personal_emails: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Reveal personal email addresses (uses credits)',
    },
    reveal_phone_number: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Reveal phone numbers (uses credits, requires webhook_url)',
    },
    webhook_url: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Webhook URL for async phone number delivery (required when reveal_phone_number is true)',
    },
  },

  request: {
    url: (params: ApolloPeopleBulkEnrichParams) => {
      const qs = new URLSearchParams()
      if (params.reveal_personal_emails !== undefined) {
        qs.set('reveal_personal_emails', String(params.reveal_personal_emails))
      }
      if (params.reveal_phone_number !== undefined) {
        qs.set('reveal_phone_number', String(params.reveal_phone_number))
      }
      if (params.webhook_url) {
        qs.set('webhook_url', params.webhook_url)
      }
      const query = qs.toString()
      return `https://api.apollo.io/api/v1/people/bulk_match${query ? `?${query}` : ''}`
    },
    method: 'POST',
    headers: (params: ApolloPeopleBulkEnrichParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloPeopleBulkEnrichParams) => ({
      details: params.people.slice(0, 10),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const matches = Array.isArray(data.matches)
      ? data.matches
      : Array.isArray(data.people)
        ? data.people
        : []

    return {
      success: true,
      output: {
        matches,
        total_requested_enrichments: data.total_requested_enrichments ?? matches.length,
        unique_enriched_records: data.unique_enriched_records ?? matches.filter(Boolean).length,
        missing_records: data.missing_records ?? null,
        credits_consumed: data.credits_consumed ?? null,
      },
    }
  },

  outputs: {
    matches: {
      type: 'json',
      description: 'Array of enriched people (null entries indicate no match)',
    },
    total_requested_enrichments: {
      type: 'number',
      description: 'Total number of records submitted for enrichment',
    },
    unique_enriched_records: {
      type: 'number',
      description: 'Number of records successfully enriched',
    },
    missing_records: {
      type: 'number',
      description: 'Number of records that could not be enriched',
      optional: true,
    },
    credits_consumed: {
      type: 'number',
      description: 'Number of Apollo credits consumed by this request',
      optional: true,
    },
  },
}
