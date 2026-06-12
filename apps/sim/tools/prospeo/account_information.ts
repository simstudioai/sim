import {
  extractProspeoError,
  type ProspeoAccountInformationParams,
  type ProspeoAccountInformationResponse,
} from '@/tools/prospeo/types'
import type { ToolConfig } from '@/tools/types'

export const accountInformationTool: ToolConfig<
  ProspeoAccountInformationParams,
  ProspeoAccountInformationResponse
> = {
  id: 'prospeo_account_information',
  name: 'Prospeo Account Information',
  description:
    'Retrieve the current plan, remaining credits, and renewal date of your Prospeo account.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Prospeo API key',
    },
  },

  request: {
    url: 'https://api.prospeo.io/account-information',
    method: 'GET',
    headers: (params) => ({
      'X-KEY': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await extractProspeoError(response))
    }
    const data = await response.json()
    const r = data.response ?? {}
    return {
      success: true,
      output: {
        current_plan: r.current_plan ?? null,
        current_team_members: r.current_team_members ?? null,
        remaining_credits: r.remaining_credits ?? null,
        used_credits: r.used_credits ?? null,
        next_quota_renewal_days: r.next_quota_renewal_days ?? null,
        next_quota_renewal_date: r.next_quota_renewal_date ?? null,
      },
    }
  },

  outputs: {
    current_plan: { type: 'string', description: 'Current Prospeo plan name', optional: true },
    current_team_members: {
      type: 'number',
      description: 'Number of team members in your team',
      optional: true,
    },
    remaining_credits: {
      type: 'number',
      description: 'Number of credits remaining',
      optional: true,
    },
    used_credits: { type: 'number', description: 'Number of credits already used', optional: true },
    next_quota_renewal_days: {
      type: 'number',
      description: 'Days until the next quota renewal',
      optional: true,
    },
    next_quota_renewal_date: {
      type: 'string',
      description: 'Date and time of the next quota renewal',
      optional: true,
    },
  },
}
