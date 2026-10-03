import { SDP_BASE_PARAMS } from '@/tools/manageengine_sdp/shared-params'
import type { SdpCreateRequestParams, SdpResponse } from '@/tools/manageengine_sdp/types'
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

export const manageengineSdpCreateRequestTool: ToolConfig<SdpCreateRequestParams, SdpResponse> = {
  id: 'manageengine_sdp_create_request',
  name: 'ManageEngine SDP Create Request',
  description:
    'Create a request (ticket) in ManageEngine ServiceDesk Plus Cloud with a subject, description, requester and classification.',
  version: '1.0.0',

  oauth: { required: true, provider: 'manageengine-sdp' },

  params: {
    ...SDP_BASE_PARAMS,
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Request subject (maximum 250 characters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request description. HTML is supported',
    },
    requesterEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address of the requester. Defaults to the authenticated user',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority name, e.g. High',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Status name, e.g. Open',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category name',
    },
    subcategory: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Subcategory name',
    },
    group: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Support group name',
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
      description: 'Urgency name',
    },
    impact: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Impact name',
    },
    requestType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request type name, e.g. Incident or Service Request',
    },
    udfFields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Portal-defined custom fields, e.g. {"udf_char1":"value"}',
    },
  },

  request: {
    url: (params) => `${getSdpApiBase(params)}/requests`,
    method: 'POST',
    headers: (params) => buildSdpHeaders(params),
    body: (params) =>
      buildSdpInputDataBody(
        'request',
        compactSdpEntity({
          subject: orUndefined(params.subject),
          description: orUndefined(params.description),
          requester: toSdpUserReference(params.requesterEmail),
          technician: toSdpUserReference(params.technicianEmail),
          priority: toSdpNameReference(params.priority),
          status: toSdpNameReference(params.status),
          category: toSdpNameReference(params.category),
          subcategory: toSdpNameReference(params.subcategory),
          group: toSdpNameReference(params.group),
          urgency: toSdpNameReference(params.urgency),
          impact: toSdpNameReference(params.impact),
          request_type: toSdpNameReference(params.requestType),
          udf_fields: parseSdpJson(params.udfFields, 'custom fields'),
        })
      ),
  },

  transformResponse: async (response) => {
    const data = await parseSdpResponse(response, 'Failed to create request')
    return { success: true, output: { request: data.request ?? null } }
  },

  outputs: {
    request: {
      type: 'object',
      description: 'The created request',
      nullable: true,
      properties: SDP_REQUEST_PROPERTIES,
    },
  },
}
