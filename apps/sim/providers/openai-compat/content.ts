import { isRecordLike } from '@sim/utils/object'

/** Extracts answer text from vendor content blocks while excluding private thinking. */
export function extractChatCompletionText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      isRecordLike(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''
    )
    .join('')
}
