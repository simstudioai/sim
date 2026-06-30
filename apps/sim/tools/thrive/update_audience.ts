import type { ThriveAudienceResponse, ThriveUpdateAudienceParams } from '@/tools/thrive/types'
import { THRIVE_AUDIENCE_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const updateAudienceTool: ToolConfig<ThriveUpdateAudienceParams, ThriveAudienceResponse> = {
  id: 'thrive_update_audience',
  name: 'Thrive Update Audience',
  description: 'Update an audience in Thrive, optionally moving it to a new parent.',
  version: '1.0.0',

  params: {
    tenantId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive Tenant ID (used as the Basic auth username)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thrive API key (used as the Basic auth password)',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Region-specific API host',
    },
    audienceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The audience id or audience reference',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the audience (max 100 characters)',
    },
    reference: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The external reference for the audience (max 100 characters)',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The id of the parent audience/structure to move the audience to',
    },
  },

  request: {
    url: (params) =>
      `${getThriveBaseUrl(params.host, 'v1')}/audiences/${encodeURIComponent(params.audienceId)}`,
    method: 'PATCH',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.name) body.name = params.name
      if (params.reference) body.reference = params.reference
      if (params.parentId) body.parentId = params.parentId
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveAudienceResponse> => {
    const data = await parseThriveResponse(response, 'Failed to update audience')
    return { success: true, output: { audience: data ?? null } }
  },

  outputs: {
    audience: {
      type: 'object',
      description: 'The updated audience',
      properties: THRIVE_AUDIENCE_OUTPUT_PROPERTIES,
    },
  },
}
