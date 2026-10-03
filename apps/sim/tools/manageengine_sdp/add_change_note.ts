import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpAddChangeNoteParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_MODULE_NOTE_PROPERTIES } from '@/tools/manageengine_sdp/types'
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

export const manageengineSdpAddChangeNoteTool: ToolConfig<SdpAddChangeNoteParams, SdpResponse> = {
  id: 'manageengine_sdp_add_change_note',
  name: 'ManageEngine SDP Add Change Note',
  description: 'Add a note to a ManageEngine ServiceDesk Plus Cloud change.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    changeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the change to add the note to',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Note body. HTML is supported',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/changes/${safeUrlPathSegment(params.changeId, 'Change ID')}/notes`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    // Wrapped in `note`, matching problem notes — not `change_note`.
    body: (params) =>
      buildSdpInputDataBody(
        'note',
        compactSdpEntity({ description: orUndefined(params.description) })
      ),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to add change note')
    return { success: true, output: { note: data.note ?? null } }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The created note',
      nullable: true,
      properties: SDP_MODULE_NOTE_PROPERTIES,
    },
  },
}
