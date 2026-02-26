import type { ToolConfig } from '@/tools/types'
import type { DevinCreateSessionParams, DevinCreateSessionResponse } from './types'
import { DEVIN_SESSION_OUTPUT_PROPERTIES } from './types'

export const devinCreateSessionTool: ToolConfig<
  DevinCreateSessionParams,
  DevinCreateSessionResponse
> = {
  id: 'devin_create_session',
  name: 'create_session',
  description:
    'Create a new Devin session with a prompt. Devin will autonomously work on the task described in the prompt.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Devin API key (service user credential starting with cog_)',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The task prompt for Devin to work on',
    },
    playbookId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional playbook ID to guide the session',
    },
    maxAcuLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum ACU limit for the session',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags for the session',
    },
  },

  request: {
    url: 'https://api.devin.ai/v3/organizations/sessions',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        prompt: params.prompt,
      }
      if (params.playbookId) body.playbook_id = params.playbookId
      if (params.maxAcuLimit != null) {
        body.max_acu_limit = params.maxAcuLimit
      }
      if (params.tags) {
        body.tags = params.tags.split(',').map((t: string) => t.trim())
      }
      return body
    },
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
