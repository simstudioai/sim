import type { PersistedContentBlock } from '@/lib/copilot/chat/persisted-message'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { GenerateApiKey } from '@/lib/copilot/generated/tool-catalog-v1'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import type { ChatMessage, ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

/**
 * Two-sided handling of `sim_key` API keys in the Mothership chat:
 *
 * - **Write side** (server, runs in `buildPersistedAssistantMessage`):
 *   strip every revealed `<credential type="sim_key">` value before the row
 *   hits Postgres. Reloading a chat days later — or pulling the row from the
 *   DB directly — never re-exposes the key.
 *
 * - **Read side** (client, runs in `useChat`'s message selector): an in-memory
 *   page-session cache captures revealed values during the live SSE stream.
 *   When the post-stream refetch returns the redacted persisted message, the
 *   selector re-injects the captured values so the user can still copy the
 *   key they just generated. Cache is dropped on page unload.
 */

const CREDENTIAL_TAG_PATTERN = /<credential>([\s\S]*?)<\/credential>/g
const REDACTED_TAG_PATTERN = /<credential>[^<]*"redacted"\s*:\s*true[^<]*<\/credential>/
const SIM_KEY_TYPE = 'sim_key'
const REDACTED_SIM_KEY_TAG = `<credential>${JSON.stringify({
  type: SIM_KEY_TYPE,
  redacted: true,
})}</credential>`

interface CredentialTagBody {
  type?: unknown
  value?: unknown
  redacted?: unknown
}

function parseCredentialBody(body: string): CredentialTagBody | null {
  try {
    return JSON.parse(body) as CredentialTagBody
  } catch {
    return null
  }
}

function hasRedactedSimKeyTag(content: string | undefined): boolean {
  return typeof content === 'string' && REDACTED_TAG_PATTERN.test(content)
}

// Write side ---------------------------------------------------------------

/**
 * Replace every revealed `<credential type="sim_key">` tag in `content` with a
 * placeholder marked `redacted: true`. Other credential types (e.g. OAuth
 * `link`) and malformed bodies pass through unchanged.
 */
export function redactSensitiveContent<T extends string | undefined>(content: T): T {
  if (typeof content !== 'string' || !content.includes('<credential>')) return content
  return content.replace(CREDENTIAL_TAG_PATTERN, (match, body: string) => {
    const parsed = parseCredentialBody(body)
    return parsed?.type === SIM_KEY_TYPE ? REDACTED_SIM_KEY_TAG : match
  }) as T
}

/**
 * Replace the raw `key` field in a `generate_api_key` tool result with the
 * shared redaction marker. The persisted tool result still records the
 * call's outcome and metadata; only the secret is stripped.
 */
export function redactToolCallResult(
  toolName: string | undefined,
  result: { success: boolean; output?: unknown; error?: string } | undefined
): { success: boolean; output?: unknown; error?: string } | undefined {
  if (!result || toolName !== GenerateApiKey.id) return result
  const output = result.output
  if (!output || typeof output !== 'object') return result
  const record = output as Record<string, unknown>
  if (typeof record.key !== 'string') return result
  return {
    ...result,
    output: { ...record, key: REDACTED_MARKER, redacted: true },
  }
}

function isMergeableAssistantTextBlock(block: PersistedContentBlock): boolean {
  return (
    block.type === MothershipStreamV1EventType.text &&
    block.channel === MothershipStreamV1TextChannel.assistant &&
    block.toolCall === undefined
  )
}

/**
 * Streaming produces one assistant-text block per token chunk, which means a
 * `<credential>...</credential>` tag can straddle dozens of blocks. Per-block
 * redaction can't see across that boundary and would persist the secret. So
 * coalesce consecutive same-lane assistant-text blocks into a single block,
 * then redact the merged content.
 *
 * Block timestamps for assistant text aren't user-visible (only `thinking`
 * blocks drive the "Thought for Ns" chip), so collapsing the run is safe.
 */
export function mergeAndRedactPersistedBlocks(
  blocks: PersistedContentBlock[]
): PersistedContentBlock[] {
  const out: PersistedContentBlock[] = []
  let runStart = -1
  let runLane: PersistedContentBlock['lane']

  const flushRun = (endExclusive: number) => {
    if (runStart < 0) return
    const run = blocks.slice(runStart, endExclusive)
    runStart = -1
    if (run.length === 0) return
    if (run.length === 1) {
      const single = run[0]
      out.push({ ...single, content: redactSensitiveContent(single.content) })
      return
    }
    const head = run[0]
    const tail = run[run.length - 1]
    out.push({
      ...head,
      content: redactSensitiveContent(run.map((b) => b.content ?? '').join('')),
      ...(tail.endedAt !== undefined ? { endedAt: tail.endedAt } : {}),
    })
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const sameRun = runStart >= 0 && isMergeableAssistantTextBlock(block) && runLane === block.lane
    if (sameRun) continue
    flushRun(i)
    if (isMergeableAssistantTextBlock(block)) {
      runStart = i
      runLane = block.lane
    } else {
      out.push(block)
    }
  }
  flushRun(blocks.length)

  return out
}

// Read side ----------------------------------------------------------------

/**
 * Page-session cache of `sim_key` credential values revealed during the live
 * SSE stream, keyed by either the synthetic live-assistant id (used while
 * streaming) or the persisted message's `requestId` (used after refetch).
 * Lives in a `useRef`; never persisted; dropped on unload.
 */
export type RevealedSimKeysByMessage = Map<string, string[]>

/**
 * Scan an assembled assistant message for `<credential type="sim_key">` tags
 * and return their values in stream order, skipping anything already redacted.
 */
export function extractRevealedSimKeys(content: string): string[] {
  if (!content || !content.includes('<credential>')) return []
  const values: string[] = []
  for (const match of content.matchAll(CREDENTIAL_TAG_PATTERN)) {
    const parsed = parseCredentialBody(match[1])
    if (parsed?.type === SIM_KEY_TYPE && !parsed.redacted && typeof parsed.value === 'string') {
      values.push(parsed.value)
    }
  }
  return values
}

/**
 * Extend the cache entries for the given keys with any newly-revealed values.
 * Each key in `keys` is written the same array — passing both the live-stream
 * id and the persisted `requestId` lets the post-finalize refetch hit the
 * cache after the message is renamed to its real UUID. The longest captured
 * list wins so a rerun that surfaces fewer values can't shrink the entry.
 */
export function captureRevealedSimKeys(
  cache: RevealedSimKeysByMessage,
  keys: ReadonlyArray<string | undefined>,
  content: string
): void {
  if (!content.includes('<credential>')) return
  const next = extractRevealedSimKeys(content)
  if (next.length === 0) return
  for (const key of keys) {
    if (!key) continue
    const existing = cache.get(key)
    if (!existing || next.length > existing.length) cache.set(key, next)
  }
}

function restoreInString(
  content: string,
  revealedValues: string[],
  startCursor: number
): {
  next: string
  changed: boolean
  cursor: number
} {
  if (!content.includes('<credential>') || revealedValues.length === 0) {
    return { next: content, changed: false, cursor: startCursor }
  }
  let cursor = startCursor
  let changed = false
  const next = content.replace(CREDENTIAL_TAG_PATTERN, (match, body: string) => {
    const parsed = parseCredentialBody(body)
    if (parsed?.type === SIM_KEY_TYPE && parsed.redacted === true) {
      const value = revealedValues[cursor]
      cursor += 1
      if (typeof value === 'string') {
        changed = true
        return `<credential>${JSON.stringify({ value, type: SIM_KEY_TYPE })}</credential>`
      }
    }
    return match
  })
  return { next, changed, cursor }
}

/**
 * Replace redacted `sim_key` tags in a single message with the live values
 * captured for that message. Returns the original message reference unchanged
 * when there's nothing to substitute, so memoized children keep their identity.
 */
export function restoreRevealedSimKeysForMessage(
  message: ChatMessage,
  cache: RevealedSimKeysByMessage
): ChatMessage {
  if (message.role !== 'assistant') return message
  const revealed =
    cache.get(message.id) ?? (message.requestId ? cache.get(message.requestId) : undefined)
  if (!revealed || revealed.length === 0) return message
  if (
    !hasRedactedSimKeyTag(message.content) &&
    !message.contentBlocks?.some((b) => hasRedactedSimKeyTag(b.content))
  ) {
    return message
  }

  const restoredContent = restoreInString(message.content, revealed, 0)
  let blocksChanged = false
  let blockCursor = 0
  const nextBlocks: ContentBlock[] | undefined = message.contentBlocks?.map((block) => {
    if (!hasRedactedSimKeyTag(block.content)) return block
    const restored = restoreInString(block.content as string, revealed, blockCursor)
    blockCursor = restored.cursor
    if (!restored.changed) return block
    blocksChanged = true
    return { ...block, content: restored.next }
  })

  if (!restoredContent.changed && !blocksChanged) return message

  return {
    ...message,
    content: restoredContent.next,
    ...(nextBlocks ? { contentBlocks: nextBlocks } : {}),
  }
}
