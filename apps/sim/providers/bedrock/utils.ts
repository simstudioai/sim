import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { randomFloat } from '@sim/utils/random'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('BedrockUtils')

export interface BedrockStreamUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * Converts an AWS event-stream exception member into an Error.
 */
export function getBedrockStreamError(event: ConverseStreamOutput): Error | undefined {
  const exception =
    event.internalServerException ??
    event.modelStreamErrorException ??
    event.validationException ??
    event.throttlingException ??
    event.serviceUnavailableException
  if (!exception) return undefined
  return new Error(exception.message || getErrorMessage(exception, 'Bedrock stream error'), {
    cause: exception,
  })
}

/**
 * Bedrock ConverseStream → agent-events-v1 for the legacy (non-tool-loop)
 * streaming path. Text deltas only: tools on this path are never executed, so
 * emitting `tool_call_start` here would leave a chip running forever with no
 * matching end. Sim does not request Bedrock reasoning, so there is no
 * thinking to forward either.
 */
export function createReadableStreamFromBedrockStream(
  bedrockStream: AsyncIterable<ConverseStreamOutput>,
  onComplete?: (content: string, usage: BedrockStreamUsage) => void
): ReadableStream<AgentStreamEvent> {
  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0
  let cancelled = false
  let streamIterator: AsyncIterator<ConverseStreamOutput> | undefined

  return new ReadableStream({
    async start(controller) {
      try {
        streamIterator = bedrockStream[Symbol.asyncIterator]()
        while (true) {
          const next = await streamIterator.next()
          if (next.done || cancelled) break
          const event = next.value
          const streamError = getBedrockStreamError(event)
          if (streamError) throw streamError
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text
            fullContent += text
            controller.enqueue({ type: 'text_delta', text, turn: 'final' })
          } else if (event.metadata?.usage) {
            inputTokens = event.metadata.usage.inputTokens ?? 0
            outputTokens = event.metadata.usage.outputTokens ?? 0
          }
        }

        if (cancelled) return
        if (onComplete) {
          onComplete(fullContent, { inputTokens, outputTokens })
        }

        controller.close()
      } catch (err) {
        if (!cancelled) {
          controller.error(err)
        }
      }
    },
    async cancel() {
      cancelled = true
      await streamIterator?.return?.()
    },
  })
}

export function checkForForcedToolUsage(
  toolUseBlocks: Array<{ name: string }>,
  toolChoice: any,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } | null {
  if (typeof toolChoice === 'object' && toolChoice !== null && toolUseBlocks.length > 0) {
    const adaptedToolCalls = toolUseBlocks.map((tool) => ({ name: tool.name }))
    const adaptedToolChoice = toolChoice.tool
      ? { function: { name: toolChoice.tool.name } }
      : toolChoice

    return trackForcedToolUsage(
      adaptedToolCalls,
      adaptedToolChoice,
      logger,
      'bedrock',
      forcedTools,
      usedForcedTools
    )
  }
  return null
}

/**
 * Generates a unique tool use ID for Bedrock.
 * AWS Bedrock requires toolUseId to be 1-64 characters, pattern [a-zA-Z0-9_-]+
 */
export function generateToolUseId(toolName: string): string {
  const timestamp = Date.now().toString(36) // Base36 timestamp (9 chars)
  const random = randomFloat().toString(36).substring(2, 7) // 5 random chars
  const suffix = `-${timestamp}-${random}` // ~15 chars
  const maxNameLength = 64 - suffix.length
  const truncatedName = toolName.substring(0, maxNameLength).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${truncatedName}${suffix}`
}

/**
 * Models whose AWS model cards state geo/cross-region inference profiles are
 * not supported ("Geo inference ID: Not supported"). These must be invoked
 * with the bare in-region model ID — prefixing them with a geo profile
 * (e.g. us.mistral...) produces an invalid model identifier.
 */
const GEO_PROFILE_UNSUPPORTED_MODEL_IDS = new Set([
  'mistral.mistral-large-3-675b-instruct',
  'mistral.mistral-large-2407-v1:0',
  'mistral.magistral-small-2509',
  'mistral.ministral-3-14b-instruct',
  'mistral.ministral-3-8b-instruct',
  'mistral.ministral-3-3b-instruct',
  'mistral.mixtral-8x7b-instruct-v0:1',
  'amazon.titan-text-premier-v1:0',
  'cohere.command-r-v1:0',
  'cohere.command-r-plus-v1:0',
])

/** Cross-region inference profile prefixes Bedrock prepends to a base model ID. */
const GEO_PROFILE_PREFIX_PATTERN = /^(us-gov|us|eu|apac|au|ca|jp|global)\./

/**
 * Strips Sim's `bedrock/` namespace and any cross-region inference prefix,
 * leaving the bare `<vendor>.<model>` ID that capability checks key off.
 */
function getBedrockBaseModelId(modelId: string): string {
  const withoutNamespace = modelId.startsWith('bedrock/') ? modelId.slice(8) : modelId
  return withoutNamespace.replace(GEO_PROFILE_PREFIX_PATTERN, '')
}

/**
 * Whether the model accepts `status` on a `toolResult` content block.
 *
 * Only Amazon Nova and Anthropic Claude 3/4 support it; Llama, Mistral, Cohere,
 * and Titan reject the whole request with
 * `ValidationException: This model doesn't support the status field.`
 *
 * Source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolResultBlock.html
 */
export function supportsToolResultStatus(modelId: string): boolean {
  const baseModelId = getBedrockBaseModelId(modelId)
  return baseModelId.startsWith('anthropic.') || baseModelId.startsWith('amazon.nova')
}

/**
 * Converts a model ID to the Bedrock inference profile format.
 * AWS Bedrock requires inference profile IDs (e.g., us.anthropic.claude-...)
 * for on-demand invocation of newer models, while some models only accept
 * the bare in-region model ID.
 *
 * @param modelId - The model ID (e.g., "bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0")
 * @param region - The AWS region (e.g., "us-east-1")
 * @returns The inference profile ID (e.g., "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
 */
export function getBedrockInferenceProfileId(modelId: string, region: string): string {
  const baseModelId = modelId.startsWith('bedrock/') ? modelId.slice(8) : modelId

  if (GEO_PROFILE_PREFIX_PATTERN.test(baseModelId)) {
    return baseModelId
  }

  if (GEO_PROFILE_UNSUPPORTED_MODEL_IDS.has(baseModelId)) {
    return baseModelId
  }

  let inferencePrefix: string
  if (region.startsWith('us-gov-')) {
    inferencePrefix = 'us-gov'
  } else if (region.startsWith('us-') || region.startsWith('ca-')) {
    inferencePrefix = 'us'
  } else if (region.startsWith('eu-') || region === 'il-central-1') {
    inferencePrefix = 'eu'
  } else if (region.startsWith('ap-') || region.startsWith('me-')) {
    inferencePrefix = 'apac'
  } else if (region.startsWith('sa-')) {
    inferencePrefix = 'us'
  } else if (region.startsWith('af-')) {
    inferencePrefix = 'eu'
  } else {
    inferencePrefix = 'us'
  }

  return `${inferencePrefix}.${baseModelId}`
}
