import type {
  LogRocketRequestHighlightsParams,
  LogRocketRequestHighlightsResponse,
} from '@/tools/logrocket/types'
import { buildAppUrl, buildAuthHeaders, throwOnError } from '@/tools/logrocket/utils'
import type { ToolConfig } from '@/tools/types'

export const requestHighlightsTool: ToolConfig<
  LogRocketRequestHighlightsParams,
  LogRocketRequestHighlightsResponse
> = {
  id: 'logrocket_request_highlights',
  name: 'LogRocket Request Highlights',
  description:
    "Start a Galileo session highlights job for a user. Returns a request ID to poll with LogRocket's Get Highlights operation.",
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
    userEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email of the user to summarize. Required if no user ID is given.',
    },
    userID: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the user to summarize. Required if no email is given.',
    },
    question: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Question to focus the highlights on',
    },
    startMs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the session window, in milliseconds since epoch',
    },
    endMs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the session window, in milliseconds since epoch',
    },
    webhookURL: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL notified when the highlights job finishes',
    },
  },

  request: {
    /**
     * Galileo Highlights answers `question` with an LLM, so that string is the
     * only model-visible field here. The identity, time-window, and webhook
     * fields are lookup and control inputs that never reach the model.
     */
    modelInput: {
      mode: 'project',
      select: (params) => (params.question?.trim() ? { question: params.question } : {}),
    },
    url: (params) => buildAppUrl(params, 'highlights/').toString(),
    method: 'POST',
    headers: (params) => ({
      ...buildAuthHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      /*
       * Trim before testing presence: a whitespace-only value from an upstream
       * block is not an identity, and forwarding it would have LogRocket reject
       * the request instead of failing here with a usable message.
       */
      const userEmail = params.userEmail?.trim()
      const userID = params.userID?.trim()
      const question = params.question?.trim()
      const webhookURL = params.webhookURL?.trim()

      if (!userEmail && !userID) {
        throw new Error(
          'LogRocket Request Highlights: provide either a user email or a user ID to summarize'
        )
      }

      if (userEmail) body.userEmail = userEmail
      if (userID) body.userID = userID
      if (question) body.question = question
      if (webhookURL) body.webhookURL = webhookURL

      /*
       * The API requires both bounds whenever timeRange is present, so a partial
       * or non-numeric window fails loudly rather than silently widening the
       * search to the user's entire session history.
       */
      const hasStart = Boolean(params.startMs?.trim())
      const hasEnd = Boolean(params.endMs?.trim())
      if (hasStart !== hasEnd) {
        throw new Error('LogRocket Request Highlights: startMs and endMs must be provided together')
      }
      if (hasStart && hasEnd) {
        const startMs = Number(params.startMs)
        const endMs = Number(params.endMs)
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
          throw new Error(
            'LogRocket Request Highlights: startMs and endMs must be milliseconds since epoch'
          )
        }
        if (startMs >= endMs) {
          throw new Error('LogRocket Request Highlights: startMs must be earlier than endMs')
        }
        body.timeRange = { startMs, endMs }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await throwOnError(response, 'LogRocket Highlights API')) as {
      id?: string
    } | null

    if (!data?.id) {
      throw new Error('LogRocket Highlights API did not return a request ID')
    }

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Request ID used to retrieve the highlights result',
    },
  },
}
