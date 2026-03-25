import type { OpenCodePromptParams, OpenCodePromptResponse } from '@/tools/opencode/types'
import type { ToolConfig } from '@/tools/types'

export const openCodePromptTool: ToolConfig<OpenCodePromptParams, OpenCodePromptResponse> = {
  id: 'opencode_prompt',
  name: 'OpenCode Prompt',
  description:
    'Create or continue an OpenCode thread for the authenticated workflow caller and send a prompt.',
  version: '1.0.0',

  params: {
    repository: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Repository configured for this workflow.',
    },
    systemPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'System prompt used for the OpenCode assistant.',
    },
    providerId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LLM provider identifier configured in OpenCode.',
    },
    modelId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Model identifier configured in OpenCode.',
    },
    agent: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional OpenCode agent preset name.',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Prompt to send to the configured OpenCode assistant.',
    },
    newThread: {
      type: 'boolean',
      required: false,
      default: false,
      visibility: 'user-or-llm',
      description: 'Create a new thread instead of reusing the current caller thread.',
    },
  },

  request: {
    url: '/api/tools/opencode/prompt',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      repository: params.repository,
      systemPrompt: params.systemPrompt,
      providerId: params.providerId,
      modelId: params.modelId,
      agent: params.agent,
      prompt: params.prompt,
      newThread: params.newThread,
      _context: params._context,
    }),
  },

  outputs: {
    content: { type: 'string', description: 'Assistant text returned by OpenCode' },
    threadId: { type: 'string', description: 'OpenCode thread identifier used for this response' },
    cost: {
      type: 'number',
      description: 'Estimated cost returned by OpenCode for the assistant message',
      optional: true,
    },
    error: {
      type: 'string',
      description: 'Error message if the OpenCode request failed',
      optional: true,
    },
  },
}
