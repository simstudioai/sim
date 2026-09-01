import type {
  CalendlyListRoutingFormSubmissionsParams,
  CalendlyListRoutingFormSubmissionsResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const listRoutingFormSubmissionsTool: ToolConfig<
  CalendlyListRoutingFormSubmissionsParams,
  CalendlyListRoutingFormSubmissionsResponse
> = {
  id: 'calendly_list_routing_form_submissions',
  name: 'Calendly List Routing Form Submissions',
  description: 'Retrieve the submissions of a routing form, including answers and routing result',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    formUri: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Routing form whose submissions are returned. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/routing_forms/abc123-def456")',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page. Format: integer (default: 20, max: 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page token for pagination. Format: opaque string from previous response next_page_token',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort order for results. Format: "created_at:direction" (e.g., "created_at:asc", "created_at:desc")',
    },
  },

  request: {
    url: (params: CalendlyListRoutingFormSubmissionsParams) => {
      const queryParams = [
        `form=${encodeURIComponent(toResourceUri(params.formUri, 'routing_forms'))}`,
      ]

      if (params.count) {
        queryParams.push(`count=${Number(params.count)}`)
      }

      if (params.pageToken) {
        queryParams.push(`page_token=${encodeURIComponent(params.pageToken)}`)
      }

      if (params.sort) {
        queryParams.push(`sort=${encodeURIComponent(params.sort)}`)
      }

      return `https://api.calendly.com/routing_form_submissions?${queryParams.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    collection: {
      type: 'array',
      description: 'Array of routing form submission objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the submission' },
          routing_form: { type: 'string', description: 'URI of the routing form' },
          submitter: {
            type: 'string',
            description: 'URI of the invitee who submitted, when the submission led to a booking',
          },
          submitter_type: { type: 'string', description: 'Type of the submitter' },
          created_at: { type: 'string', description: 'ISO timestamp when the form was submitted' },
          updated_at: {
            type: 'string',
            description: 'ISO timestamp when the submission was updated',
          },
          questions_and_answers: {
            type: 'array',
            description: 'Answers given on the routing form',
            items: {
              type: 'object',
              properties: {
                question_uuid: { type: 'string', description: 'Question identifier' },
                question: { type: 'string', description: 'Question text' },
                answer: { type: 'string', description: 'Submitted answer' },
              },
            },
          },
          tracking: {
            type: 'object',
            description: 'UTM and Salesforce tracking parameters captured at submission',
            properties: {
              utm_campaign: { type: 'string', description: 'UTM campaign' },
              utm_source: { type: 'string', description: 'UTM source' },
              utm_medium: { type: 'string', description: 'UTM medium' },
              utm_content: { type: 'string', description: 'UTM content' },
              utm_term: { type: 'string', description: 'UTM term' },
              salesforce_uuid: { type: 'string', description: 'Salesforce record identifier' },
            },
          },
          result: {
            type: 'object',
            description: 'Where the submission routed to',
            properties: {
              type: { type: 'string', description: 'Routing result type' },
              value: { type: 'string', description: 'Routing destination' },
            },
          },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        count: { type: 'number', description: 'Number of results in this page' },
        next_page: { type: 'string', description: 'URL to next page (if available)' },
        previous_page: { type: 'string', description: 'URL to previous page (if available)' },
        next_page_token: { type: 'string', description: 'Token for next page' },
        previous_page_token: { type: 'string', description: 'Token for previous page' },
      },
    },
  },
}
