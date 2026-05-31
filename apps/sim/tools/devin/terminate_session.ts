import type { ToolConfig } from '@/tools/types'
import type { DevinTerminateSessionParams, DevinTerminateSessionResponse } from './types'
import { DEVIN_SESSION_OUTPUT_PROPERTIES } from './types'

export const devinTerminateSessionTool: ToolConfig<
  DevinTerminateSessionParams,
  DevinTerminateSessionResponse
> = {
  id: 'devin_terminate_session',
  name: 'terminate_session',
  description:
    'Terminate a Devin session. Optionally archive the session instead of permanently terminating it.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin API key (service user credential starting with cog_)',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin organization ID (prefixed with org-)',
    },
    sessionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The session ID to terminate',
    },
    archive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Archive the session instead of permanently terminating it (default: false)',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.archive) searchParams.set('archive', 'true')
      const qs = searchParams.toString()
      return `https://api.devin.ai/v3/organizations/${params.orgId.trim()}/sessions/${params.sessionId.trim()}${qs ? `?${qs}` : ''}`
    },
    method: 'DELETE',
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
        tags: data.tags ?? [],
        pullRequests: data.pull_requests ?? [],
        structuredOutput: data.structured_output ?? null,
        playbookId: data.playbook_id ?? null,
        isArchived: data.is_archived ?? false,
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
    isArchived: DEVIN_SESSION_OUTPUT_PROPERTIES.isArchived,
  },
}
