import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpAddProblemNoteParams, SdpResponse } from '@/tools/manageengine_sdp/types'
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

export const manageengineSdpAddProblemNoteTool: ToolConfig<SdpAddProblemNoteParams, SdpResponse> = {
  id: 'manageengine_sdp_add_problem_note',
  name: 'ManageEngine SDP Add Problem Note',
  description: 'Add a note to a ManageEngine ServiceDesk Plus Cloud problem.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    problemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the problem to add the note to',
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
      `${getSdpApiBase(params)}/problems/${safeUrlPathSegment(params.problemId, 'Problem ID')}/notes`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    // Problem and change notes wrap their body in `note`, not `problem_note` —
    // unlike request notes, which use `request_note`.
    body: (params) =>
      buildSdpInputDataBody(
        'note',
        compactSdpEntity({ description: orUndefined(params.description) })
      ),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to add problem note')
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
