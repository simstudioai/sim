import type { ThriveUpdateUserParams, ThriveUserResponse } from '@/tools/thrive/types'
import { THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveJsonObject,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const updateUserTool: ToolConfig<ThriveUpdateUserParams, ThriveUserResponse> = {
  id: 'thrive_update_user',
  name: 'Thrive Update User',
  description: 'Update an existing user in Thrive by ref. Only the fields provided are changed.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user ref to update',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The given name of the individual',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The family name of the individual',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The email address for the user',
    },
    loginMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "How the user logs in: 'email' or 'ref'",
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Role assigned: 'administrator', 'learneradmin', or 'learner'",
    },
    jobTitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Name of this individual's role in your organisation",
    },
    managerRef: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Your organisation's unique identifier for this individual's line manager",
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date this individual started with your organisation (ISO 8601)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date this individual left your organisation (ISO 8601)',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The user's preferred timezone",
    },
    languageCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The user's preferred language (e.g. 'en-gb')",
    },
    sso: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the account is managed by an authentication provider',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Domain this individual is associated with',
    },
    additionalFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of custom field key-value pairs. Example: {"department":"Sales"}',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v2')}/users/ref/${encodeURIComponent(params.ref)}`,
    method: 'PATCH',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.firstName !== undefined) body.firstName = params.firstName
      if (params.lastName !== undefined) body.lastName = params.lastName
      if (params.email !== undefined) body.email = params.email
      if (params.loginMethod !== undefined) body.loginMethod = params.loginMethod
      if (params.role !== undefined) body.role = params.role
      if (params.jobTitle !== undefined) body.jobTitle = params.jobTitle
      if (params.managerRef !== undefined) body.managerRef = params.managerRef
      if (params.startDate !== undefined) body.startDate = params.startDate
      if (params.endDate !== undefined) body.endDate = params.endDate
      if (params.timeZone !== undefined) body.timeZone = params.timeZone
      if (params.languageCode !== undefined) body.languageCode = params.languageCode
      if (params.sso !== undefined) body.sso = params.sso
      if (params.domain !== undefined) body.domain = params.domain
      if (params.additionalFields) {
        body.additionalFields = parseThriveJsonObject(params.additionalFields, 'additionalFields')
      }
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveUserResponse> => {
    const data = await parseThriveResponse(response, 'Failed to update user')
    return { success: true, output: { user: data ?? null } }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The updated user',
      properties: THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES,
    },
  },
}
