import { normalizeUser, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetSettingsParams, JotformUserResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getSettingsTool: ToolConfig<JotformGetSettingsParams, JotformUserResponse> = {
  id: 'jotform_get_settings',
  name: 'Jotform Get Settings',
  description:
    'Read the account settings behind the API key, including time zone, language, and contact details.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
    settingsKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single setting to read instead of the whole set, e.g. time_zone',
    },
  },

  request: {
    url: (params) => {
      const key = trimOrUndefined(params.settingsKey)
      const path = key ? `user/settings/${encodeURIComponent(key)}` : 'user/settings'
      return buildJotformUrl(params, path).toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Settings')
    const raw = unwrapSingle(envelope.content) ?? {}

    return {
      success: true,
      output: { user: normalizeUser(raw) },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description:
        'Account settings. Reading a single setting fills only that field and leaves the rest null.',
      properties: {
        username: { type: 'string', description: 'Jotform username' },
        name: { type: 'string', description: 'Display name on the account' },
        email: { type: 'string', description: 'Account email address' },
        website: { type: 'string', description: 'Website recorded on the account' },
        time_zone: { type: 'string', description: 'Account time zone, in IANA format' },
        account_type: { type: 'string', description: 'URL of the plan the account is on' },
        status: { type: 'string', description: 'ACTIVE, DELETED, or SUSPENDED' },
        created_at: { type: 'string', description: 'Account creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
        is_verified: { type: 'string', description: '1 when the account email is verified' },
        industry: { type: 'string', description: 'Industry recorded on the account' },
        company: { type: 'string', description: 'Company recorded on the account' },
        language: { type: 'string', description: 'Account interface language, e.g. en-US' },
        avatarUrl: { type: 'string', description: 'Avatar image URL' },
        usage: { type: 'string', description: 'URL of the monthly usage endpoint' },
      },
    },
  },
}
