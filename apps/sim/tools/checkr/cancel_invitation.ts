import {
  type CheckrInvitationIdParams,
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

export const checkrCancelInvitationTool: ToolConfig<
  CheckrInvitationIdParams,
  CheckrInvitationResponse
> = {
  id: 'checkr_cancel_invitation',
  name: 'Checkr Cancel Invitation',
  description: 'Cancel a pending invitation so the candidate can no longer complete it.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    invitationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the invitation to cancel',
    },
  },

  request: {
    url: (params) => checkrUrl(`/invitations/${checkrId(params.invitationId, 'invitationId')}`),
    method: 'DELETE',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { invitation: mapInvitation(data) } }
  },

  outputs: {
    invitation: {
      type: 'object',
      description: 'The canceled invitation',
      properties: INVITATION_PROPERTIES,
    },
  },
}
