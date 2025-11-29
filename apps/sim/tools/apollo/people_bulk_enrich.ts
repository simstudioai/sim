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
      description: 'Reveal phone numbers (uses credits)',
    },
  },

  request: {
    url: 'https://api.apollo.io/api/v1/people/bulk_match',
    method: 'POST',
    headers: (params: ApolloPeopleBulkEnrichParams) => ({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': params.apiKey,
    }),
    body: (params: ApolloPeopleBulkEnrichParams) => ({
      details: params.people.slice(0, 10),
      reveal_personal_emails: params.reveal_personal_emails,
      reveal_phone_number: params.reveal_phone_number,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Apollo API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        people: data.matches || [],
        metadata: {
          total: data.matches?.length || 0,
          enriched: data.matches?.filter((p: any) => p).length || 0,
        },
      },
    }
  },

  outputs: {
    people: { type: 'json', description: 'Array of enriched people data' },
    metadata: {
      type: 'json',
      description: 'Bulk enrichment metadata including total and enriched counts',
    },
  },
}
