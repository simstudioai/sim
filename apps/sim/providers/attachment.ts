/**
 * Centralized attachment content transformation for all providers.
 *
 * Strategy: Always normalize to base64 first, then create provider-specific formats.
 * This eliminates URL accessibility issues and simplifies provider handling.
 */

import { createLogger } from '@sim/logger'
import { bufferToBase64 } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { supportsVision } from '@/providers/models'
import type { ProviderId } from '@/providers/types'

const logger = createLogger('AttachmentTransformer')

/**
 * Generic message type for attachment transformation.
 */
interface TransformableMessage {
  role: string
  content: string | any[] | null
  attachment?: AttachmentContent
  [key: string]: any
}

/**
 * Attachment content (files, images, documents)
 */
export interface AttachmentContent {
  sourceType: 'url' | 'base64' | 'file'
  data: string
  mimeType?: string
  fileName?: string
}

/**
 * Normalized attachment data (always base64)
 */
interface NormalizedAttachment {
  base64: string
  mimeType: string
}

/**
 * Configuration for attachment transformation
 */
interface AttachmentTransformConfig {
  providerId: ProviderId
  model: string
}

/**
 * Checks if a model supports attachments (vision/multimodal content).
 */
export function modelSupportsAttachments(model: string): boolean {
  return supportsVision(model)
}

/**
 * Transforms messages with 'attachment' role into provider-compatible format.
 */
export async function transformAttachmentMessages<T extends TransformableMessage>(
  messages: T[],
  config: AttachmentTransformConfig
): Promise<T[]> {
  const { providerId, model } = config
  const supportsAttachments = modelSupportsAttachments(model)

  if (!supportsAttachments) {
    return transformAttachmentsToText(messages) as T[]
  }

  const result: T[] = []

  for (const msg of messages) {
    if (msg.role !== 'attachment') {
      result.push(msg)
      continue
    }

    const attachmentContent = await createProviderAttachmentContent(msg, providerId)
    if (!attachmentContent) {
      logger.warn('Could not create attachment content for message', { msg })
      continue
    }

    // Merge with previous user message or create new one
    const lastMessage = result[result.length - 1]
    if (lastMessage && lastMessage.role === 'user') {
      const existingContent = ensureContentArray(lastMessage, providerId)
      existingContent.push(attachmentContent)
      lastMessage.content = existingContent as any
    } else {
      result.push({
        role: 'user',
        content: [attachmentContent] as any,
      } as T)
    }
  }

  // Ensure all user messages have consistent content format
  return result.map((msg) => {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      return {
        ...msg,
        content: [createTextContent(msg.content, providerId)] as any,
      }
    }
    return msg
  })
}

/**
 * Transforms attachment messages to text placeholders for non-vision models
 */
function transformAttachmentsToText<T extends TransformableMessage>(messages: T[]): T[] {
  const result: T[] = []

  for (const msg of messages) {
    if (msg.role !== 'attachment') {
      result.push(msg)
      continue
    }

    const attachment = msg.attachment
    const mimeType = attachment?.mimeType || 'unknown type'
    const fileName = attachment?.fileName || 'file'

    const lastMessage = result[result.length - 1]
    if (lastMessage && lastMessage.role === 'user') {
      const currentContent = typeof lastMessage.content === 'string' ? lastMessage.content : ''
      lastMessage.content = `${currentContent}\n[Attached file: ${fileName} (${mimeType}) - Note: This model does not support file/image inputs]`
    } else {
      result.push({
        role: 'user',
        content: `[Attached file: ${fileName} (${mimeType}) - Note: This model does not support file/image inputs]`,
      } as T)
    }
  }

  return result
}

/**
 * Ensures a user message has content as an array for multimodal support
 */
function ensureContentArray(msg: TransformableMessage, providerId: ProviderId): any[] {
  if (Array.isArray(msg.content)) {
    return msg.content
  }
  if (typeof msg.content === 'string' && msg.content) {
    return [createTextContent(msg.content, providerId)]
  }
  return []
}

/**
 * Creates provider-specific text content block
 */
export function createTextContent(text: string, providerId: ProviderId): any {
  switch (providerId) {
    case 'google':
    case 'vertex':
      return { text }
    default:
      return { type: 'text', text }
  }
}

/**
 * Normalizes attachment data to base64.
 * Fetches URLs and converts to base64, extracts base64 from data URLs.
 */
async function normalizeToBase64(
  attachment: AttachmentContent
): Promise<NormalizedAttachment | null> {
  const { sourceType, data, mimeType } = attachment

  if (!data || !data.trim()) {
    logger.warn('Empty attachment data')
    return null
  }

  const trimmedData = data.trim()

  // Already base64
  if (sourceType === 'base64') {
    // Handle data URL format: data:mime;base64,xxx
    if (trimmedData.startsWith('data:')) {
      const match = trimmedData.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        return { base64: match[2], mimeType: match[1] }
      }
    }
    // Raw base64
    return { base64: trimmedData, mimeType: mimeType || 'application/octet-stream' }
  }

  // URL or file path - need to fetch
  if (sourceType === 'url' || sourceType === 'file') {
    try {
      logger.info('Fetching attachment for base64 conversion', {
        url: trimmedData.substring(0, 50),
      })
      const buffer = await downloadFileFromUrl(trimmedData)
      const base64 = bufferToBase64(buffer)
      return { base64, mimeType: mimeType || 'application/octet-stream' }
    } catch (error) {
      logger.error('Failed to fetch attachment', { error, url: trimmedData.substring(0, 50) })
      return null
    }
  }

  return null
}

/**
 * Creates provider-specific attachment content from an attachment message.
 * First normalizes to base64, then creates the provider format.
 */
async function createProviderAttachmentContent(
  msg: TransformableMessage,
  providerId: ProviderId
): Promise<any> {
  const attachment = msg.attachment
  if (!attachment) return null

  // Normalize to base64 first
  const normalized = await normalizeToBase64(attachment)
  if (!normalized) {
    return createTextContent('[Failed to load attachment]', providerId)
  }

  const { base64, mimeType } = normalized

  switch (providerId) {
    case 'anthropic':
      return createAnthropicContent(base64, mimeType)

    case 'google':
    case 'vertex':
      return createGeminiContent(base64, mimeType)

    case 'mistral':
      return createMistralContent(base64, mimeType)

    case 'bedrock':
      return createBedrockContent(base64, mimeType)

    default:
      // OpenAI format (OpenAI, Azure, xAI, DeepSeek, Cerebras, Groq, OpenRouter, Ollama, vLLM)
      return createOpenAIContent(base64, mimeType)
  }
}

/**
 * OpenAI-compatible content (images only via base64 data URL)
 */
function createOpenAIContent(base64: string, mimeType: string): any {
  const isImage = mimeType.startsWith('image/')
  const isAudio = mimeType.startsWith('audio/')

  if (isImage) {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64}`,
        detail: 'auto',
      },
    }
  }

  if (isAudio) {
    return {
      type: 'input_audio',
      input_audio: {
        data: base64,
        format: mimeType === 'audio/wav' ? 'wav' : 'mp3',
      },
    }
  }

  // OpenAI Chat API doesn't support other file types directly
  // For PDFs/docs, return a text placeholder
  logger.warn(`OpenAI does not support ${mimeType} attachments in Chat API`)
  return {
    type: 'text',
    text: `[Attached file: ${mimeType} - OpenAI Chat API only supports images and audio]`,
  }
}

/**
 * Anthropic-compatible content (images and PDFs)
 */
function createAnthropicContent(base64: string, mimeType: string): any {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'

  if (isImage) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: base64,
      },
    }
  }

  if (isPdf) {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64,
      },
    }
  }

  return {
    type: 'text',
    text: `[Attached file: ${mimeType} - Anthropic supports images and PDFs only]`,
  }
}

/**
 * Google Gemini-compatible content (inlineData format)
 */
function createGeminiContent(base64: string, mimeType: string): any {
  // Gemini supports a wide range of file types via inlineData
  return {
    inlineData: {
      mimeType,
      data: base64,
    },
  }
}

/**
 * Mistral-compatible content (images only, data URL format)
 */
function createMistralContent(base64: string, mimeType: string): any {
  const isImage = mimeType.startsWith('image/')

  if (isImage) {
    // Mistral uses direct string for image_url, not nested object
    return {
      type: 'image_url',
      image_url: `data:${mimeType};base64,${base64}`,
    }
  }

  return {
    type: 'text',
    text: `[Attached file: ${mimeType} - Mistral supports images only]`,
  }
}

/**
 * AWS Bedrock-compatible content (images and PDFs)
 */
function createBedrockContent(base64: string, mimeType: string): any {
  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'

  // Determine image format from mimeType
  const getImageFormat = (mime: string): string => {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpeg'
    if (mime.includes('png')) return 'png'
    if (mime.includes('gif')) return 'gif'
    if (mime.includes('webp')) return 'webp'
    return 'png'
  }

  if (isImage) {
    // Return a marker object that the Bedrock provider will convert to proper format
    return {
      type: 'bedrock_image',
      format: getImageFormat(mimeType),
      data: base64,
    }
  }

  if (isPdf) {
    return {
      type: 'bedrock_document',
      format: 'pdf',
      data: base64,
    }
  }

  return {
    type: 'text',
    text: `[Attached file: ${mimeType} - Bedrock supports images and PDFs only]`,
  }
}
