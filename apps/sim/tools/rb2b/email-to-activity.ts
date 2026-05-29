import {
  RB2B_ACTIVITY_RESULT_OUTPUT_PROPERTIES,
  type Rb2bEmailActivityParams,
  type Rb2bEmailActivityResponse,
} from '@/tools/rb2b/types'
import { RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bEmailToActivityTool: ToolConfig<
  Rb2bEmailActivityParams,
  Rb2bEmailActivityResponse
> = {
  id: 'rb2b_email_to_activity',
  name: 'RB2B Email to Last Active Date',
  description: 'Return the last known active date for an email address.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address to look up',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/email_to_activity`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => ({ email: params.email }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        results: data.results ?? [],
        match_count: data.match_count ?? 0,
        credits_charged: data.credits_charged ?? 0,
        credits_exhausted: data.credits_exhausted ?? false,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Activity records for the email',
      items: { type: 'object', properties: RB2B_ACTIVITY_RESULT_OUTPUT_PROPERTIES },
    },
    match_count: { type: 'number', description: 'Number of matches found' },
    credits_charged: { type: 'number', description: 'Credits charged for this request' },
    credits_exhausted: { type: 'boolean', description: 'Whether the account is out of credits' },
  },
}
