import { createLogger } from '@sim/logger'
import { authJsonHeaders, batchUpdateUrl, presentationUrl } from '@/tools/google_slides/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('GoogleSlidesBatchUpdateTool')

interface BatchUpdateParams {
  accessToken: string
  presentationId: string
  requests: string
  writeControl?: string
}

interface BatchUpdateResponse {
  success: boolean
  output: {
    replies: unknown[]
    writeControl: unknown
    metadata: { presentationId: string; url: string; requestCount: number }
  }
}

export const batchUpdateTool: ToolConfig<BatchUpdateParams, BatchUpdateResponse> = {
  id: 'google_slides_batch_update',
  name: 'Batch Update Google Slides (Raw)',
  description:
    'Run a raw Slides API batchUpdate with a list of Request objects. Use this when the higher-level tools do not cover an operation, or to bundle multiple operations into a single atomic batch (all-or-nothing).',
  version: '1.0.0',

  oauth: { required: true, provider: 'google-drive' },

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
    requests: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of Slides API Request objects. Example: [{"replaceAllText":{"containsText":{"text":"{{title}}"},"replaceText":"Q3 Review"}}, {"updatePageProperties":{"objectId":"slide_1","pageProperties":{"pageBackgroundFill":{"solidFill":{"color":{"rgbColor":{"red":0.043,"green":0.122,"blue":0.231}}}}},"fields":"pageBackgroundFill"}}]',
    },
    writeControl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional JSON WriteControl object for optimistic concurrency, e.g. {"requiredRevisionId":"..."}',
    },
  },

  request: {
    url: (params) => batchUpdateUrl(params.presentationId),
    method: 'POST',
    headers: (params) => authJsonHeaders(params.accessToken),
    body: (params) => {
      const raw = params.requests
      if (!raw) throw new Error('Requests JSON is required')

      let requests: unknown
      try {
        requests = typeof raw === 'string' ? JSON.parse(raw) : raw
      } catch (e) {
        throw new Error(`Invalid requests JSON: ${(e as Error).message}`)
      }
      if (!Array.isArray(requests)) {
        throw new Error('Requests must be a JSON array of Request objects')
      }
      if (requests.length === 0) {
        throw new Error('Requests array must contain at least one Request')
      }

      const body: Record<string, unknown> = { requests }

      if (params.writeControl?.trim()) {
        try {
          const wc = JSON.parse(params.writeControl)
          if (wc && typeof wc === 'object') body.writeControl = wc
        } catch (e) {
          logger.warn('Invalid writeControl JSON, ignoring:', { error: e })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()
    if (!response.ok) {
      logger.error('Google Slides API error:', { data })
      throw new Error(data.error?.message || 'Batch update failed')
    }
    const presentationId = params?.presentationId?.trim() || ''
    const replies: unknown[] = Array.isArray(data.replies) ? data.replies : []
    return {
      success: true,
      output: {
        replies,
        writeControl: data.writeControl ?? null,
        metadata: {
          presentationId,
          url: presentationUrl(presentationId),
          requestCount: replies.length,
        },
      },
    }
  },

  outputs: {
    replies: {
      type: 'array',
      description: 'Array of reply objects, one per request (parallel-indexed)',
      items: { type: 'json' },
    },
    writeControl: {
      type: 'json',
      description: 'WriteControl returned by the server (revision tracking)',
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        presentationId: { type: 'string', description: 'The presentation ID' },
        url: { type: 'string', description: 'URL to the presentation' },
        requestCount: { type: 'number', description: 'Number of replies returned' },
      },
    },
  },
}
