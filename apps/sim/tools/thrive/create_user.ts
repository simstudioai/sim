import type { ThriveCreateUserParams, ThriveUserResponse } from '@/tools/thrive/types'
import { THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import {
  getThriveBaseUrl,
  getThriveHeaders,
  parseThriveJsonObject,
  parseThriveResponse,
} from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const createUserTool: ToolConfig<ThriveCreateUserParams, ThriveUserResponse> = {
  id: 'thrive_create_user',
  name: 'Thrive Create User',
  description: 'Create a new user in Thrive.',
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
      description: "Your organisation's unique identifier for this individual",
    },
    firstName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The given name of the individual',
    },
    lastName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The family name of the individual',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The email address for the user (required unless loginMethod is 'ref')",
    },
    loginMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "How the user logs in: 'email' or 'ref' (defaults to 'email')",
    },
    role: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Role assigned: 'administrator', 'learneradmin', or 'learner' (defaults to 'learner')",
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
      description: "The user's preferred timezone (tenant default if omitted)",
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
    url: (params) => `${getThriveBaseUrl(params.host, 'v2')}/users`,
    method: 'POST',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {
        ref: params.ref,
        firstName: params.firstName,
        lastName: params.lastName,
      }
      if (params.email) body.email = params.email
      if (params.loginMethod) body.loginMethod = params.loginMethod
      if (params.role) body.role = params.role
      if (params.jobTitle) body.jobTitle = params.jobTitle
      if (params.managerRef) body.managerRef = params.managerRef
      if (params.startDate) body.startDate = params.startDate
      if (params.endDate) body.endDate = params.endDate
      if (params.timeZone) body.timeZone = params.timeZone
      if (params.languageCode) body.languageCode = params.languageCode
      if (params.sso !== undefined) body.sso = params.sso
      if (params.domain) body.domain = params.domain
      if (params.additionalFields) {
        body.additionalFields = parseThriveJsonObject(params.additionalFields, 'additionalFields')
      }
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveUserResponse> => {
    const data = await parseThriveResponse(response, 'Failed to create user')
    return { success: true, output: { user: data ?? null } }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The created user',
      properties: THRIVE_USER_LIFECYCLE_OUTPUT_PROPERTIES,
    },
  },
}
