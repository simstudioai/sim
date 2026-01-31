import type { ListMessagesParams, ListMessagesResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunListMessagesTool: ToolConfig<ListMessagesParams, ListMessagesResult> = {
  id: 'mailgun_list_messages',
  name: 'Mailgun List Messages',
  description: 'List events (logs) for messages sent through Mailgun',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun domain for listing events (e.g., mg.example.com)',
    },
    event: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by event type (accepted, delivered, failed, opened, clicked, etc.)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return (default: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.mailgun.net/v3/${params.domain}/events`
      const queryParams = new URLSearchParams()

      if (params.event) {
        queryParams.append('event', params.event)
      }
      if (params.limit) {
        queryParams.append('limit', params.limit.toString())
      }

      const query = queryParams.toString()
      return query ? `${baseUrl}?${query}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
  },

  transformResponse: async (response, params): Promise<ListMessagesResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to list messages')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        items: result.items || [],
        paging: result.paging || {},
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the request was successful' },
    items: { type: 'json', description: 'Array of event items' },
    paging: { type: 'json', description: 'Paging information' },
  },
}
