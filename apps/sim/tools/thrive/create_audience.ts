import type { ThriveAudienceResponse, ThriveCreateAudienceParams } from '@/tools/thrive/types'
import { THRIVE_AUDIENCE_OUTPUT_PROPERTIES } from '@/tools/thrive/types'
import { getThriveBaseUrl, getThriveHeaders, parseThriveResponse } from '@/tools/thrive/utils'
import type { ToolConfig } from '@/tools/types'

export const createAudienceTool: ToolConfig<ThriveCreateAudienceParams, ThriveAudienceResponse> = {
  id: 'thrive_create_audience',
  name: 'Thrive Create Audience',
  description: 'Create a new audience or structure in Thrive.',
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
      description:
        'The id or reference of the parent audience/structure; leave blank for a parent audience/structure',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The audience category: 'audience' or 'structure'",
    },
  },

  request: {
    url: (params) => `${getThriveBaseUrl(params.host, 'v1')}/audiences`,
    method: 'POST',
    headers: (params) => getThriveHeaders(params.tenantId, params.apiKey),
    body: (params) => {
      const body: Record<string, any> = {}
      if (params.name) body.name = params.name
      if (params.reference) body.reference = params.reference
      if (params.parentId) body.parentId = params.parentId
      if (params.category) body.category = params.category
      return body
    },
  },

  transformResponse: async (response: Response): Promise<ThriveAudienceResponse> => {
    const data = await parseThriveResponse(response, 'Failed to create audience')
    return { success: true, output: { audience: data ?? null } }
  },

  outputs: {
    audience: {
      type: 'object',
      description: 'The created audience',
      properties: THRIVE_AUDIENCE_OUTPUT_PROPERTIES,
    },
  },
}
