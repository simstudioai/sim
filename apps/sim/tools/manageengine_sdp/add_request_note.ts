import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpAddRequestNoteParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_REQUEST_NOTE_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  compactSdpEntity,
  getSdpApiBase,
  orUndefined,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpAddRequestNoteTool: ToolConfig<SdpAddRequestNoteParams, SdpResponse> = {
  id: 'manageengine_sdp_add_request_note',
  name: 'ManageEngine SDP Add Request Note',
  description:
    'Add a note to a ManageEngine ServiceDesk Plus Cloud request, optionally making it visible to the requester.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the request to add the note to',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Note body. HTML is supported',
    },
    showToRequester: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the requester can see this note',
    },
    notifyTechnician: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to notify the assigned technician',
    },
    markFirstResponse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this note counts as the first response for SLA purposes',
    },
    addToLinkedRequests: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to copy the note to linked requests',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/requests/${safeUrlPathSegment(params.requestId, 'Request ID')}/notes`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    body: (params) =>
      buildSdpInputDataBody(
        'request_note',
        compactSdpEntity({
          description: orUndefined(params.description),
          show_to_requester: params.showToRequester,
          notify_technician: params.notifyTechnician,
          mark_first_response: params.markFirstResponse,
          add_to_linked_requests: params.addToLinkedRequests,
        })
      ),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to add note')
    return { success: true, output: { note: data.request_note ?? null } }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The created note',
      nullable: true,
      properties: SDP_REQUEST_NOTE_PROPERTIES,
    },
  },
}
