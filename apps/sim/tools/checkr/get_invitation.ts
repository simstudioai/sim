import {
  type CheckrGetInvitationParams,
  type CheckrInvitationResponse,
  INVITATION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapInvitation,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetInvitationTool: ToolConfig<
  CheckrGetInvitationParams,
  CheckrInvitationResponse
> = {
  id: 'checkr_get_invitation',
  name: 'Checkr Get Invitation',
  description: 'Retrieve an invitation by ID, including its status and invitation URL.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    invitationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the invitation to retrieve',
    },
    includeDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to return the invitation even if it was canceled',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/invitations/${checkrId(params.invitationId, 'invitationId')}`, {
        include_deleted: params.includeDeleted === true ? true : undefined,
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { invitation: mapInvitation(data) } }
  },

  outputs: {
    invitation: {
      type: 'object',
      description: 'The invitation',
      properties: INVITATION_PROPERTIES,
    },
  },
}
