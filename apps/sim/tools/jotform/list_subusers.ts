import { normalizeSubUser, toList } from '@/tools/jotform/normalize'
import type { JotformListSubUsersParams, JotformListSubUsersResponse } from '@/tools/jotform/types'
import { buildJotformHeaders, buildJotformUrl, parseJotformResponse } from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listSubUsersTool: ToolConfig<JotformListSubUsersParams, JotformListSubUsersResponse> =
  {
    id: 'jotform_list_subusers',
    name: 'Jotform List Sub-Users',
    description:
      'List the sub-users on the account with the forms and folders each one can reach, and at what access level.',
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
      url: (params) => buildJotformUrl(params, 'user/subusers').toString(),
      method: 'GET',
      headers: (params) => buildJotformHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const envelope = await parseJotformResponse(response, 'Jotform List Sub-Users')

      return {
        success: true,
        output: {
          subusers: toList(envelope.content).map(normalizeSubUser),
        },
      }
    },

    outputs: {
      subusers: {
        type: 'array',
        description: 'Sub-users on the account',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string', description: 'Sub-user username' },
            email: { type: 'string', description: 'Sub-user email address' },
            owner: { type: 'string', description: 'Parent account that created the sub-user' },
            status: {
              type: 'string',
              description: 'LIVE, DELETED, or PENDING while an invitation is unaccepted',
            },
            created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
            permissions: {
              type: 'json',
              description:
                'What the sub-user can reach: each entry has type (FORM, FOLDER, or ALL), resource_id, access_type (full or readOnly), and title',
            },
          },
        },
      },
    },
  }
