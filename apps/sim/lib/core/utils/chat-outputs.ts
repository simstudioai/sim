import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import type { UserFile } from '@/executor/types'

/**
 * File fields a chat transcript renders — {@link UserFile} minus inlined
 * payloads (`base64`) and provider handles. Structurally identical to the
 * transcript's `ChatFile`, which stays with the message component.
 */
export type ChatFileMetadata = Pick<
  UserFile,
  'id' | 'name' | 'url' | 'key' | 'size' | 'type' | 'context'
>

/**
 * Narrows an executor file to the fields the chat renders. Copying rather than
 * passing the value through keeps inlined `base64` payloads out of the
 * transcript's React state, where they would be retained for the session.
 */
export function toChatFileMetadata(file: UserFile): ChatFileMetadata {
  return {
    id: file.id,
    name: file.name,
    url: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
    context: file.context,
  }
}

/**
 * Renders one resolved output as markdown, or `null` when it carries nothing
 * to show: nullish values, workflow-produced files (rendered as download chips
 * instead), and empty arrays. Non-string objects become a JSON code fence.
 */
export function formatChatOutputValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (isUserFileWithMetadata(value)) return null
  if (Array.isArray(value) && value.length === 0) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/**
 * Reads one selected output out of a block's terminal output. Every chat
 * surface resolves the head of the path identically — an empty or `content`
 * path prefers `content`, then `result`, then the whole output, and any other
 * path is first read as a direct key — but the surfaces walk a missed key
 * differently (the interface chat's `traverseObjectPath` parses JSON `content`
 * and materializes large-value refs; the deployed chat does a plain
 * dot-segment walk), so the deep-path fallback is injected per surface.
 */
export function resolveChatOutputValue(
  output: Record<string, unknown>,
  path: string | undefined,
  resolveDeepPath: (output: Record<string, unknown>, path: string) => unknown
): unknown {
  if (!path || path === 'content') {
    if (output.content !== undefined) return output.content
    if (output.result !== undefined) return output.result
    return output
  }
  if (output[path] !== undefined) return output[path]
  return resolveDeepPath(output, path)
}
