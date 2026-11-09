/** One message of an Agent block's history, as the block stores and the provider reads it. */
export interface Message {
  role: MessageRole
  content: string
}

/** Who a message speaks as. */
export type MessageRole = 'system' | 'user' | 'assistant'

const ROLES: readonly string[] = ['system', 'user', 'assistant']

/** A complete `{ role, content }` object inside a streamed JSON buffer. */
const COMPLETE_MESSAGE_PATTERN =
  /"role"\s*:\s*"(system|user|assistant)"[^}]*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g

/** Content still streaming at the end of the buffer. */
const INCOMPLETE_CONTENT_PATTERN = /"content"\s*:\s*"((?:[^"\\]|\\.)*)$/

/** The role named before that still-streaming content. */
const ROLE_BEFORE_CONTENT_PATTERN = /"role"\s*:\s*"(system|user|assistant)"[^{]*$/

const unescapeContent = (value: string): string =>
  value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')

const isMessage = (value: unknown): value is Message =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { role?: unknown }).role === 'string' &&
  typeof (value as { content?: unknown }).content === 'string'

/** The stored value as messages, or `null` when it is not a list of well-formed messages. */
export function toMessages(value: unknown): Message[] | null {
  return Array.isArray(value) && value.every(isMessage) ? value : null
}

/**
 * Messages from a JSON array, keeping each item with a string role and content and reading an
 * unknown role as `user`; `null` when nothing usable parses.
 */
export function parseMessages(content: string): Message[] | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!Array.isArray(parsed)) return null
    const messages = parsed
      .filter(
        (item): item is { role: string; content: string } =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.role === 'string' &&
          typeof item.content === 'string'
      )
      .map((item) => ({
        role: (ROLES.includes(item.role) ? item.role : 'user') as MessageRole,
        content: item.content,
      }))
    return messages.length > 0 ? messages : null
  } catch {
    return null
  }
}

/**
 * The messages readable so far from a streaming JSON buffer: every complete message, then the one
 * whose content is still arriving.
 */
export function extractStreamingMessages(buffer: string): Message[] {
  const complete = parseMessages(buffer)
  if (complete) return complete

  const result: Message[] = []
  for (const match of buffer.matchAll(COMPLETE_MESSAGE_PATTERN)) {
    result.push({ role: match[1] as MessageRole, content: unescapeContent(match[2]) })
  }

  const lastContentIndex = buffer.lastIndexOf('"content"')
  if (lastContentIndex === -1) return result
  const incomplete = buffer.slice(lastContentIndex).match(INCOMPLETE_CONTENT_PATTERN)
  const role = buffer.slice(0, lastContentIndex).match(ROLE_BEFORE_CONTENT_PATTERN)
  if (incomplete && role) {
    const content = unescapeContent(incomplete[1])
    if (result.length === 0 || result[result.length - 1].content !== content) {
      result.push({ role: role[1] as MessageRole, content })
    }
  }
  return result
}

/** The non-empty messages as pretty JSON, the context the AI prompt revises. */
export function messagesJson(messages: Message[]): string {
  const nonEmpty = messages.filter((message) => message.content.trim() !== '')
  return nonEmpty.length > 0 ? JSON.stringify(nonEmpty, null, 2) : ''
}
