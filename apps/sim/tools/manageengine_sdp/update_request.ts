import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpResponse, SdpUpdateRequestParams } from '@/tools/manageengine_sdp/types'
import { SDP_REQUEST_PROPERTIES } from '@/tools/manageengine_sdp/types'
import {
  buildSdpHeaders,
  buildSdpInputDataBody,
  compactSdpEntity,
  getSdpApiBase,
  orUndefined,
  parseSdpJson,
  parseSdpResponse,
  toSdpNameReference,
  toSdpUserReference,
} from '@/tools/manageengine_sdp/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const manageengineSdpUpdateRequestTool: ToolConfig<SdpUpdateRequestParams, SdpResponse> = {
  id: 'manageengine_sdp_update_request',
  name: 'ManageEngine SDP Update Request',
  description:
    'Update a ManageEngine ServiceDesk Plus Cloud request: change its status, priority, assignment, classification or description.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    requestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the request to update',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New subject (maximum 250 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description. HTML is supported',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority name to set, e.g. High',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status name to set, e.g. Resolved',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category name to set',
    },
    subcategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subcategory name to set',
    },
    group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Support group name to set',
    },
    technicianEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the technician to assign',
    },
    urgency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Urgency name to set',
    },
    impact: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Impact name to set',
    },
    udfFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Portal-defined custom fields to set, e.g. {"udf_char1":"value"}',
    },
  },

  request: {
    url: (params) =>
      `${getSdpApiBase(params)}/requests/${safeUrlPathSegment(params.requestId, 'Request ID')}`,
    method: 'PUT',
    headers: (params) => buildSdpHeaders(params),
    // Absent fields are stripped rather than sent as null: SDP treats an
    // explicit null on a PUT as "clear this field", so forwarding untouched
    // subBlocks would wipe the technician or category on every status change.
    body: (params) =>
      buildSdpInputDataBody(
        'request',
        compactSdpEntity({
          subject: orUndefined(params.subject),
          description: orUndefined(params.description),
          technician: toSdpUserReference(params.technicianEmail),
          priority: toSdpNameReference(params.priority),
          status: toSdpNameReference(params.status),
          category: toSdpNameReference(params.category),
          subcategory: toSdpNameReference(params.subcategory),
          group: toSdpNameReference(params.group),
          urgency: toSdpNameReference(params.urgency),
          impact: toSdpNameReference(params.impact),
          udf_fields: parseSdpJson(params.udfFields, 'custom fields'),
        })
      ),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to update request')
    return { success: true, output: { request: data.request ?? null } }
  },

  outputs: {
    request: {
      type: 'object',
      description: 'The updated request',
      nullable: true,
      properties: SDP_REQUEST_PROPERTIES,
    },
  },
}
