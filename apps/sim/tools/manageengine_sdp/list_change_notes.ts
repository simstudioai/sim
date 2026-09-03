import { SDP_BASE_PARAMS, SDP_LIST_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpListChangeNotesParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import {
  SDP_LIST_INFO_PROPERTIES,
  SDP_MODULE_NOTE_PROPERTIES,
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

export const manageengineSdpListChangeNotesTool: ToolConfig<SdpListChangeNotesParams, SdpResponse> =
  {
    id: 'manageengine_sdp_list_change_notes',
    name: 'ManageEngine SDP List Change Notes',
    description: 'List the notes on a ManageEngine ServiceDesk Plus Cloud change.',
    version: '1.0.0',

    oauth: { required: true, provider: 'manageengine-sdp' },

    params: {
      ...SDP_BASE_PARAMS,
      changeId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the change whose notes to list',
      },
      ...SDP_LIST_PARAMS,
    },

    request: {
      url: (params) =>
        buildSdpListUrl(
          `${getSdpApiBase(params)}/changes/${safeUrlPathSegment(params.changeId, 'Change ID')}/notes`,
          params
        ),
      method: 'GET',
      headers: (params) => buildSdpHeaders(params),
    },

    transformResponse: async (response) => {
      const data = await parseSdpResponse(response, 'Failed to list change notes')
      const notes = readSdpList(data, 'notes')
      return {
        success: true,
        output: { notes, count: notes.length, listInfo: readSdpListInfo(data) ?? null },
      }
    },

    outputs: {
      notes: {
        type: 'array',
        description: 'Notes on the change',
        items: { type: 'object', properties: SDP_MODULE_NOTE_PROPERTIES },
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
