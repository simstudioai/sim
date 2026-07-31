import { openai } from '@ai-sdk/openai'
import {
  convertToModelMessages,
  jsonSchema,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from 'ai'
import { sql } from 'drizzle-orm'
import { db, docsEmbeddings } from '@/lib/db'
import { generateSearchEmbedding } from '@/lib/embeddings'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Model used for the Ask AI chat. Override with OPENAI_CHAT_MODEL in the environment. */
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini'

/** Max documentation chunks returned per search to ground an answer. */
const SEARCH_LIMIT = 6

/** Candidates pulled before locale filtering, so a locale still yields SEARCH_LIMIT results. */
const SEARCH_CANDIDATES = SEARCH_LIMIT * 4

/** Minimum cosine similarity for an English vector match (mirrors the site search route). */
const SIMILARITY_THRESHOLD = 0.6

/** Locales the docs are published in (mirrors the site search route). */
const KNOWN_LOCALES = ['en', 'es', 'fr', 'de', 'ja', 'zh']
const DEFAULT_LOCALE = 'en'

/** Postgres full-text config per locale (mirrors the site search route). */
const TS_CONFIG: Record<string, string> = {
  en: 'english',
  es: 'spanish',
  fr: 'french',
  de: 'german',
  ja: 'simple',
  zh: 'simple',
}

/**
 * Abuse guards. This endpoint proxies a paid LLM, so an unauthenticated public
 * route is a target for scripted "free inference". These bounds cap the cost of
 * any single request; an in-memory per-IP rate limit (below) caps volume on the
 * hot path. A shared-store rate limit, a provider spend cap, and edge bot
 * protection remain the durable controls (see the PR checklist).
 *
 * The size cap counts only user-authored text — NOT the conversation history,
 * assistant turns, or retrieved doc chunks we add via the searchDocs tool, which
 * legitimately grow large over a multi-turn chat.
 */
const MAX_MESSAGES = 200
const MAX_USER_INPUT_CHARS = 400_000
const MAX_OUTPUT_TOKENS = 4000
const MAX_STEPS = 6
/** Backstop on the sanitized model payload — bounds total LLM input (e.g. stuffed assistant text). */
const MAX_TOTAL_CHARS = 1_000_000

/**
 * Per-IP rate limit. Fixed window, in-memory: this bounds volume from a single
 * source on a warm instance without external infra. It is best-effort on
 * serverless (state is per-instance, not shared across regions/cold starts);
 * a shared store (e.g. Vercel KV) and an edge WAF remain the durable controls,
 * but this closes the "no volume limit at all" gap on the hot path.
 */
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const rateLimitHits = new Map<string, { count: number; resetAt: number }>()

/** Resolve the client IP from forwarding headers, falling back to a shared bucket. */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** Fixed-window check. Returns retry-after seconds when the caller is over the limit, else null. */
function rateLimit(ip: string, now: number): number | null {
  const entry = rateLimitHits.get(ip)
  if (!entry || now >= entry.resetAt) {
    rateLimitHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return null
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return Math.ceil((entry.resetAt - now) / 1000)
  }
  entry.count += 1
  return null
}

/** Drop expired buckets so the Map doesn't grow unbounded on a long-lived instance. */
function sweepRateLimit(now: number): void {
  if (rateLimitHits.size < 10_000) return
  for (const [ip, entry] of rateLimitHits) {
    if (now >= entry.resetAt) rateLimitHits.delete(ip)
  }
}

/** A structurally valid UI message: has a role and a parts array. */
function isValidMessage(message: unknown): message is UIMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { role?: unknown }).role === 'string' &&
    Array.isArray((message as { parts?: unknown }).parts)
  )
}

/** Total length of user-authored text across the conversation. */
function userInputChars(messages: UIMessage[]): number {
  let total = 0
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type === 'text' && typeof part.text === 'string') total += part.text.length
    }
  }
  return total
}

/**
 * Strip everything the model shouldn't trust from client-supplied history:
 * drop `system` messages (client-injected instructions) and every non-text part
 * (e.g. crafted tool results faking searchDocs output). Only user/assistant text
 * survives, so grounding comes from the server-run searchDocs tool — not the
 * client's payload.
 */
function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part) => part.type === 'text' && typeof part.text === 'string'),
    }))
    .filter((message) => message.parts.length > 0)
}

/**
 * Reject obvious cross-origin calls. Same-origin browser requests send an
 * `Origin` header matching the host; we allow those, plus any host in
 * DOCS_ALLOWED_ORIGINS (comma-separated). Requests with no Origin (e.g. curl)
 * are allowed through to the cost caps rather than blocked, since Origin is
 * trivially spoofable and is a filter, not a security boundary.
 */
function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true

  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return false
  }

  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const requestHost = forwardedHost?.split(',')[0].trim().toLowerCase()
  if (requestHost && originHost === requestHost) return true

  const allowlist = (process.env.DOCS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return allowlist.includes(originHost)
}

const SYSTEM_PROMPT = `You are the documentation assistant for Sim — the open-source AI workspace where teams build, deploy, and manage AI agents.

Answer questions about Sim using the documentation. Always call the searchDocs tool before answering anything specific about Sim's features, configuration, or usage — do not answer from memory. Base your answer only on the returned documentation; if the docs do not cover the question, say so plainly rather than guessing.

Guidelines:
- Be direct and concrete. Lead with the answer, then the detail.
- Reference the relevant pages by their titles so the user knows where to read more.
- When you show configuration or code, keep it minimal and correct.
- The agent is called "Sim" and the chat surface is "Chat" — never say "Mothership" or "copilot".
- If a question is unrelated to Sim, briefly say it's outside the docs' scope.`

const SEARCH_COLUMNS = {
  chunkId: docsEmbeddings.chunkId,
  title: docsEmbeddings.headerText,
  url: docsEmbeddings.sourceLink,
  content: docsEmbeddings.chunkText,
  sourceDocument: docsEmbeddings.sourceDocument,
}

/** Reciprocal-rank-fusion constant, matching the site search route. */
const RRF_K = 60

/**
 * SQL predicate selecting only the locale's documents, so the row limit applies
 * to matching rows: non-English docs are prefixed with their locale segment;
 * English is everything not prefixed with another locale.
 */
function localeFilter(locale: string) {
  const firstSegment = sql`split_part(${docsEmbeddings.sourceDocument}, '/', 1)`
  if (locale === DEFAULT_LOCALE) {
    const others = KNOWN_LOCALES.filter((l) => l !== DEFAULT_LOCALE)
    return sql`${firstSegment} not in (${sql.join(
      others.map((l) => sql`${l}`),
      sql`, `
    )})`
  }
  return sql`${firstSegment} = ${locale}`
}

type SearchRow = {
  chunkId: string
  title: string
  url: string
  content: string
  sourceDocument: string
}

/**
 * Retrieve candidate chunks for grounding, mirroring the site search route's
 * hybrid strategy: Postgres full-text keyword search for every locale, plus
 * vector similarity (thresholded) for English — fused by reciprocal rank so a
 * page found by either signal can ground the answer.
 */
async function searchDocs(query: string, locale: string) {
  const tsConfig = TS_CONFIG[locale] ?? 'simple'

  // Each retrieval path is best-effort and independent: a failure in one still
  // lets the other ground the answer (both empty just yields no grounding).
  let keywordRows: SearchRow[] = []
  try {
    keywordRows = await db
      .select(SEARCH_COLUMNS)
      .from(docsEmbeddings)
      .where(
        sql`${docsEmbeddings.chunkTextTsv} @@ plainto_tsquery(${tsConfig}, ${query}) and ${localeFilter(locale)}`
      )
      .orderBy(
        sql`ts_rank(${docsEmbeddings.chunkTextTsv}, plainto_tsquery(${tsConfig}, ${query})) DESC`
      )
      .limit(SEARCH_CANDIDATES)
  } catch (error) {
    console.error('Ask AI keyword search failed:', error)
  }

  let vectorRows: SearchRow[] = []
  if (locale === DEFAULT_LOCALE) {
    // Vector retrieval (embedding call + pgvector query) is best-effort: if it
    // fails, fall back to the keyword rows already fetched rather than losing all
    // grounding for the turn.
    try {
      const embedding = await generateSearchEmbedding(query)
      const vectorLiteral = JSON.stringify(embedding)
      vectorRows = await db
        .select(SEARCH_COLUMNS)
        .from(docsEmbeddings)
        .where(
          sql`1 - (${docsEmbeddings.embedding} <=> ${vectorLiteral}::vector) >= ${SIMILARITY_THRESHOLD} and ${localeFilter(locale)}`
        )
        .orderBy(sql`${docsEmbeddings.embedding} <=> ${vectorLiteral}::vector`)
        .limit(SEARCH_CANDIDATES)
    } catch (error) {
      console.error('Ask AI vector search failed; using keyword results only:', error)
    }
  }

  // Reciprocal rank fusion across the two rankings, deduped by chunk.
  const scores = new Map<string, number>()
  const rowById = new Map<string, SearchRow>()
  for (const list of [vectorRows, keywordRows]) {
    list.forEach((row, index) => {
      scores.set(row.chunkId, (scores.get(row.chunkId) ?? 0) + 1 / (RRF_K + index + 1))
      if (!rowById.has(row.chunkId)) rowById.set(row.chunkId, row)
    })
  }

  return [...rowById.values()]
    .sort((a, b) => (scores.get(b.chunkId) ?? 0) - (scores.get(a.chunkId) ?? 0))
    .slice(0, SEARCH_LIMIT)
    .map((row) => ({
      title: row.title,
      url: row.url,
      content: row.content,
    }))
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) {
    return new Response('Forbidden', { status: 403 })
  }

  const now = Date.now()
  sweepRateLimit(now)
  const retryAfter = rateLimit(getClientIp(req), now)
  if (retryAfter !== null) {
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    })
  }

  let body: { messages: UIMessage[]; locale?: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  const { messages } = body
  const locale = KNOWN_LOCALES.includes(body.locale ?? '')
    ? (body.locale as string)
    : DEFAULT_LOCALE

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return new Response('Invalid request', { status: 400 })
  }
  if (!messages.every(isValidMessage)) {
    return new Response('Invalid request', { status: 400 })
  }
  if (userInputChars(messages) > MAX_USER_INPUT_CHARS) {
    return new Response('Request too large', { status: 413 })
  }

  const modelMessages = sanitizeMessages(messages)
  if (modelMessages.length === 0) {
    return new Response('Invalid request', { status: 400 })
  }
  // Bound what actually reaches the model. Measured AFTER sanitization, so the
  // prior searchDocs tool outputs that accumulate in client history (and are
  // stripped here) don't count — only user/assistant text the model will see.
  if (JSON.stringify(modelMessages).length > MAX_TOTAL_CHARS) {
    return new Response('Request too large', { status: 413 })
  }

  const result = streamText({
    model: openai(CHAT_MODEL),
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(modelMessages),
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    tools: {
      searchDocs: tool({
        description:
          'Search the Sim documentation for relevant content. Use this before answering any question about Sim.',
        /**
         * The SDK's own schema helper instead of a zod schema: the `ai`
         * package's zod-v4 typings lag the workspace zod version, so a zod
         * object here fails the tool() overloads whenever the two drift.
         */
        inputSchema: jsonSchema<{ query: string }>({
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'A focused natural-language search query.',
            },
          },
          required: ['query'],
          additionalProperties: false,
        }),
        execute: async ({ query }) => searchDocs(query, locale),
      }),
    },
  })

  return result.toUIMessageStreamResponse()
}
