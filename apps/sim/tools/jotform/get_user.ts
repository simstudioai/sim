import { unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetUserParams, JotformGetUserResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getUserTool: ToolConfig<JotformGetUserParams, JotformGetUserResponse> = {
  id: 'jotform_get_user',
  name: 'Jotform Get Account',
  description:
    'Get the Jotform account behind the API key, including its plan, status, time zone, and contact details.',
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
  },

  request: {
    url: (params) => buildJotformUrl(params, 'user').toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Account')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Get Account returned no user.')

    return {
      success: true,
      output: {
        user: {
          username: toStringOrNull(raw.username),
          name: toStringOrNull(raw.name),
          email: toStringOrNull(raw.email),
          website: toStringOrNull(raw.website),
          time_zone: toStringOrNull(raw.time_zone),
          account_type: toStringOrNull(raw.account_type),
          status: toStringOrNull(raw.status),
          created_at: toStringOrNull(raw.created_at),
          updated_at: toStringOrNull(raw.updated_at),
          is_verified: toStringOrNull(raw.is_verified),
          industry: toStringOrNull(raw.industry),
          company: toStringOrNull(raw.company),
          language: toStringOrNull(raw.language),
          avatarUrl: toStringOrNull(raw.avatarUrl),
          usage: toStringOrNull(raw.usage),
        },
      },
    }
  },

  outputs: {
    user: {
      type: 'object',
      description: 'The account the API key belongs to',
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
