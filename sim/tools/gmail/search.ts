import { ToolConfig } from '../types'
import { GmailSearchParams, GmailToolResponse } from './types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailSearchTool: ToolConfig<GmailSearchParams, GmailToolResponse> = {
  id: 'gmail_search',
  name: 'Gmail Search',
  description: 'Search emails in Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: [
      // 'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.labels',
    ],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'Access token for Gmail API',
    },
    query: {
      type: 'string',
      required: true,
      description: 'Search query for emails',
    },
    maxResults: {
      type: 'number',
      required: false,
      description: 'Maximum number of results to return',
    },
  },

  request: {
    url: (params: GmailSearchParams) => {
      const searchParams = new URLSearchParams()
      searchParams.append('q', params.query)
      if (params.maxResults) {
        searchParams.append('maxResults', params.maxResults.toString())
      }
      return `${GMAIL_API_BASE}/messages?${searchParams.toString()}`
    },
    method: 'GET',
    headers: (params: GmailSearchParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to search emails')
    }

    return {
      success: true,
      output: {
        content: `Found ${data.messages?.length || 0} messages`,
        metadata: {
          results:
            data.messages?.map((msg: any) => ({
              id: msg.id,
              threadId: msg.threadId,
            })) || [],
        },
      },
    }
  },

  transformError: (error) => {
    // Handle Google API error format
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Gmail API quota exceeded. Please try again later.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while searching emails'
  },
}
