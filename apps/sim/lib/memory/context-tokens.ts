import { getAccurateTokenCount } from '@/lib/tokenization/accurate'

const MAX_TOKENIZED_CONTEXT_CHARACTERS = 4096
const MAX_TOKENIZED_CHARACTER_RUN = 128

/**
 * Tokenizer merge work can grow sharply on long repeated input. Larger or repetitive context
 * uses its UTF-8 byte length as a conservative token upper bound, keeping budgeting CPU bounded.
 */
export function getConversationTokenCount(text: string, model?: string): number {
  if (text.length > MAX_TOKENIZED_CONTEXT_CHARACTERS) return Buffer.byteLength(text, 'utf8')
  let runLength = 1
  for (let index = 1; index < text.length; index++) {
    runLength = text.charCodeAt(index) === text.charCodeAt(index - 1) ? runLength + 1 : 1
    if (runLength >= MAX_TOKENIZED_CHARACTER_RUN) return Buffer.byteLength(text, 'utf8')
  }
  return getAccurateTokenCount(text, model)
}
