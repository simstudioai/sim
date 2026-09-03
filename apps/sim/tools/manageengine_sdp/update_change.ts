import { buildSdpChangeEntity } from '@/tools/manageengine_sdp/entity-builders'
import { SDP_BASE_PARAMS, SDP_CHANGE_WRITE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpResponse, SdpUpdateChangeParams } from '@/tools/manageengine_sdp/types'
import { SDP_CHANGE_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  getSdpApiBase,
  parseSdpResponse,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpUpdateChangeTool: ToolConfig<SdpUpdateChangeParams, SdpResponse> = {
  id: 'manageengine_sdp_update_change',
  name: 'ManageEngine SDP Update Change',
  description:
    'Update a ManageEngine ServiceDesk Plus Cloud change: move its stage or status, reschedule it, or change its assignment. ServiceDesk Plus requires a comment whenever the status changes.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    changeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the change to update',
    },
    // Optional here, unlike on create: an edit may touch only the schedule.
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New change title',
    },
    stage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Change stage name to set',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Change status name to set. Requires a comment',
    },
    ...SDP_CHANGE_WRITE_PARAMS,
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/changes/${safeUrlPathSegment(params.changeId, 'Change ID')}`,
    method: 'PUT',
    headers: (params) => buildSdpHeaders(params),
    body: (params) => buildSdpInputDataBody('change', buildSdpChangeEntity(params)),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to update change')
    return { success: true, output: { change: data.change ?? null } }
  },

  outputs: {
    change: {
      type: 'object',
      description: 'The updated change',
      nullable: true,
      properties: SDP_CHANGE_PROPERTIES,
    },
  },
}
