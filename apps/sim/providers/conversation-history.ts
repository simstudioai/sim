import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { getOllamaUrl } from '@/lib/core/utils/urls'
import type { ConversationProtocol, ConversationUsage } from '@/lib/memory/conversation-types'
import { getConversationPrefixHash } from '@/providers/conversation-prefix'
import { priceModelUsage, resolveModelCostPolicy } from '@/providers/cost-policy'
import { providerHistoryAdapters } from '@/providers/history-adapters'
import { getProviderRuntimeContext, type ProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderId, ProviderRequest, ProviderToolConfig } from '@/providers/types'

const requestContexts = new WeakMap<ProviderRequest, ProviderRuntimeContext>()
const logger = createLogger('ProviderConversationHistory')

export function bindConversationRequestContext(
  request: ProviderRequest,
  context: ProviderRuntimeContext
): void {
  requestContexts.set(request, context)
}

/** Bound requests retain their owner when stream callbacks outlive or cross an ambient context. */
export function getConversationRequestContext(
  request: ProviderRequest
): ProviderRuntimeContext | undefined {
  return requestContexts.get(request) ?? getProviderRuntimeContext()
}

export function isProviderConversationCaptureEnabled(request: ProviderRequest): boolean {
  return Boolean(getConversationRequestContext(request)?.agentConversation)
}

export function getConfiguredConversationToolBinding(tool: ProviderToolConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: tool.id,
        canonicalId: tool.canonicalId,
        params: tool.params,
        parameters: tool.parameters,
        blocked: tool.modelBlockedParams,
        usageControl: tool.usageControl,
        transform: tool.paramsTransform?.toString(),
        customInputs: tool.customBlockInputFields,
      })
    )
    .digest('hex')
}

/** Only the digest is retained; private continuation is bound to account, endpoint and request configuration. */
export function getConversationBinding(providerId: ProviderId, request: ProviderRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerId,
        model: request.model,
        endpoint:
          request.azureEndpoint ??
          (providerId === 'azure-openai' ? env.AZURE_OPENAI_ENDPOINT : undefined) ??
          (providerId === 'vllm'
            ? env.VLLM_BASE_URL
            : providerId === 'litellm'
              ? env.LITELLM_BASE_URL
              : providerId === 'ollama'
                ? getOllamaUrl()
                : undefined),
        apiVersion:
          request.azureApiVersion ??
          (providerId === 'azure-openai' ? env.AZURE_OPENAI_API_VERSION : undefined),
        systemPrompt: request.systemPrompt,
        systemMessages: request.messages?.filter((message) => message.role === 'system'),
        context: request.context,
        account: {
          apiKey: request.apiKey,
          accessKey: request.bedrockAccessKeyId,
          secretKey: request.bedrockSecretKey,
        },
        project: request.vertexProject,
        location: request.vertexLocation,
        region: request.bedrockRegion,
        tools: request.tools?.map(getConfiguredConversationToolBinding),
        responseFormat: request.responseFormat,
        reasoningEffort: request.reasoningEffort,
        thinkingLevel: request.thinkingLevel,
      })
    )
    .digest('hex')
}

/** Called with a complete provider message, including streaming terminal responses. */
export async function captureProviderConversationStep(
  request: ProviderRequest,
  protocol: ConversationProtocol,
  value: unknown,
  usage?: ConversationUsage,
  options?: { requestHistory?: readonly unknown[] }
): Promise<void> {
  const runtime = getConversationRequestContext(request)
  if (!runtime?.agentConversation || !runtime.conversationProvider) return
  try {
    const captured = providerHistoryAdapters[protocol].capture(value)
    await runtime.agentConversation.captureStep({
      ...captured,
      calls: captured.calls.map((call) => {
        const tool = request.tools?.find((candidate) => candidate.id === call.toolId)
        return {
          ...call,
          ...(tool ? { configuredToolBinding: getConfiguredConversationToolBinding(tool) } : {}),
        }
      }),
      native: {
        ...runtime.conversationProvider,
        protocol,
        model: request.model,
        value,
        ...(options?.requestHistory
          ? { prefixHash: getConversationPrefixHash(options.requestHistory) }
          : {}),
      },
      ...(usage
        ? {
            usage,
            cost: priceModelUsage(
              request.model,
              usage,
              resolveModelCostPolicy(request.model, request.isBYOK)
            ),
          }
        : {}),
    })
  } catch {
    logger.warn('Agent conversation capture unavailable')
  }
}

/** Validation failures outside tool execution still close their recorded tool call. */
export async function recordProviderConversationToolError(
  request: ProviderRequest,
  providerCallId: string | undefined,
  toolId: string,
  error: unknown
): Promise<void> {
  request.abortSignal?.throwIfAborted()
  try {
    await getConversationRequestContext(request)?.agentConversation?.recordToolError(
      providerCallId,
      toolId,
      getErrorMessage(error)
    )
  } catch {
    logger.warn('Agent tool error durability unavailable')
  }
}
