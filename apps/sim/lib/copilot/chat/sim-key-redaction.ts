import { isRecordLike } from '@sim/utils/object'
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
const SIM_KEY_TYPE = 'sim_key'
// The persisted / secret-stripped form of a sim_key tag: value-less, which is
// exactly how the UI renders the masked state. No `redacted` flag needed — a
// sim_key chip is masked iff it has no value.
const VALUELESS_SIM_KEY_TAG = `<credential>${JSON.stringify({ type: SIM_KEY_TYPE })}</credential>`

interface CredentialTagBody {
  type?: unknown
  value?: unknown
}

function parseCredentialBody(body: string): CredentialTagBody | null {
  try {
    return JSON.parse(body) as CredentialTagBody
  } catch {
    return null
  }
}

/**
 * True when `content` holds a `sim_key` credential tag that still needs its
 * value filled in — i.e. any value-less `sim_key` tag: the model's
 * `{"type":"sim_key"}` placeholder, the persisted form, or a legacy
 * `{"type":"sim_key","redacted":true}` tag. All are recognized by the absence
 * of a `value`.
 */
function hasFillableSimKeyTag(content: string | undefined): boolean {
  if (typeof content !== 'string' || !content.includes('<credential>')) return false
  for (const match of content.matchAll(CREDENTIAL_TAG_PATTERN)) {
    const parsed = parseCredentialBody(match[1])
    if (parsed?.type === SIM_KEY_TYPE && parsed.value === undefined) return true
  }
  return false
}

// Write side ---------------------------------------------------------------

/**
 * Replace every `<credential type="sim_key">` tag in `content` with the
 * value-less placeholder, so a revealed key is never persisted. Other credential
 * types (e.g. OAuth `link`) and malformed bodies pass through unchanged.
 */
export function redactSensitiveContent<T extends string | undefined>(content: T): T {
  if (typeof content !== 'string' || !content.includes('<credential>')) return content
  return content.replace(CREDENTIAL_TAG_PATTERN, (match, body: string) => {
    const parsed = parseCredentialBody(body)
    return parsed?.type === SIM_KEY_TYPE ? VALUELESS_SIM_KEY_TAG : match
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

/**
 * The model-facing result of `generate_api_key`. The generated key is a
 * client-only artifact — it rides the SSE tool result to the browser and renders
 * as the `sim_key` chip — so the model (and the persisted conversation) must
 * never receive it. Rather than subtract the secret from the full payload, the
 * model's result IS the status: on success it gets only the tool's message (no
 * key, no id/name/workspaceId); a failure passes through so the model still sees
 * the error. Every other tool's terminal data is returned unchanged.
 */
export function toolResultForModel(toolName: string | undefined, data: unknown): unknown {
  if (toolName !== GenerateApiKey.id) return data
  if (!isRecordLike(data)) return data
  const record = data
  if (typeof record.key !== 'string') return data
  return record.message
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
  // A run must stay within ONE lane instance: two parallel subagents both have
  // lane 'subagent', and merging across them would append span B's prose into
  // span A's block (B's spanId is lost with it). Key the run on span identity,
  // not just the lane flag.
  let runSpanId: PersistedContentBlock['spanId']
  let runParentToolCallId: PersistedContentBlock['parentToolCallId']

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
    const sameRun =
      runStart >= 0 &&
      isMergeableAssistantTextBlock(block) &&
      runLane === block.lane &&
      runSpanId === block.spanId &&
      runParentToolCallId === block.parentToolCallId
    if (sameRun) continue
    flushRun(i)
    if (isMergeableAssistantTextBlock(block)) {
      runStart = i
      runLane = block.lane
      runSpanId = block.spanId
      runParentToolCallId = block.parentToolCallId
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
 * and return their values in stream order; value-less (masked/placeholder) tags
 * carry no string value and are skipped.
 */
export function extractRevealedSimKeys(content: string): string[] {
  if (!content || !content.includes('<credential>')) return []
  const values: string[] = []
  for (const match of content.matchAll(CREDENTIAL_TAG_PATTERN)) {
    const parsed = parseCredentialBody(match[1])
    if (parsed?.type === SIM_KEY_TYPE && typeof parsed.value === 'string') {
      values.push(parsed.value)
    }
  }
  return values
}

/** Minimal shape of a rendered/streamed block carrying a tool result. */
interface ToolResultBlockLike {
  toolCall?: { name?: string; result?: unknown } | null
}

/**
 * Pull the freshly-generated key(s) out of `generate_api_key` tool results in
 * block order. This is the authoritative source for the `sim_key` chip now that
 * the model never sees (or emits) the value — it only emits a redacted
 * placeholder, and the real value rides in the tool result on the live stream.
 * `[REDACTED]` outputs (post-persist/refetch) are skipped so a reloaded
 * transcript doesn't cache the masked marker over a live value.
 */
export function extractRevealedSimKeysFromBlocks(
  blocks: ReadonlyArray<ToolResultBlockLike> | undefined
): string[] {
  if (!blocks?.length) return []
  const values: string[] = []
  for (const block of blocks) {
    const toolCall = block.toolCall
    if (!toolCall || toolCall.name !== GenerateApiKey.id) continue
    const result = toolCall.result
    if (!isRecordLike(result)) continue
    const output = result.output
    if (!isRecordLike(output)) continue
    const key = output.key
    if (typeof key === 'string' && key.length > 0 && key !== REDACTED_MARKER) {
      values.push(key)
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
 *
 * Values are sourced from the `generate_api_key` tool results (`blocks`) first —
 * that is where the key now lives, since the model only emits a redacted
 * placeholder tag — falling back to any inline `sim_key` tag values in
 * `content` for backward compatibility with pre-change transcripts.
 */
export function captureRevealedSimKeys(
  cache: RevealedSimKeysByMessage,
  keys: ReadonlyArray<string | undefined>,
  content: string,
  blocks?: ReadonlyArray<ToolResultBlockLike>
): void {
  const fromBlocks = extractRevealedSimKeysFromBlocks(blocks)
  // extractRevealedSimKeys already returns [] when `content` has no tag, so no
  // separate includes() guard is needed.
  const next = fromBlocks.length > 0 ? fromBlocks : extractRevealedSimKeys(content)
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
    // Any value-less sim_key tag is a fill slot — the model's placeholder, the
    // persisted form, or a legacy `{"redacted":true}` tag. Already-filled tags
    // carry a `value` and are left untouched (idempotent).
    if (parsed?.type === SIM_KEY_TYPE && parsed.value === undefined) {
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
    !hasFillableSimKeyTag(message.content) &&
    !message.contentBlocks?.some((b) => hasFillableSimKeyTag(b.content))
  ) {
    return message
  }

  const restoredContent = restoreInString(message.content, revealed, 0)
  let blocksChanged = false
  let blockCursor = 0
  const nextBlocks: ContentBlock[] | undefined = message.contentBlocks?.map((block) => {
    if (!hasFillableSimKeyTag(block.content)) return block
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
