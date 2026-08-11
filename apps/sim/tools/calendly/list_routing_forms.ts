import type {
  CalendlyListRoutingFormsParams,
  CalendlyListRoutingFormsResponse,
} from '@/tools/calendly/types'
import { toResourceUri } from '@/tools/calendly/utils'
import type { ToolConfig } from '@/tools/types'

export const listRoutingFormsTool: ToolConfig<
  CalendlyListRoutingFormsParams,
  CalendlyListRoutingFormsResponse
> = {
  id: 'calendly_list_routing_forms',
  name: 'Calendly List Routing Forms',
  description: 'Retrieve the routing forms of an organization, including their questions',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Organization whose routing forms are returned. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/organizations/abc123-def456")',
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
    url: (params: CalendlyListRoutingFormsParams) => {
      const queryParams = [
        `organization=${encodeURIComponent(toResourceUri(params.organization, 'organizations'))}`,
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

      return `https://api.calendly.com/routing_forms?${queryParams.join('&')}`
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
      description: 'Array of routing form objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the routing form' },
          organization: { type: 'string', description: 'URI of the owning organization' },
          name: { type: 'string', description: 'Routing form name' },
          status: { type: 'string', description: 'Routing form status (published or draft)' },
          created_at: { type: 'string', description: 'ISO timestamp when the form was created' },
          updated_at: { type: 'string', description: 'ISO timestamp when the form was updated' },
          questions: {
            type: 'array',
            description: 'Questions asked by the routing form',
            items: {
              type: 'object',
              properties: {
                uuid: { type: 'string', description: 'Question identifier' },
                name: { type: 'string', description: 'Question text' },
                type: { type: 'string', description: 'Question answer type' },
                required: { type: 'boolean', description: 'Whether an answer is required' },
                answer_choices: {
                  type: 'array',
                  description: 'Selectable answers for choice questions',
                  items: { type: 'string' },
                },
              },
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
