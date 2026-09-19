import type {
  Message as BedrockMessage,
  ContentBlock,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { randomFloat } from '@sim/utils/random'
import type { AgentStreamEvent } from '@/providers/stream-events'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('BedrockUtils')

export interface BedrockStreamUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
}

/** Converse reports uncached input separately from cache reads and writes. */
export function toBedrockConversationUsage(usage: Partial<BedrockStreamUsage> | undefined) {
  return usage
    ? {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        ...(usage.cacheReadInputTokens ? { cacheRead: usage.cacheReadInputTokens } : {}),
        ...(usage.cacheWriteInputTokens ? { cacheWrite: usage.cacheWriteInputTokens } : {}),
      }
    : undefined
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
  onComplete?: (
    content: string,
    usage: BedrockStreamUsage,
    message: BedrockMessage
  ) => void | Promise<void>
): ReadableStream<AgentStreamEvent> {
  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadInputTokens: number | undefined
  let cacheWriteInputTokens: number | undefined
  let cancelled = false
  let streamIterator: AsyncIterator<ConverseStreamOutput> | undefined

  return new ReadableStream({
    async start(controller) {
      try {
        const contentByIndex = new Map<number, ContentBlock>()
        const reasoningByIndex = new Map<
          number,
          { text: string; signature: string; redacted: Uint8Array[] }
        >()
        streamIterator = bedrockStream[Symbol.asyncIterator]()
        while (true) {
          const next = await streamIterator.next()
          if (next.done || cancelled) break
          const event = next.value
          const streamError = getBedrockStreamError(event)
          if (streamError) throw streamError
          const delta = event.contentBlockDelta?.delta
          const index = event.contentBlockDelta?.contentBlockIndex ?? 0
          if (delta?.reasoningContent) {
            const reasoning = reasoningByIndex.get(index) ?? {
              text: '',
              signature: '',
              redacted: [],
            }
            reasoning.text += delta.reasoningContent.text ?? ''
            reasoning.signature += delta.reasoningContent.signature ?? ''
            if (delta.reasoningContent.redactedContent)
              reasoning.redacted.push(delta.reasoningContent.redactedContent)
            reasoningByIndex.set(index, reasoning)
          }
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text
            fullContent += text
            const previous = contentByIndex.get(index)
            contentByIndex.set(index, { text: (previous?.text ?? '') + text })
            controller.enqueue({ type: 'text_delta', text, turn: 'final' })
          } else if (event.metadata?.usage) {
            inputTokens = event.metadata.usage.inputTokens ?? 0
            outputTokens = event.metadata.usage.outputTokens ?? 0
            cacheReadInputTokens = event.metadata.usage.cacheReadInputTokens
            cacheWriteInputTokens = event.metadata.usage.cacheWriteInputTokens
          }
        }

        if (cancelled) return
        if (onComplete) {
          for (const [index, reasoning] of reasoningByIndex) {
            if (reasoning.redacted.length > 0) {
              const redactedContent = new Uint8Array(
                reasoning.redacted.reduce((size, chunk) => size + chunk.length, 0)
              )
              let offset = 0
              for (const chunk of reasoning.redacted) {
                redactedContent.set(chunk, offset)
                offset += chunk.length
              }
              contentByIndex.set(index, { reasoningContent: { redactedContent } })
            } else {
              contentByIndex.set(index, {
                reasoningContent: {
                  reasoningText: { text: reasoning.text, signature: reasoning.signature },
                },
              })
            }
          }
          await onComplete(
            fullContent,
            {
              inputTokens,
              outputTokens,
              ...(cacheReadInputTokens ? { cacheReadInputTokens } : {}),
              ...(cacheWriteInputTokens ? { cacheWriteInputTokens } : {}),
            },
            {
              role: 'assistant',
              content: [...contentByIndex.entries()]
                .sort(([left], [right]) => left - right)
                .map(([, block]) => block),
            }
          )
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
 * Catalog models with documented geographic inference profiles. Unknown model
 * IDs and caller-supplied inference profile IDs/ARNs must pass through unchanged.
 */
const GEO_PROFILE_MODEL_IDS = new Set([
  'anthropic.claude-opus-4-5-20251101-v1:0',
  'anthropic.claude-sonnet-4-5-20250929-v1:0',
  'anthropic.claude-haiku-4-5-20251001-v1:0',
  'anthropic.claude-opus-4-1-20250805-v1:0',
  'amazon.nova-2-lite-v1:0',
  'amazon.nova-premier-v1:0',
  'amazon.nova-pro-v1:0',
  'amazon.nova-lite-v1:0',
  'amazon.nova-micro-v1:0',
  'meta.llama4-maverick-17b-instruct-v1:0',
  'meta.llama4-scout-17b-instruct-v1:0',
  'meta.llama3-3-70b-instruct-v1:0',
  'meta.llama3-2-90b-instruct-v1:0',
  'meta.llama3-2-11b-instruct-v1:0',
  'meta.llama3-2-3b-instruct-v1:0',
  'meta.llama3-2-1b-instruct-v1:0',
  'meta.llama3-1-405b-instruct-v1:0',
  'meta.llama3-1-70b-instruct-v1:0',
  'meta.llama3-1-8b-instruct-v1:0',
  'mistral.pixtral-large-2502-v1:0',
])

/** Current Claude profiles use AU rather than the older APAC geography. */
const CLAUDE_GEO_PROFILE_MODEL_IDS = new Set([
  'anthropic.claude-opus-5',
  'anthropic.claude-sonnet-5',
  'anthropic.claude-opus-4-8',
  'anthropic.claude-opus-4-7',
  'anthropic.claude-opus-4-6-v1',
  'anthropic.claude-sonnet-4-6',
])

/** These models currently publish US and global inference profiles only. */
const US_GEO_PROFILE_MODEL_IDS = new Set([
  'anthropic.claude-fable-5',
  'openai.gpt-6-astra',
  'openai.gpt-5.6-sol',
  'openai.gpt-5.6-terra',
  'openai.gpt-5.6-luna',
])

/** Cross-region inference profile prefixes Bedrock prepends to a base model ID. */
const GEO_PROFILE_PREFIX_PATTERN = /^(us-gov|us|eu|apac|au|ca|jp|global)\./

/**
 * Strips Sim's `bedrock/` namespace and any cross-region inference prefix,
 * leaving the bare `<vendor>.<model>` ID that capability checks key off.
 */
export function getBedrockBaseModelId(modelId: string): string {
  const withoutNamespace = modelId.replace(/^bedrock\//i, '')
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
  const baseModelId = modelId.replace(/^bedrock\//i, '')

  if (GEO_PROFILE_PREFIX_PATTERN.test(baseModelId)) {
    return baseModelId
  }

  if (CLAUDE_GEO_PROFILE_MODEL_IDS.has(baseModelId)) {
    if ((region.startsWith('us-') && !region.startsWith('us-gov-')) || region.startsWith('ca-')) {
      return `us.${baseModelId}`
    }
    if (region.startsWith('eu-')) return `eu.${baseModelId}`
    if (region === 'ap-southeast-2' || region === 'ap-southeast-4') return `au.${baseModelId}`
    throw new Error(
      `No geographic inference profile is configured for ${baseModelId} in ${region}. ` +
        'Supply an explicit bedrock/global. model ID or an inference profile ARN.'
    )
  }

  if (US_GEO_PROFILE_MODEL_IDS.has(baseModelId)) {
    if (region.startsWith('us-') && !region.startsWith('us-gov-')) return `us.${baseModelId}`
    throw new Error(
      `${baseModelId} only has a US geographic inference profile. ` +
        'Supply an explicit bedrock/global. model ID to use global inference.'
    )
  }

  if (!GEO_PROFILE_MODEL_IDS.has(baseModelId)) {
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
