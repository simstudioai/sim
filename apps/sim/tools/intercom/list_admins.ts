import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomListAdminsParams {
  accessToken: string
}

interface IntercomAdmin {
  type: string
  id: string
  name: string
  email: string
  job_title: string | null
  away_mode_enabled: boolean
  away_mode_reassign: boolean
  has_inbox_seat: boolean
  team_ids: number[]
  avatar: {
    type: string
    image_url: string | null
  } | null
  email_verified: boolean | null
}

export interface IntercomListAdminsV2Response {
  success: boolean
  output: {
    admins: IntercomAdmin[]
    type: string
  }
}

const listAdminsBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
  },

  request: {
    url: () => buildIntercomUrl('/admins'),
    method: 'GET',
    headers: (params: IntercomListAdminsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomListAdminsParams, any>, 'params' | 'request'>

export const intercomListAdminsV2Tool: ToolConfig<
  IntercomListAdminsParams,
  IntercomListAdminsV2Response
> = {
  ...listAdminsBase,
  id: 'intercom_list_admins_v2',
  name: 'List Admins from Intercom',
  description: 'Fetch a list of all admins for the workspace',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_admins')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        admins: data.admins ?? [],
        type: data.type ?? 'admin.list',
      },
    }
  },

  outputs: {
    admins: {
      type: 'array',
      description: 'Array of admin objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the admin' },
          type: { type: 'string', description: 'Object type (admin)' },
          name: { type: 'string', description: 'Name of the admin' },
          email: { type: 'string', description: 'Email of the admin' },
          job_title: { type: 'string', description: 'Job title of the admin', optional: true },
          away_mode_enabled: {
            type: 'boolean',
            description: 'Whether admin is in away mode',
          },
          away_mode_reassign: {
            type: 'boolean',
            description: 'Whether to reassign conversations when away',
          },
          has_inbox_seat: {
            type: 'boolean',
            description: 'Whether admin has a paid inbox seat',
          },
          team_ids: {
            type: 'array',
            description: 'List of team IDs the admin belongs to',
          },
          avatar: {
            type: 'object',
            description: 'Avatar information',
            optional: true,
          },
          email_verified: {
            type: 'boolean',
            description: 'Whether email is verified',
            optional: true,
          },
        },
      },
    },
    type: { type: 'string', description: 'Object type (admin.list)' },
  },
}
