import { isRecordLike } from '@sim/utils/object'
import { getConversationTokenCount } from '@/lib/memory/context-tokens'
import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import type { UserFile } from '@/executor/types'

const UNKNOWN_FILE_TOKENS = 4096

function declaredFileTokens(file: UserFile): number {
  return Number.isFinite(file.size) && file.size > 0
    ? Math.ceil(file.size / 3)
    : UNKNOWN_FILE_TOKENS
}

/** Remote handles are mapped once; each attachment actually sent is charged in its own group. */
export function conversationAttachmentTokensByReference(
  files: readonly UserFile[]
): Map<string, number> {
  const tokens = new Map<string, number>()
  for (const file of files) {
    for (const reference of [file.providerFileId, file.providerFileUri, file.remoteUrl, file.url]) {
      if (reference)
        tokens.set(reference, Math.max(tokens.get(reference) ?? 0, declaredFileTokens(file)))
    }
  }
  return tokens
}

function contentParts(item: unknown, protocol: ConversationProtocol): Record<string, unknown>[] {
  if (!isRecordLike(item)) return []
  const parts = protocol === 'gemini' ? item.parts : item.content
  return Array.isArray(parts) ? parts.filter(isRecordLike) : []
}

/**
 * JSON tokenization already counts inline attachment data. Only its missing conservative byte
 * allowance is added. Remote bodies need their allowance in addition to the short wire handle.
 */
export function conversationAttachmentTokenSurcharge(
  items: readonly unknown[],
  protocol: ConversationProtocol,
  model: string,
  tokensByReference: ReadonlyMap<string, number>
): number {
  let surcharge = 0
  const inspect = (part: Record<string, unknown>): void => {
    const source = isRecordLike(part.source) ? part.source : undefined
    const imageUrl = isRecordLike(part.image_url) ? part.image_url.url : part.image_url
    const file = isRecordLike(part.file) ? part.file : undefined
    const fileData = isRecordLike(part.fileData) ? part.fileData : undefined
    const inlineData = isRecordLike(part.inlineData) ? part.inlineData : undefined
    const bedrock = [part.image, part.document, part.video].find(isRecordLike)
    const bedrockSource = isRecordLike(bedrock?.source) ? bedrock.source : undefined
    const s3 = isRecordLike(bedrockSource?.s3Location) ? bedrockSource.s3Location : undefined
    const reference =
      part.file_id ??
      part.file_url ??
      fileData?.fileUri ??
      source?.file_id ??
      source?.url ??
      imageUrl ??
      file?.file_data ??
      s3?.uri
    const encoded =
      inlineData?.data ??
      (source?.type === 'base64' ? source.data : undefined) ??
      part.file_data ??
      (typeof reference === 'string' && reference.startsWith('data:') ? reference : undefined)
    let inlineTokens = 0
    if (typeof encoded === 'string') {
      const encodedLength = encoded.startsWith('data:')
        ? encoded.length - encoded.indexOf(',') - 1
        : encoded.length
      inlineTokens = Math.ceil(encodedLength / 4)
    }
    if (ArrayBuffer.isView(bedrockSource?.bytes)) {
      inlineTokens = Math.ceil(bedrockSource.bytes.byteLength / 3)
    }
    if (inlineTokens > 0) {
      surcharge += Math.max(
        0,
        inlineTokens - getConversationTokenCount(JSON.stringify(part), model)
      )
    } else if (typeof reference === 'string' && reference && !reference.startsWith('data:')) {
      surcharge += tokensByReference.get(reference) ?? UNKNOWN_FILE_TOKENS
    }

    /** Tool output JSON is plain text; only provider-native nested content carries attachments. */
    if (part.type === 'tool_result' && Array.isArray(part.content)) {
      for (const child of part.content) if (isRecordLike(child)) inspect(child)
    }
    if (isRecordLike(part.toolResult) && Array.isArray(part.toolResult.content)) {
      for (const child of part.toolResult.content) if (isRecordLike(child)) inspect(child)
    }
    if (isRecordLike(part.functionResponse) && Array.isArray(part.functionResponse.parts)) {
      for (const child of part.functionResponse.parts) if (isRecordLike(child)) inspect(child)
    }
  }
  for (const item of items) for (const part of contentParts(item, protocol)) inspect(part)
  return surcharge
}
