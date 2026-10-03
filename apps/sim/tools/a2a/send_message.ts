import {
  applyProjectedModelVisibleFileNames,
  selectModelVisibleFileNames,
} from '@/lib/uploads/utils/model-input'
import {
  A2A_TASK_OUTPUTS,
  type A2ASendMessageParams,
  type A2ATaskResponse,
} from '@/tools/a2a/types'
import type { InternalToolConfig } from '@/tools/types'

export const a2aSendMessageTool: InternalToolConfig<A2ASendMessageParams, A2ATaskResponse> = {
  id: 'a2a_send_message',
  name: 'A2A Send Message',
  description: 'Send a message to an external A2A agent and return its response.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The A2A agent endpoint URL',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message text to send',
    },
    data: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional structured JSON data to attach',
    },
    files: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional files to attach',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing task ID to continue',
    },
    contextId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Conversation context ID to continue',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for authentication (if required)',
    },
  },

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => {
        const files = selectModelVisibleFileNames(params.files)
        return {
          message: params.message,
          data: params.data,
          ...(files === undefined ? {} : { files }),
        }
      },
      applyProjected: (selectedParams, projectedSelection) => ({
        message: projectedSelection.message,
        data: projectedSelection.data,
        ...(Object.hasOwn(projectedSelection, 'files')
          ? {
              files: applyProjectedModelVisibleFileNames(
                selectedParams.files,
                projectedSelection.files
              ),
            }
          : {}),
      }),
    },
    input: (params) => {
      const body: Record<string, unknown> = {
        agentUrl: params.agentUrl,
        message: params.message,
      }
      if (params.data !== undefined) body.data = params.data
      if (params.files) body.files = params.files
      if (params.taskId) body.taskId = params.taskId
      if (params.contextId) body.contextId = params.contextId
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => response.json(),

  outputs: A2A_TASK_OUTPUTS,
}
