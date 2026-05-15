import type Anthropic from '@anthropic-ai/sdk'
import type { ContentBlock } from '@aws-sdk/client-bedrock-runtime'
import type { Part } from '@google/genai'
import type OpenAI from 'openai'
import {
  getContentType,
  getExtensionFromMimeType,
  getFileExtension,
  getMimeTypeFromExtension,
  MIME_TYPE_MAPPING,
  MODEL_SUPPORTED_IMAGE_MIME_TYPES,
} from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type { ProviderId } from '@/providers/types'

export type AttachmentProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'bedrock'
  | 'openrouter'
  | 'mistral'
  | 'groq'
  | 'fireworks'
  | 'ollama'
  | 'vllm'
  | 'xai'
  | 'deepseek'
  | 'cerebras'

export interface PreparedProviderAttachment {
  file: UserFile
  filename: string
  mimeType: string
  providerMimeType: string
  base64: string
  dataUrl: string
  text?: string
  extension: string
  contentType: 'image' | 'document' | 'audio' | 'video'
}

type ProviderMessageInput = {
  role: string
  content?: string | null
  files?: UserFile[]
}

type ProviderFormattedMessage = {
  role: string
  content?: string | null | Array<Record<string, unknown>>
  files?: UserFile[]
  [key: string]: unknown
}

export const AGENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const PDF_MIME_TYPE = 'application/pdf'

const DOCUMENT_MIME_TYPES = new Set(
  Object.entries(MIME_TYPE_MAPPING)
    .filter(([, contentType]) => contentType === 'document')
    .map(([mimeType]) => mimeType)
)

const OPENAI_DOCUMENT_MIME_TYPES = new Set([...DOCUMENT_MIME_TYPES, 'application/x-yaml'])

const GEMINI_INLINE_MIME_TYPES = new Set([...Object.keys(MIME_TYPE_MAPPING), 'application/x-yaml'])

const BEDROCK_DOCUMENT_FORMATS = new Set([
  'pdf',
  'csv',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'html',
  'txt',
  'md',
])
const BEDROCK_IMAGE_FORMATS = new Set(['png', 'jpeg', 'jpg', 'gif', 'webp'])
const BEDROCK_VIDEO_FORMATS = new Set(['mp4', 'mov', 'mkv', 'webm'])

const UNSUPPORTED_FILE_PROVIDERS = new Set<AttachmentProvider>(['deepseek', 'cerebras'])

const PROVIDER_SUPPORTED_LABELS: Record<AttachmentProvider, string> = {
  openai: 'images and documents through the Responses API input_image/input_file parts',
  anthropic: 'images, PDFs, and text documents through Claude content blocks',
  google: 'images, audio, video, PDFs, and text documents through Gemini inlineData',
  bedrock: 'Bedrock Converse image, document, and video content blocks',
  openrouter: 'images and PDFs through OpenRouter multimodal message parts',
  mistral: 'images through image_url message parts',
  groq: 'images through image_url message parts on multimodal models',
  fireworks: 'images through image_url message parts on vision models',
  ollama: 'images through image_url message parts on vision models',
  vllm: 'images through image_url message parts on multimodal models',
  xai: 'images through image_url message parts on Grok vision models',
  deepseek: 'no file attachments in the current API adapter',
  cerebras: 'no file attachments in the current API adapter',
}

export function getAttachmentProvider(providerId: ProviderId | string): AttachmentProvider | null {
  if (providerId === 'openai' || providerId === 'azure-openai') return 'openai'
  if (providerId === 'anthropic' || providerId === 'azure-anthropic') return 'anthropic'
  if (providerId === 'google' || providerId === 'vertex') return 'google'
  if (providerId === 'bedrock') return 'bedrock'
  if (providerId === 'openrouter') return 'openrouter'
  if (providerId === 'mistral') return 'mistral'
  if (providerId === 'groq') return 'groq'
  if (providerId === 'fireworks') return 'fireworks'
  if (providerId === 'ollama') return 'ollama'
  if (providerId === 'vllm') return 'vllm'
  if (providerId === 'xai') return 'xai'
  if (providerId === 'deepseek') return 'deepseek'
  if (providerId === 'cerebras') return 'cerebras'
  return null
}

export function supportsFileAttachments(providerId: ProviderId | string): boolean {
  const provider = getAttachmentProvider(providerId)
  return Boolean(provider && !UNSUPPORTED_FILE_PROVIDERS.has(provider))
}

export function getProviderAttachmentMaxBytes(_providerId: ProviderId | string): number {
  return AGENT_ATTACHMENT_MAX_BYTES
}

export function inferAttachmentMimeType(file: UserFile): string {
  const explicitType = file.type?.trim().toLowerCase()
  if (explicitType && explicitType !== 'application/octet-stream') {
    return explicitType
  }

  const inferred = getMimeTypeFromExtension(getFileExtension(file.name))
  return inferred.toLowerCase()
}

function isTextDocumentMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
  )
}

function isImageMimeType(mimeType: string): boolean {
  return MODEL_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)
}

function isOpenAIDocumentMimeType(mimeType: string): boolean {
  return OPENAI_DOCUMENT_MIME_TYPES.has(mimeType) || isTextDocumentMimeType(mimeType)
}

function getAttachmentContentType(
  mimeType: string
): PreparedProviderAttachment['contentType'] | null {
  return getContentType(mimeType) || (isTextDocumentMimeType(mimeType) ? 'document' : null)
}

function sniffImageMimeType(base64: string): string {
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return ''
  }

  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).equals(Buffer.from('GIF87a')) ||
      bytes.subarray(0, 6).equals(Buffer.from('GIF89a')))
  ) {
    return 'image/gif'
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    bytes.subarray(8, 12).equals(Buffer.from('WEBP'))
  ) {
    return 'image/webp'
  }

  return ''
}

function getAttachmentExtension(file: UserFile, mimeType: string): string {
  if (mimeType === 'text/markdown') return 'md'
  return getExtensionFromMimeType(mimeType) || getFileExtension(file.name)
}

function normalizeProviderMimeType(mimeType: string, provider: AttachmentProvider): string {
  if ((provider === 'anthropic' || provider === 'google') && isTextDocumentMimeType(mimeType)) {
    return 'text/plain'
  }
  return mimeType
}

function decodeBase64Text(base64: string, filename: string): string {
  try {
    return Buffer.from(base64, 'base64').toString('utf8')
  } catch {
    throw new Error(`File "${filename}" could not be decoded as UTF-8 text`)
  }
}

function toDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`
}

function isMimeTypeSupportedByProvider(
  provider: AttachmentProvider,
  mimeType: string,
  contentType: PreparedProviderAttachment['contentType'],
  extension: string
): boolean {
  switch (provider) {
    case 'openai':
      return isImageMimeType(mimeType) || isOpenAIDocumentMimeType(mimeType)
    case 'anthropic':
      return (
        isImageMimeType(mimeType) || mimeType === PDF_MIME_TYPE || isTextDocumentMimeType(mimeType)
      )
    case 'google':
      return GEMINI_INLINE_MIME_TYPES.has(mimeType) || isTextDocumentMimeType(mimeType)
    case 'bedrock':
      return (
        (contentType === 'image' && BEDROCK_IMAGE_FORMATS.has(extension)) ||
        (contentType === 'document' && BEDROCK_DOCUMENT_FORMATS.has(extension)) ||
        (contentType === 'video' && BEDROCK_VIDEO_FORMATS.has(extension))
      )
    case 'openrouter':
      return isImageMimeType(mimeType) || mimeType === PDF_MIME_TYPE
    case 'mistral':
    case 'groq':
    case 'fireworks':
    case 'ollama':
    case 'vllm':
    case 'xai':
      return isImageMimeType(mimeType)
    case 'deepseek':
    case 'cerebras':
      return false
    default: {
      const _exhaustive: never = provider
      return _exhaustive
    }
  }
}

function validateProviderSupport(
  attachment: Omit<PreparedProviderAttachment, 'providerMimeType' | 'dataUrl' | 'text'>,
  provider: AttachmentProvider,
  providerId: ProviderId | string
) {
  const { filename, mimeType, contentType, extension } = attachment
  const supportedLabel = PROVIDER_SUPPORTED_LABELS[provider]

  const supported = isMimeTypeSupportedByProvider(provider, mimeType, contentType, extension)

  if (!supported) {
    throw new Error(
      `File "${filename}" has MIME type "${mimeType}", which is not supported by provider "${providerId}". Supported attachments: ${supportedLabel}.`
    )
  }
}

export function prepareProviderAttachments(
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): PreparedProviderAttachment[] {
  if (!files || files.length === 0) return []

  const provider = getAttachmentProvider(providerId)
  if (!provider) {
    throw new Error(`File attachments are not supported for provider "${providerId}"`)
  }

  if (UNSUPPORTED_FILE_PROVIDERS.has(provider)) {
    throw new Error(
      `File attachments are not supported for provider "${providerId}" in the current adapter. Supported attachments: ${PROVIDER_SUPPORTED_LABELS[provider]}.`
    )
  }

  return files.map((file) => {
    const declaredMimeType = inferAttachmentMimeType(file)
    const contentType = getAttachmentContentType(declaredMimeType)

    if (!contentType) {
      throw new Error(
        `File "${file.name}" has MIME type "${declaredMimeType}", which is not supported by provider "${providerId}". Supported attachments: ${PROVIDER_SUPPORTED_LABELS[provider]}.`
      )
    }

    if (Number.isFinite(file.size) && file.size > AGENT_ATTACHMENT_MAX_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2)
      const maxMB = (AGENT_ATTACHMENT_MAX_BYTES / (1024 * 1024)).toFixed(0)
      throw new Error(
        `File "${file.name}" (${sizeMB}MB) exceeds the ${maxMB}MB agent attachment limit for provider "${providerId}"`
      )
    }

    if (!file.base64) {
      throw new Error(`File "${file.name}" could not be read for provider "${providerId}"`)
    }

    const sniffedImageMimeType = contentType === 'image' ? sniffImageMimeType(file.base64) : ''
    if (contentType === 'image' && !sniffedImageMimeType) {
      throw new Error(
        `Image bytes in "${file.name}" are not a supported model image format (declared MIME type "${declaredMimeType}"). Supported image formats: image/jpeg, image/png, image/gif, image/webp.`
      )
    }

    const mimeType = sniffedImageMimeType || declaredMimeType
    const extension = getAttachmentExtension(file, mimeType)
    const attachment = {
      file,
      filename: file.name,
      mimeType,
      base64: file.base64,
      extension,
      contentType,
    }

    validateProviderSupport(attachment, provider, providerId)

    const providerMimeType = normalizeProviderMimeType(mimeType, provider)
    return {
      ...attachment,
      providerMimeType,
      dataUrl: toDataUrl(providerMimeType, file.base64),
      ...(isTextDocumentMimeType(mimeType) && {
        text: decodeBase64Text(file.base64, file.name),
      }),
    }
  })
}

type OpenAIResponsesInputContent = OpenAI.Responses.ResponseInputContent
type OpenAIChatContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart
type AnthropicImageMediaType = Anthropic.Messages.Base64ImageSource['media_type']

export function buildOpenAIMessageContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): string | OpenAIResponsesInputContent[] {
  const attachments = prepareProviderAttachments(files, providerId)
  if (attachments.length === 0) return content ?? ''

  const parts: OpenAIResponsesInputContent[] = []
  if (content) {
    parts.push({ type: 'input_text', text: content } satisfies OpenAI.Responses.ResponseInputText)
  }

  for (const attachment of attachments) {
    if (attachment.contentType === 'image') {
      parts.push({
        type: 'input_image',
        image_url: attachment.dataUrl,
        detail: 'auto',
      } satisfies OpenAI.Responses.ResponseInputImage)
    } else {
      parts.push({
        type: 'input_file',
        filename: attachment.filename,
        file_data: attachment.dataUrl,
      } satisfies OpenAI.Responses.ResponseInputFile)
    }
  }

  return parts
}

export function buildAnthropicMessageContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): Anthropic.Messages.ContentBlockParam[] {
  const parts: Anthropic.Messages.ContentBlockParam[] = []
  if (content) {
    parts.push({ type: 'text', text: content } satisfies Anthropic.Messages.TextBlockParam)
  }

  for (const attachment of prepareProviderAttachments(files, providerId)) {
    if (attachment.contentType === 'image') {
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.providerMimeType as AnthropicImageMediaType,
          data: attachment.base64,
        },
      } satisfies Anthropic.Messages.ImageBlockParam)
    } else if (attachment.text) {
      parts.push({
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',
          data: attachment.text,
        },
        title: attachment.filename,
      } satisfies Anthropic.Messages.DocumentBlockParam)
    } else {
      parts.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: attachment.base64,
        },
        title: attachment.filename,
      } satisfies Anthropic.Messages.DocumentBlockParam)
    }
  }

  return parts
}

export function buildGeminiMessageParts(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): Part[] {
  const parts: Part[] = []
  if (content) {
    parts.push({ text: content } satisfies Part)
  }

  for (const attachment of prepareProviderAttachments(files, providerId)) {
    parts.push({
      inlineData: {
        mimeType: attachment.providerMimeType,
        data: attachment.base64,
      },
    } satisfies Part)
  }

  return parts
}

export function buildOpenAICompatibleChatContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): string | OpenAIChatContentPart[] {
  const attachments = prepareProviderAttachments(files, providerId)
  if (attachments.length === 0) return content ?? ''

  const parts: OpenAIChatContentPart[] = []
  if (content) {
    parts.push({
      type: 'text',
      text: content,
    } satisfies OpenAI.Chat.Completions.ChatCompletionContentPartText)
  }

  for (const attachment of attachments) {
    parts.push({
      type: 'image_url',
      image_url: {
        url: attachment.dataUrl,
      },
    } satisfies OpenAI.Chat.Completions.ChatCompletionContentPartImage)
  }

  return parts
}

export function buildOpenRouterMessageContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): string | OpenAIChatContentPart[] {
  const attachments = prepareProviderAttachments(files, providerId)
  if (attachments.length === 0) return content ?? ''

  const parts: OpenAIChatContentPart[] = []
  if (content) {
    parts.push({
      type: 'text',
      text: content,
    } satisfies OpenAI.Chat.Completions.ChatCompletionContentPartText)
  }

  for (const attachment of attachments) {
    if (attachment.contentType === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: attachment.dataUrl },
      } satisfies OpenAI.Chat.Completions.ChatCompletionContentPartImage)
    } else {
      parts.push({
        type: 'file',
        file: {
          filename: attachment.filename,
          file_data: attachment.dataUrl,
        },
      } satisfies OpenAI.Chat.Completions.ChatCompletionContentPart.File)
    }
  }

  return parts
}

function sanitizeBedrockName(filename: string): string {
  const baseName = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9\s()[\]-]/g, ' ')
  const compacted = baseName.replace(/\s+/g, ' ').trim()
  return compacted || 'Document'
}

function getBedrockDocumentFormat(attachment: PreparedProviderAttachment): string {
  if (attachment.extension === 'md' || attachment.mimeType === 'text/markdown') return 'md'
  if (attachment.extension === 'txt' || attachment.mimeType === 'text/plain') return 'txt'
  return attachment.extension || 'txt'
}

function getBedrockImageFormat(attachment: PreparedProviderAttachment): string {
  return attachment.extension === 'jpg' ? 'jpeg' : attachment.extension
}

export function buildBedrockMessageContent(
  content: string | null | undefined,
  files: UserFile[] | undefined,
  providerId: ProviderId | string
): ContentBlock[] {
  const parts: ContentBlock[] = []
  if (content) {
    parts.push({ text: content } as ContentBlock.TextMember)
  }

  for (const attachment of prepareProviderAttachments(files, providerId)) {
    const bytes = Buffer.from(attachment.base64, 'base64')
    if (attachment.contentType === 'image') {
      parts.push({
        image: {
          format: getBedrockImageFormat(attachment) as ContentBlock.ImageMember['image']['format'],
          source: { bytes },
        },
      } as ContentBlock.ImageMember)
    } else if (attachment.contentType === 'video') {
      parts.push({
        video: {
          format: attachment.extension as ContentBlock.VideoMember['video']['format'],
          source: { bytes },
        },
      } as ContentBlock.VideoMember)
    } else {
      parts.push({
        document: {
          format: getBedrockDocumentFormat(
            attachment
          ) as ContentBlock.DocumentMember['document']['format'],
          name: sanitizeBedrockName(attachment.filename),
          source: { bytes },
        },
      } as ContentBlock.DocumentMember)
    }
  }

  return parts
}

const SDK_NATIVE_ATTACHMENT_PROVIDERS = new Set<AttachmentProvider>([
  'openai',
  'anthropic',
  'google',
  'bedrock',
])

export function formatMessagesForProvider(
  messages: ProviderMessageInput[],
  providerId: ProviderId | string
): ProviderFormattedMessage[] {
  const provider = getAttachmentProvider(providerId)
  if (provider && SDK_NATIVE_ATTACHMENT_PROVIDERS.has(provider)) {
    return messages as ProviderFormattedMessage[]
  }

  return messages.map((message) => {
    if (!message.files?.length || (message.role !== 'user' && message.role !== 'assistant')) {
      return message as ProviderFormattedMessage
    }

    if (provider === 'openrouter') {
      const { files: _omit, ...rest } = message
      return {
        ...rest,
        content: buildOpenRouterMessageContent(message.content, message.files, providerId) as
          | string
          | Array<Record<string, unknown>>,
      }
    }

    const { files: _omit, ...rest } = message
    return {
      ...rest,
      content: buildOpenAICompatibleChatContent(message.content, message.files, providerId) as
        | string
        | Array<Record<string, unknown>>,
    }
  })
}
