import {
  type CheckrListInvitationsParams,
  type CheckrListInvitationsResponse,
  INVITATION_PROPERTIES,
  LIST_META_OUTPUTS,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapInvitation,
  mapListMeta,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListInvitationsTool: ToolConfig<
  CheckrListInvitationsParams,
  CheckrListInvitationsResponse
> = {
  id: 'checkr_list_invitations',
  name: 'Checkr List Invitations',
  description: 'List invitations, optionally filtered by candidate or status.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return invitations for this candidate ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return invitations with this status (pending, completed, expired)',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl('/invitations', {
        candidate_id: params.candidateId,
        status: params.status,
        ...checkrPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        invitations: (Array.isArray(data.data) ? data.data : []).map(mapInvitation),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    invitations: {
      type: 'array',
      description: 'Matching invitations',
      items: { type: 'object', properties: INVITATION_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
