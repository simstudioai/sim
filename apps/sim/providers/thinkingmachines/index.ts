import { createLogger } from '@sim/logger'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { StreamingExecution } from '@/executor/types'
import {
  getProviderDefaultModel,
  getProviderModels,
  supportsForcedToolUse,
} from '@/providers/models'
import {
  type ChatCompletionPayload,
  executeChatCompletionRequest,
} from '@/providers/openai-compat/chat-completions'
import { openAICompatTransport } from '@/providers/transport'
import type { ProviderConfig, ProviderRequest, ProviderResponse } from '@/providers/types'
import { generateSchemaInstructions } from '@/providers/utils'

const logger = createLogger('ThinkingMachinesProvider')

const TINKER_BASE_URL = 'https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1'

/** Catalog ids mapped to the base model ids Tinker's OpenAI-compatible endpoint samples. */
const TINKER_MODELS: Record<string, string> = {
  'thinkingmachines/inkling': 'thinkingmachines/Inkling',
  'thinkingmachines/inkling-small': 'thinkingmachines/Inkling-Small',
  'thinkingmachines/inkling-2-small': 'thinkingmachines/Inkling-2-Small',
}

/**
 * Resolves the id sent to Tinker. Catalog models map to Tinker's base id; a
 * `thinkingmachines/tinker://…` id samples a user's own Tinker checkpoint.
 */
function resolveTinkerModel(model: string): string {
  const tinkerModel = TINKER_MODELS[model.toLowerCase()]
  if (tinkerModel) return tinkerModel
  const remainder = model.replace(/^thinkingmachines\//i, '')
  return remainder.startsWith('tinker://') ? remainder : model
}

/** Tinker documents no response_format support, so schemas travel as prompt instructions. */
async function applyResponseFormat(
  _payload: ChatCompletionPayload,
  messages: ChatCompletionMessageParam[],
  responseFormat: NonNullable<ProviderRequest['responseFormat']>
): Promise<ChatCompletionMessageParam[]> {
  return [
    ...messages,
    {
      role: 'user',
      content: generateSchemaInstructions(responseFormat.schema, responseFormat.name),
    },
  ]
}

export const thinkingMachinesProvider: ProviderConfig = {
  id: 'thinkingmachines',
  name: 'Thinking Machines',
  description: 'Inkling models via Tinker serverless inference',
  version: '1.0.0',
  models: getProviderModels('thinkingmachines'),
  defaultModel: getProviderDefaultModel('thinkingmachines'),
  executeRequest: async (
    request: ProviderRequest
  ): Promise<ProviderResponse | StreamingExecution> => {
    if (!request.apiKey) throw new Error('API key is required for Thinking Machines')
    const client = new OpenAI({
      ...openAICompatTransport(),
      apiKey: request.apiKey,
      baseURL: TINKER_BASE_URL,
    })
    const tools = supportsForcedToolUse(request.model)
      ? request.tools
      : request.tools?.map((tool) =>
          tool.usageControl === 'force' ? { ...tool, usageControl: 'auto' as const } : tool
        )
    return executeChatCompletionRequest(
      { ...request, tools },
      {
        providerId: 'thinkingmachines',
        providerName: 'Thinking Machines',
        client,
        requestedModel: resolveTinkerModel(request.model),
        reportedModel: request.model,
        logger,
        applyResponseFormat,
        reasoningFields: ['reasoning_content'],
        recordPendingUsage: true,
      }
    )
  },
}
