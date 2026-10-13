import {
  type CheckrCreateInvitationParams,
  type CheckrInvitationResponse,
  INVITATION_PROPERTIES,
} from '@/tools/checkr/types'
import {
  applyHierarchyFields,
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_HIERARCHY_PARAMS,
  checkrHeaders,
  checkrUrl,
  mapInvitation,
  parseCheckrStringList,
  trimmed,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrCreateInvitationTool: ToolConfig<
  CheckrCreateInvitationParams,
  CheckrInvitationResponse
> = {
  id: 'checkr_create_invitation',
  name: 'Checkr Create Invitation',
  description:
    'Invite a candidate to complete a background check through the Checkr-hosted apply flow. Checkr emails the candidate a link to provide their information and consent.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    candidateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the candidate to invite',
    },
    package: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Slug of the package to run, e.g. driver_pro',
    },
    ...CHECKR_HIERARCHY_PARAMS,
    tags: {
      type: 'array',
      items: { type: 'string' },
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags for the resulting report',
    },
  },

  request: {
    url: () => checkrUrl('/invitations'),
    method: 'POST',
    headers: (params) => checkrHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        candidate_id: trimmed(params.candidateId),
        package: trimmed(params.package),
      }
      applyHierarchyFields(body, params)
      const tags = parseCheckrStringList(params.tags)
      if (tags) body.tags = tags
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { invitation: mapInvitation(data) } }
  },

  outputs: {
    invitation: {
      type: 'object',
      description: 'The created invitation',
      properties: INVITATION_PROPERTIES,
    },
  },
}
