import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListRequestNotesParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import {
  SDP_LIST_INFO_PROPERTIES,
  SDP_REQUEST_NOTE_PROPERTIES,
} from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpListUrl,
  getSdpApiBase,
  parseSdpResponse,
  readSdpList,
  readSdpListInfo,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpListRequestNotesTool: ToolConfig<
  SdpListRequestNotesParams,
  SdpResponse
> = {
  id: 'manageengine_sdp_list_request_notes',
  name: 'ManageEngine SDP List Request Notes',
  description: 'List the notes on a ManageEngine ServiceDesk Plus Cloud request.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the request whose notes to list',
    },
    ...SDP_LIST_PARAMS,
  },

  request: {
    url: (params) =>
      buildSdpListUrl(
        `${getSdpApiBase(params)}/requests/${safeUrlPathSegment(params.requestId, 'Request ID')}/notes`,
        params
      ),
    method: 'GET',
    headers: (params) => buildSdpHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to list notes')
    // The list endpoint returns its rows under `notes`, not `request_notes`.
    const notes = readSdpList(data, 'notes')
    return {
      success: true,
      output: { notes, count: notes.length, listInfo: readSdpListInfo(data) ?? null },
    }
  },

  outputs: {
    notes: {
      type: 'array',
      description: 'Notes on the request',
      items: { type: 'object', properties: SDP_REQUEST_NOTE_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of notes returned in this page' },
    listInfo: {
      type: 'object',
      description: 'Paging metadata echoed by ServiceDesk Plus',
      optional: true,
      nullable: true,
      properties: SDP_LIST_INFO_PROPERTIES,
    },
  },
}
