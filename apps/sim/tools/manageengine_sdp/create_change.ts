import { buildSdpChangeEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_BASE_PARAMS, SDP_CHANGE_WRITE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpChangeWriteParams, SdpResponse } from '@/tools/manageengine_sdp/types'
import { SDP_CHANGE_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'

export const manageengineSdpCreateChangeTool: ToolConfig<SdpChangeWriteParams, SdpResponse> = {
  id: 'manageengine_sdp_create_change',
  name: 'ManageEngine SDP Create Change',
  description:
    'Create a change record in ManageEngine ServiceDesk Plus Cloud with a title, stage, status and schedule.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    // title, stage and status are the three fields ServiceDesk Plus documents
    // as mandatory on Add Change.
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Change title',
    },
    stage: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Change stage name, e.g. Submission',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Change status name, e.g. Open',
    },
    ...SDP_CHANGE_WRITE_PARAMS,
  },

  request: {
    url: (params) => `${getSdpApiBase(params)}/changes`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('change', buildSdpChangeEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to create change')
    return { success: true, output: { change: data.change ?? null } }
  },

  outputs: {
    change: {
      type: 'object',
      description: 'The created change',
      nullable: true,
      properties: SDP_CHANGE_PROPERTIES,
    },
  },
}
