import type { ToolConfig } from '../types'
import type { GmailSearchParams, GmailToolResponse } from './types'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailSearchTool: ToolConfig<GmailSearchParams, GmailToolResponse> = {
  id: 'gmail_search',
  name: 'Gmail Search',
  description: 'Search emails in Gmail',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
    additionalScopes: ['https://www.googleapis.com/auth/gmail.labels'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Gmail API',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query for emails',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
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

  transformResponse: async (response, params) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to search emails')
    }

    if (!data.messages || data.messages.length === 0) {
      return {
        success: true,
        output: {
          content: 'No messages found matching your search query.',
          metadata: {
            results: [],
          },
        },
      }
    }

    try {
      // Fetch full message details for each result
      const messagePromises = data.messages.map(async (msg: any) => {
        const messageResponse = await fetch(`${GMAIL_API_BASE}/messages/${msg.id}?format=full`, {
          headers: {
            Authorization: `Bearer ${params?.accessToken || ''}`,
            'Content-Type': 'application/json',
          },
        })

        if (!messageResponse.ok) {
          throw new Error(`Failed to fetch details for message ${msg.id}`)
        }

        return await messageResponse.json()
      })

      const messages = await Promise.all(messagePromises)

      // Process all messages and create a summary
      const processedMessages = messages.map(processMessageForSummary)

      return {
        success: true,
        output: {
          content: createMessagesSummary(processedMessages),
          metadata: {
            results: processedMessages.map((msg) => ({
              id: msg.id,
              threadId: msg.threadId,
              subject: msg.subject,
              from: msg.from,
              date: msg.date,
              snippet: msg.snippet,
            })),
          },
        },
      }
    } catch (error: any) {
      console.error('Error fetching message details:', error)
      return {
        success: true,
        output: {
          content: `Found ${data.messages.length} messages but couldn't retrieve all details: ${error.message || 'Unknown error'}`,
          metadata: {
            results: data.messages.map((msg: any) => ({
              id: msg.id,
              threadId: msg.threadId,
            })),
          },
        },
      }
    }
  },

  transformError: (error) => {
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

// Helper function to process a message for summary (without full content)
function processMessageForSummary(message: any): any {
  if (!message || !message.payload) {
    return {
      id: message?.id || '',
      threadId: message?.threadId || '',
      subject: 'Unknown Subject',
      from: 'Unknown Sender',
      date: '',
      snippet: message?.snippet || '',
    }
  }

  const headers = message.payload.headers || []
  const subject =
    headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || 'No Subject'
  const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender'
  const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || ''

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    from,
    date,
    snippet: message.snippet || '',
  }
}

// Helper function to create a summary of multiple messages
function createMessagesSummary(messages: any[]): string {
  if (messages.length === 0) {
    return 'No messages found.'
  }

  let summary = `Found ${messages.length} messages:\n\n`

  messages.forEach((msg, index) => {
    summary += `${index + 1}. Subject: ${msg.subject}\n`
    summary += `   From: ${msg.from}\n`
    summary += `   Date: ${msg.date}\n`
    summary += `   Preview: ${msg.snippet}\n\n`
  })

  summary += `To read full content of a specific message, use the gmail_read tool with messageId: ${messages.map((m) => m.id).join(', ')}`

  return summary
}
