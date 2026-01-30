import type {
  ContentBlock,
  ConverseStreamOutput,
  ImageFormat,
} from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@sim/logger'
import { trackForcedToolUsage } from '@/providers/utils'

const logger = createLogger('BedrockUtils')

/**
 * Converts message content (string or array) to Bedrock ContentBlock array.
 * Handles multimodal content including images and documents.
 */
export function convertToBedrockContentBlocks(content: string | any[]): ContentBlock[] {
  // Simple string content
  if (typeof content === 'string') {
    return [{ text: content || '' }]
  }

  // Array content - could be multimodal
  if (!Array.isArray(content)) {
    return [{ text: String(content) || '' }]
  }

  const blocks: ContentBlock[] = []

  for (const item of content) {
    if (!item) continue

    // Text content
    if (item.type === 'text' && item.text) {
      blocks.push({ text: item.text })
      continue
    }

    // Gemini-style text (just { text: "..." })
    if (typeof item.text === 'string' && !item.type) {
      blocks.push({ text: item.text })
      continue
    }

    // Bedrock image content (from agent handler)
    if (item.type === 'bedrock_image') {
      const imageBlock = createBedrockImageBlock(item)
      if (imageBlock) {
        blocks.push(imageBlock)
      }
      continue
    }

    // Bedrock document content (from agent handler)
    if (item.type === 'bedrock_document') {
      const docBlock = createBedrockDocumentBlock(item)
      if (docBlock) {
        blocks.push(docBlock)
      }
      continue
    }

    // OpenAI-style image_url (fallback for direct OpenAI format)
    if (item.type === 'image_url' && item.image_url) {
      const url = typeof item.image_url === 'string' ? item.image_url : item.image_url?.url
      if (url) {
        const imageBlock = createBedrockImageBlockFromUrl(url)
        if (imageBlock) {
          blocks.push(imageBlock)
        }
      }
      continue
    }

    // Unknown type - log warning and skip
    logger.warn('Unknown content block type in Bedrock conversion:', { type: item.type })
  }

  // Ensure at least one text block
  if (blocks.length === 0) {
    blocks.push({ text: '' })
  }

  return blocks
}

/**
 * Creates a Bedrock image ContentBlock from a bedrock_image item
 */
function createBedrockImageBlock(item: {
  format: string
  sourceType: string
  data?: string
  url?: string
}): ContentBlock | null {
  const format = (item.format || 'png') as ImageFormat

  if (item.sourceType === 'base64' && item.data) {
    // Convert base64 to Uint8Array
    const bytes = base64ToUint8Array(item.data)
    return {
      image: {
        format,
        source: { bytes },
      },
    }
  }

  if (item.sourceType === 'url' && item.url) {
    // For URLs, we need to fetch the image and convert to bytes
    // This is a limitation - Bedrock doesn't support URL sources directly
    // The provider layer should handle this, or we log a warning
    logger.warn('Bedrock does not support image URLs directly. Image will be skipped.', {
      url: item.url,
    })
    // Return a text placeholder
    return { text: `[Image from URL: ${item.url}]` }
  }

  return null
}

/**
 * Creates a Bedrock document ContentBlock from a bedrock_document item
 */
function createBedrockDocumentBlock(item: {
  format: string
  sourceType: string
  data?: string
  url?: string
}): ContentBlock | null {
  if (item.sourceType === 'base64' && item.data) {
    const bytes = base64ToUint8Array(item.data)
    return {
      document: {
        format: 'pdf',
        name: 'document',
        source: { bytes },
      },
    }
  }

  if (item.sourceType === 'url' && item.url) {
    logger.warn('Bedrock does not support document URLs directly. Document will be skipped.', {
      url: item.url,
    })
    return { text: `[Document from URL: ${item.url}]` }
  }

  return null
}

/**
 * Creates a Bedrock image ContentBlock from a data URL or regular URL
 */
function createBedrockImageBlockFromUrl(url: string): ContentBlock | null {
  // Check if it's a data URL (base64)
  if (url.startsWith('data:')) {
    const match = url.match(/^data:image\/(\w+);base64,(.+)$/)
    if (match) {
      let format: ImageFormat = match[1] as ImageFormat
      // Normalize jpg to jpeg
      if (format === ('jpg' as ImageFormat)) {
        format = 'jpeg'
      }
      const base64Data = match[2]
      const bytes = base64ToUint8Array(base64Data)
      return {
        image: {
          format,
          source: { bytes },
        },
      }
    }
  }

  // Regular URL - Bedrock doesn't support this directly
  logger.warn('Bedrock does not support image URLs directly. Image will be skipped.', { url })
  return { text: `[Image from URL: ${url}]` }
}

/**
 * Converts a base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Handle browser and Node.js environments
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(base64, 'base64')
  }
  // Browser fallback
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

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

export function generateToolUseId(toolName: string): string {
  return `${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
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
