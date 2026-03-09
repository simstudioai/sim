import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesReplaceAllTextTool')

interface ReplaceAllTextParams {
  accessToken: string
  presentationId: string
  findText: string
  replaceText: string
  matchCase?: boolean
  pageObjectIds?: string
}

interface ReplaceAllTextResponse {
  success: boolean
  output: {
    occurrencesChanged: number
    metadata: {
      presentationId: string
      findText: string
      replaceText: string
      url: string
    }
  }
}

export const replaceAllTextTool: ToolConfig<ReplaceAllTextParams, ReplaceAllTextResponse> = {
  id: 'google_slides_replace_all_text',
  name: 'Replace All Text in Google Slides',
  description: 'Find and replace all occurrences of text throughout a Google Slides presentation',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-drive',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The access token for the Google Slides API',
    },
    presentationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Slides presentation ID',
    },
    findText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to find (e.g., {{placeholder}})',
    },
    replaceText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The text to replace with',
    },
    matchCase: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the search should be case-sensitive (default: true)',
    },
    pageObjectIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of slide object IDs to limit replacements to specific slides (leave empty for all slides)',
    },
  },

  request: {
    url: (params) => {
      const presentationId = params.presentationId?.trim()
      if (!presentationId) {
        throw new Error('Presentation ID is required')
      }
      return `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      if (!params.findText) {
        throw new Error('Find text is required')
      }
      if (params.replaceText === undefined || params.replaceText === null) {
        throw new Error('Replace text is required')
      }

      const replaceAllTextRequest: Record<string, any> = {
        containsText: {
          text: params.findText,
          matchCase: params.matchCase !== false, // Default to true
        },
        replaceText: params.replaceText,
      }

      // Add pageObjectIds if specified to limit replacements to specific slides
      if (params.pageObjectIds?.trim()) {
        replaceAllTextRequest.pageObjectIds = params.pageObjectIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      }

      return {
        requests: [
          {
            replaceAllText: replaceAllTextRequest,
          },
        ],
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Failed to replace text')
    }

    // The response contains replies array with replaceAllText results
    const replaceResult = data.replies?.[0]?.replaceAllText
    const occurrencesChanged = replaceResult?.occurrencesChanged || 0

    const presentationId = params?.presentationId?.trim() || ''

    return {
      success: true,
      output: {
        occurrencesChanged,
        metadata: {
          presentationId,
          findText: params?.findText || '',
          replaceText: params?.replaceText || '',
          url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
        },
      },
    }
  },

  outputs: {
    occurrencesChanged: {
      type: 'number',
      description: 'Number of text occurrences that were replaced',
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata including presentation ID and URL',
      properties: {
        presentationId: {
          type: 'string',
          description: 'The presentation ID',
        },
        findText: {
          type: 'string',
          description: 'The text that was searched for',
        },
        replaceText: {
          type: 'string',
          description: 'The text that replaced the matches',
        },
        url: {
          type: 'string',
          description: 'URL to open the presentation',
        },
      },
    },
  },
}
