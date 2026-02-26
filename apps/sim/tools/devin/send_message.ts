import type { ToolConfig } from '@/tools/types'
import type { DevinSendMessageParams, DevinSendMessageResponse } from './types'
import { DEVIN_SESSION_OUTPUT_PROPERTIES } from './types'

export const devinSendMessageTool: ToolConfig<DevinSendMessageParams, DevinSendMessageResponse> = {
  id: 'devin_send_message',
  name: 'send_message',
  description:
    'Send a message to a Devin session. If the session is suspended, it will be automatically resumed. Returns the updated session state.',
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
      description: 'The session ID to send the message to',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message to send to Devin',
    },
  },

  request: {
    url: (params) => `https://api.devin.ai/v3/organizations/sessions/${params.sessionId}/messages`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      message: params.message,
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
