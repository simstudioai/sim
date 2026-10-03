import { normalizeUser, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformUpdateSettingsParams, JotformUserResponse } from '@/tools/jotform/types'
import {
  buildJotformUrl,
  jotformFormHeaders,
  parseJotformResponse,
  toFormBody,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSettingsTool: ToolConfig<JotformUpdateSettingsParams, JotformUserResponse> = {
  id: 'jotform_update_settings',
  name: 'Jotform Update Settings',
  description:
    'Update account settings such as name, email, website, company, industry, or time zone. Only the supplied fields change.',
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
    settingsName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New display name on the account',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New account email address',
    },
    website: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New website recorded on the account',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New account time zone in IANA format, e.g. America/New_York',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New company recorded on the account',
    },
    industry: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New industry recorded on the account',
    },
  },

  request: {
    url: (params) => buildJotformUrl(params, 'user/settings').toString(),
    method: 'POST',
    headers: (params) => jotformFormHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const name = trimOrUndefined(params.settingsName)
      const email = trimOrUndefined(params.email)
      const website = trimOrUndefined(params.website)
      const timeZone = trimOrUndefined(params.timeZone)
      const company = trimOrUndefined(params.company)
      const industry = trimOrUndefined(params.industry)

      if (name) body.name = name
      if (email) body.email = email
      if (website) body.website = website
      if (timeZone) body.time_zone = timeZone
      if (company) body.company = company
      if (industry) body.industry = industry

      if (Object.keys(body).length === 0) {
        throw new Error('Supply at least one account setting to update.')
      }

      return toFormBody(body)
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Update Settings')
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
        'The account after the update. Jotform returns null for the fields it did not echo back.',
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
