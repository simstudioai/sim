import { createLogger } from '@sim/logger'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import {
  SLACK_SEARCH_CHANNEL_TYPES,
  type SlackSearchChannelType,
  type SlackSearchResult,
} from '@/lib/slack-search/types'

const logger = createLogger('SlackSearch')

const SLACK_SEARCH_URL = 'https://slack.com/api/assistant.search.context'

/** Slack caps a page of search context at twenty results. */
export const SLACK_SEARCH_MAX_LIMIT = 20

/** A search response holds a bounded number of messages; this guards a malformed body. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * Slack's rate limit for this method is roughly ten calls a minute per person,
 * and the caller is a person waiting on a search box, so a slow answer is worth
 * less than a fast one without Slack in it.
 */
const REQUEST_TIMEOUT_MS = 8_000

/** A Slack `ok: false` envelope, carrying the machine-readable code. */
export class SlackSearchError extends Error {
  constructor(readonly code: string) {
    super(`Slack search failed: ${code}`)
    this.name = 'SlackSearchError'
  }
}

/**
 * The message shape `assistant.search.context` returns. Only the fields this
 * module reads are modeled.
 *
 * https://docs.slack.dev/reference/methods/assistant.search.context/
 */
interface SlackContextMessage {
  author_name?: string
  author_user_id?: string
  channel_id?: string
  channel_name?: string
  message_ts?: string
  content?: string
  is_author_bot?: boolean
  permalink?: string
  context_messages?: {
    before?: { text?: string }[]
    after?: { text?: string }[]
  }
}

interface SlackSearchResponse {
  ok?: boolean
  error?: string
  results?: { messages?: SlackContextMessage[] }
  response_metadata?: { next_cursor?: string }
}

/**
 * A Slack timestamp is epoch seconds with a fractional suffix. An unparseable
 * one costs the result its date, never the result itself.
 */
function parseSlackTimestamp(ts: string | undefined): Date | null {
  const seconds = Number.parseFloat(ts ?? '')
  if (!Number.isFinite(seconds)) return null
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Joins the matched message with the messages Slack returned around it, so a
 * one-line reply reads as the exchange it belongs to rather than on its own.
 */
function buildText(message: SlackContextMessage): string {
  const before = message.context_messages?.before ?? []
  const after = message.context_messages?.after ?? []
  const lines = [
    ...before.map((entry) => entry.text?.trim()),
    message.content?.trim(),
    ...after.map((entry) => entry.text?.trim()),
  ]
  return lines.filter((line): line is string => Boolean(line)).join('\n')
}

function toResult(message: SlackContextMessage): SlackSearchResult | null {
  const channelId = message.channel_id
  const messageTs = message.message_ts
  const permalink = message.permalink
  if (!channelId || !messageTs || !permalink) return null
  const text = buildText(message)
  if (!text) return null
  return {
    channelId,
    messageTs,
    channelName: message.channel_name ?? 'Slack',
    authorName: message.author_name ?? 'Unknown',
    text,
    permalink,
    sentAt: parseSlackTimestamp(messageTs),
    isAuthorBot: message.is_author_bot === true,
  }
}

export interface SearchSlackParams {
  /** The asking person's own Slack user token; Slack enforces what it may read. */
  accessToken: string
  query: string
  /** Results to return, capped at Slack's own maximum. */
  limit?: number
  channelTypes?: readonly SlackSearchChannelType[]
  signal?: AbortSignal
}

/**
 * Searches Slack for context matching a query, as the holder of the token.
 *
 * Nothing is indexed: Slack answers from its own index and enforces its own
 * permissions, so a result is one the person could have found in Slack itself.
 * Failures are the caller's to absorb — a federated leg that throws must not
 * take the rest of a search down with it.
 */
export async function searchSlack({
  accessToken,
  query,
  limit = SLACK_SEARCH_MAX_LIMIT,
  channelTypes = SLACK_SEARCH_CHANNEL_TYPES,
  signal,
}: SearchSlackParams): Promise<SlackSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const body = new URLSearchParams({
    query: trimmed,
    limit: String(Math.min(Math.max(1, limit), SLACK_SEARCH_MAX_LIMIT)),
    content_types: 'messages',
    channel_types: channelTypes.join(','),
    include_context_messages: 'true',
    include_bots: 'false',
  })

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(SLACK_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })

  if (!response.ok) {
    /** Nothing here reads the body, and an uncancelled one holds the connection open. */
    await response.body?.cancel().catch(() => {})
    throw new SlackSearchError(`http_${response.status}`)
  }

  const data = await readResponseJsonWithLimit<SlackSearchResponse>(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Slack search response',
  })

  if (!data.ok) {
    throw new SlackSearchError(data.error || 'unknown_error')
  }

  const results = (data.results?.messages ?? []).flatMap((message) => {
    const result = toResult(message)
    return result ? [result] : []
  })
  logger.info('Searched Slack', { returned: results.length })
  return results
}
