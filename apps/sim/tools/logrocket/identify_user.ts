import type {
  LogRocketIdentifyUserParams,
  LogRocketIdentifyUserResponse,
} from '@/tools/logrocket/types'
import { buildAppUrl, buildAuthHeaders, throwOnError } from '@/tools/logrocket/utils'
import type { ToolConfig } from '@/tools/types'

export const identifyUserTool: ToolConfig<
  LogRocketIdentifyUserParams,
  LogRocketIdentifyUserResponse
> = {
  id: 'logrocket_identify_user',
  name: 'LogRocket Identify User',
  description:
    'Create or update a LogRocket user profile with demographic, financial, and engagement traits.',
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
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the user to create or update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name of the user. Maximum 1024 characters.',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email of the user. Maximum 1024 characters.',
    },
    timestamp: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unix timestamp in milliseconds describing when the submitted data was true',
    },
    traits: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of custom traits. Each key and value is limited to 1024 characters and stored as a string.',
    },
  },

  request: {
    url: (params) =>
      buildAppUrl(params, `users/${encodeURIComponent(params.userId.trim())}`).toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildAuthHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      const name = params.name?.trim()
      const email = params.email?.trim()

      if (name) body.name = name
      if (email) body.email = email

      if (params.timestamp?.trim()) {
        const timestamp = Number(params.timestamp)
        if (!Number.isFinite(timestamp)) {
          throw new Error('LogRocket Identify User: timestamp must be milliseconds since epoch')
        }
        body.timestamp = timestamp
      }

      if (params.traits?.trim()) {
        let parsed: unknown
        try {
          parsed = JSON.parse(params.traits)
        } catch {
          throw new Error('LogRocket Identify User: traits must be a valid JSON object')
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error(
            'LogRocket Identify User: traits must be a JSON object, not an array or scalar'
          )
        }
        body.traits = parsed
      }

      if (Object.keys(body).length === 0) {
        throw new Error(
          'LogRocket Identify User: provide at least one of name, email, timestamp, or traits'
        )
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = (await throwOnError(response, 'LogRocket User Identification API')) as {
      userID?: string
      name?: string
      email?: string
      traits?: Record<string, string>
    } | null

    return {
      success: true,
      output: {
        userID: data?.userID ?? null,
        name: data?.name ?? null,
        email: data?.email ?? null,
        traits: data?.traits ?? {},
      },
    }
  },

  outputs: {
    userID: {
      type: 'string',
      description: 'ID of the created or updated user',
      optional: true,
    },
    name: {
      type: 'string',
      description: 'Display name stored on the profile',
      optional: true,
    },
    email: {
      type: 'string',
      description: 'Email stored on the profile',
      optional: true,
    },
    traits: {
      type: 'json',
      description: 'Custom traits stored on the profile, with every value coerced to a string',
    },
  },
}
