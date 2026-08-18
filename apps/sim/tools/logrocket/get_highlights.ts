import type {
  LogRocketGetHighlightsParams,
  LogRocketGetHighlightsResponse,
} from '@/tools/logrocket/types'
import { buildAppUrl, buildAuthHeaders, throwOnError } from '@/tools/logrocket/utils'
import type { ToolConfig } from '@/tools/types'

export const getHighlightsTool: ToolConfig<
  LogRocketGetHighlightsParams,
  LogRocketGetHighlightsResponse
> = {
  id: 'logrocket_get_highlights',
  name: 'LogRocket Get Highlights',
  description:
    'Retrieve the result of a Galileo session highlights request. Status is PENDING until generation finishes, then READY or FAILED.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket API key',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket organization ID',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LogRocket project (app) ID',
    },
    apiHost: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API host override for Private Cloud deployments',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Request ID returned by the Request Highlights operation',
    },
  },

  request: {
    url: (params) => {
      const url = buildAppUrl(params, 'highlights')
      url.searchParams.set('id', params.id.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildAuthHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = (await throwOnError(response, 'LogRocket Highlights API')) as {
      status?: string
      requestID?: string
      appID?: string
      result?: {
        highlights?: string
        sessions?: Array<{ recordingID?: string; sessionID?: number; highlights?: string }>
      } | null
    } | null

    const sessions = (data?.result?.sessions ?? []).map((session) => ({
      recordingID: session.recordingID ?? null,
      sessionID: session.sessionID ?? null,
      highlights: session.highlights ?? null,
    }))

    if (!data?.status) {
      throw new Error('LogRocket Highlights API did not return a job status')
    }

    return {
      success: true,
      output: {
        status: data.status,
        requestID: data?.requestID ?? null,
        appID: data?.appID ?? null,
        highlights: data?.result?.highlights ?? null,
        sessions,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Job status: PENDING, READY, or FAILED',
    },
    requestID: {
      type: 'string',
      description: 'ID of the highlights request',
      optional: true,
    },
    appID: {
      type: 'string',
      description: 'LogRocket project the request belongs to',
      optional: true,
    },
    highlights: {
      type: 'string',
      description: 'Markdown summary across the matched sessions. Present when status is READY.',
      optional: true,
    },
    sessions: {
      type: 'array',
      description: 'Per-session highlights',
      items: {
        type: 'object',
        properties: {
          recordingID: { type: 'string', description: 'LogRocket recording ID' },
          sessionID: { type: 'number', description: 'Session number within the recording' },
          highlights: { type: 'string', description: 'Highlights for this session' },
        },
      },
    },
  },
}
