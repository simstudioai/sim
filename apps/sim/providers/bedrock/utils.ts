import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@sim/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('BedrockUtils')

export interface BedrockStreamUsage {
  inputTokens: number
  outputTokens: number
}

export function createReadableStreamFromBedrockStream(
  bedrockStream: AsyncIterable<ConverseStreamOutput>,
  onComplete?: (content: string, usage: BedrockStreamUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of bedrockStream) {
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text
            fullContent += text
            controller.enqueue(new TextEncoder().encode(text))
          } else if (event.metadata?.usage) {
            inputTokens = event.metadata.usage.inputTokens ?? 0
            outputTokens = event.metadata.usage.outputTokens ?? 0
          }
        }

        if (onComplete) {
          onComplete(fullContent, { inputTokens, outputTokens })
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
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
  const random = Math.random().toString(36).substring(2, 7) // 5 random chars
  const suffix = `-${timestamp}-${random}` // ~15 chars
  const maxNameLength = 64 - suffix.length
  const truncatedName = toolName.substring(0, maxNameLength).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${truncatedName}${suffix}`
}

/**
 * Converts a model ID to the Bedrock inference profile format.
 * AWS Bedrock requires inference profile IDs (e.g., us.anthropic.claude-...)
 * for on-demand invocation of newer models.
 *
 * @param modelId - The model ID (e.g., "bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0")
 * @param region - The AWS region (e.g., "us-east-1")
 * @returns The inference profile ID (e.g., "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
 */
export function getBedrockInferenceProfileId(modelId: string, region: string): string {
  const baseModelId = modelId.startsWith('bedrock/') ? modelId.slice(8) : modelId

  if (/^(us-gov|us|eu|apac|au|ca|jp|global)\./.test(baseModelId)) {
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
