import { sleep } from '@sim/utils/helpers'
import { parseRetryAfter } from '@sim/utils/retry'
import type { SlackCanvasFile } from '@/tools/slack/types'

export const mapCanvasFile = (file: SlackCanvasFile): SlackCanvasFile => ({
  id: file.id,
  created: file.created ?? null,
  timestamp: file.timestamp ?? null,
  name: file.name ?? null,
  title: file.title ?? null,
  mimetype: file.mimetype ?? null,
  filetype: file.filetype ?? null,
  pretty_type: file.pretty_type ?? null,
  user: file.user ?? null,
  editable: file.editable ?? null,
  size: file.size ?? null,
  mode: file.mode ?? null,
  is_external: file.is_external ?? null,
  is_public: file.is_public ?? null,
  url_private: file.url_private ?? null,
  url_private_download: file.url_private_download ?? null,
  permalink: file.permalink ?? null,
  channels: file.channels ?? [],
  groups: file.groups ?? [],
  ims: file.ims ?? [],
  canvas_readtime: file.canvas_readtime ?? null,
  is_channel_space: file.is_channel_space ?? null,
  linked_channel_id: file.linked_channel_id ?? null,
  canvas_creator_id: file.canvas_creator_id ?? null,
})

/**
 * Normalizes a raw Slack message object into the shape used by every
 * message-returning Slack tool (history, replies, thread, reader).
 */
export const mapSlackMessage = (msg: any) => ({
  type: msg.type ?? 'message',
  ts: msg.ts,
  text: msg.text ?? '',
  user: msg.user ?? null,
  bot_id: msg.bot_id ?? null,
  username: msg.username ?? null,
  channel: msg.channel ?? null,
  team: msg.team ?? null,
  thread_ts: msg.thread_ts ?? null,
  parent_user_id: msg.parent_user_id ?? null,
  reply_count: msg.reply_count ?? null,
  reply_users_count: msg.reply_users_count ?? null,
  latest_reply: msg.latest_reply ?? null,
  subscribed: msg.subscribed ?? null,
  last_read: msg.last_read ?? null,
  unread_count: msg.unread_count ?? null,
  subtype: msg.subtype ?? null,
  reactions: msg.reactions ?? [],
  is_starred: msg.is_starred ?? false,
  pinned_to: msg.pinned_to ?? [],
  files: (msg.files ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimetype: f.mimetype,
    size: f.size,
    url_private: f.url_private ?? null,
    permalink: f.permalink ?? null,
    mode: f.mode ?? null,
  })),
  attachments: msg.attachments ?? [],
  blocks: msg.blocks ?? [],
  edited: msg.edited ?? null,
  permalink: msg.permalink ?? null,
})

/** Maximum messages to request per page. Slack caps `conversations.*` at 999. */
const SLACK_PAGE_MAX = 999
/** Hard ceiling on retries for a single rate-limited page. */
const SLACK_RATE_LIMIT_MAX_RETRIES = 5

/**
 * Parses a positive integer from possibly string/undefined/NaN input (e.g. an
 * LLM-supplied param), falling back to `fallback` when the value is not a finite
 * positive number. Prevents a non-numeric `limit`/`maxPages` from silently
 * disabling pagination.
 */
export function resolvePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export interface SlackPaginateOptions {
  /** Bot or OAuth bearer token. */
  token: string
  /** Slack Web API method, e.g. `conversations.history`. */
  method: 'conversations.history' | 'conversations.replies'
  /**
   * Query params common to every page (channel, ts, oldest, latest, inclusive).
   * Undefined/empty values are skipped.
   */
  baseParams: Record<string, string | undefined>
  /** Page size (clamped to Slack's 999 max). */
  limit: number
  /** Starting cursor; omit to begin from the first page. */
  cursor?: string
  /** Maximum number of pages to fetch before stopping. */
  maxPages: number
  /** Human-readable scope hint surfaced on `missing_scope`. */
  missingScopeHint: string
}

export interface SlackPaginateResult {
  messages: any[]
  nextCursor: string | null
  hasMore: boolean
  pages: number
}

/**
 * Fetches messages from a paginated Slack `conversations.*` method, following
 * `response_metadata.next_cursor` up to `maxPages`. Retries rate-limited pages
 * using the `Retry-After` header. Slack returns HTTP 200 for logical errors, so
 * the `ok` field is checked on every page.
 */
export async function fetchSlackMessagesPaginated(
  opts: SlackPaginateOptions
): Promise<SlackPaginateResult> {
  const { token, method, baseParams, limit, maxPages, missingScopeHint } = opts
  const perPage = Math.min(Math.max(Number(limit) || 0, 1), SLACK_PAGE_MAX)

  const messages: any[] = []
  let cursor = opts.cursor?.trim() || undefined
  let nextCursor: string | null = null
  let pages = 0

  while (pages < maxPages) {
    const url = new URL(`https://slack.com/api/${method}`)
    for (const [key, value] of Object.entries(baseParams)) {
      const trimmed = typeof value === 'string' ? value.trim() : value
      if (trimmed) url.searchParams.append(key, String(trimmed))
    }
    url.searchParams.append('limit', String(perPage))
    if (cursor) url.searchParams.append('cursor', cursor)

    let response: Response
    let attempt = 0
    while (true) {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (response.status === 429 && attempt < SLACK_RATE_LIMIT_MAX_RETRIES) {
        attempt += 1
        const retryAfter = parseRetryAfter(response.headers.get('retry-after')) ?? 1000
        await sleep(retryAfter)
        continue
      }
      break
    }

    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'missing_scope') {
        throw new Error(
          `Missing required permissions. Please reconnect your Slack account with the necessary scopes (${missingScopeHint}).`
        )
      }
      if (data.error === 'invalid_auth') {
        throw new Error('Invalid authentication. Please check your Slack credentials.')
      }
      if (data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.')
      }
      if (data.error === 'ratelimited') {
        throw new Error('Slack rate limit exceeded. Please retry in a moment.')
      }
      throw new Error(data.error || `Failed to call ${method}`)
    }

    for (const msg of data.messages ?? []) messages.push(mapSlackMessage(msg))

    pages += 1
    nextCursor = data.response_metadata?.next_cursor || null
    if (!nextCursor) break
    cursor = nextCursor
  }

  return {
    messages,
    nextCursor,
    hasMore: Boolean(nextCursor),
    pages,
  }
}
