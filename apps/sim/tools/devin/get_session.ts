import type { ToolConfig } from '@/tools/types'
import type { DevinGetSessionParams, DevinGetSessionResponse } from './types'
import { DEVIN_SESSION_OUTPUT_PROPERTIES } from './types'

export const devinGetSessionTool: ToolConfig<DevinGetSessionParams, DevinGetSessionResponse> = {
  id: 'devin_get_session',
  name: 'get_session',
  description:
    'Retrieve details of an existing Devin session including status, tags, pull requests, and structured output.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin API key (service user credential starting with cog_)',
    },
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The session ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.devin.ai/v3/organizations/sessions/${params.sessionId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        sessionId: data.session_id ?? null,
        url: data.url ?? null,
        status: data.status ?? null,
        statusDetail: data.status_detail ?? null,
        title: data.title ?? null,
        createdAt: data.created_at ?? null,
        updatedAt: data.updated_at ?? null,
        acusConsumed: data.acus_consumed ?? null,
        tags: data.tags ?? null,
        pullRequests: data.pull_requests ?? null,
        structuredOutput: data.structured_output ?? null,
        playbookId: data.playbook_id ?? null,
      },
    }
  },

  outputs: {
    sessionId: DEVIN_SESSION_OUTPUT_PROPERTIES.sessionId,
    url: DEVIN_SESSION_OUTPUT_PROPERTIES.url,
    status: DEVIN_SESSION_OUTPUT_PROPERTIES.status,
    statusDetail: DEVIN_SESSION_OUTPUT_PROPERTIES.statusDetail,
    title: DEVIN_SESSION_OUTPUT_PROPERTIES.title,
    createdAt: DEVIN_SESSION_OUTPUT_PROPERTIES.createdAt,
    updatedAt: DEVIN_SESSION_OUTPUT_PROPERTIES.updatedAt,
    acusConsumed: DEVIN_SESSION_OUTPUT_PROPERTIES.acusConsumed,
    tags: DEVIN_SESSION_OUTPUT_PROPERTIES.tags,
    pullRequests: DEVIN_SESSION_OUTPUT_PROPERTIES.pullRequests,
    structuredOutput: DEVIN_SESSION_OUTPUT_PROPERTIES.structuredOutput,
    playbookId: DEVIN_SESSION_OUTPUT_PROPERTIES.playbookId,
  },
}
