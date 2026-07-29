import { db, dbReplica } from '@sim/db'
import { copilotMessages, workflow } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import type { NewsletterTargetingCriteria } from '@/lib/api/contracts/newsletters'

export const NEWSLETTER_PREVIEW_SAMPLE_LIMIT = 50
export const NEWSLETTER_FINALIZE_PAGE_SIZE = 1000
export const NEWSLETTER_FINALIZE_SAFETY_CAP = 100000

export interface NewsletterAudienceCandidate {
  userId: string
  email: string
  name: string | null
  emailVerified: boolean
  banned: boolean
  unsubscribed: boolean
  reason: string
}

export interface NewsletterAudienceCounts {
  totalMatched: number
  excludedBanned: number
  excludedUnverified: number
  excludedUnsubscribed: number
  excludedSuppressed: number
  finalRecipientCount: number
}

interface CandidateRow extends Record<string, unknown> {
  user_id: string
  email: string
  name: string | null
  email_verified: boolean
  banned: boolean | null
  unsubscribed: boolean
  reason: string
}

interface CountRow extends Record<string, unknown> {
  total_matched: number | string
  excluded_banned: number | string
  excluded_unverified: number | string
  excluded_unsubscribed: number | string
  final_recipient_count: number | string
}

export class NewsletterTargetingPromptError extends Error {
  constructor() {
    super(
      'Targeting prompt is ambiguous. Use everyone, an Instagram integration or chat target, or a recent activity window.'
    )
    this.name = 'NewsletterTargetingPromptError'
  }
}

function parseDayWindow(prompt: string): number | null {
  const match = prompt.match(/(?:last|past|within)\s+(\d{1,4})\s+days?/i)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  if (!Number.isFinite(parsed)) return null
  return Math.max(1, Math.min(parsed, 3650))
}

function normalizePrompt(prompt: string): string {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/\s+/g, ' ')
}

export function classifyNewsletterPrompt(prompt: string): NewsletterTargetingCriteria {
  const normalized = normalizePrompt(prompt)
  const timeWindowDays = parseDayWindow(normalized)

  if (
    [
      'everyone',
      'newsletter to everyone',
      'newsletters to everyone',
      'send to everyone',
      'send newsletter to everyone',
      'all users',
      'all customers',
      'all people',
    ].includes(normalized)
  ) {
    return { type: 'everyone' }
  }

  const chatTargetPatterns = [
    /^users whose chat context mentions instagram(?: (?:in (?:the )?(?:last|past)|within) \d{1,4} days?)?$/,
    /^instagram chat context(?: (?:in (?:the )?(?:last|past)|within) \d{1,4} days?)?$/,
    /^users who (?:mentioned|asked about|talked about) instagram in (?:copilot )?chat(?: (?:in (?:the )?(?:last|past)|within) \d{1,4} days?)?$/,
  ]
  if (chatTargetPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      type: 'chat_mentions',
      term: 'instagram',
      timeWindowDays: Math.min(timeWindowDays ?? 90, 365),
    }
  }

  const integrationTargetPattern =
    /^(?:users who (?:use|are connected to) (?:the )?instagram(?: integration)?|users using (?:the )?instagram(?: integration)?|instagram integration users|instagram users)(?: (?:recently )?active)?(?: (?:in (?:the )?(?:last|past)|within) \d{1,4} days?)?$/
  if (integrationTargetPattern.test(normalized)) {
    return {
      type: 'integration_users',
      integration: 'instagram',
      timeWindowDays: timeWindowDays ?? (/\b(?:recently )?active\b/.test(normalized) ? 30 : null),
    }
  }

  const recentActivityPattern =
    /^(?:recently active users|users (?:recently )?active|users who (?:use|used) sim)(?: (?:in (?:the )?(?:last|past)|within) \d{1,4} days?)?$/
  if (recentActivityPattern.test(normalized)) {
    return { type: 'recently_active', timeWindowDays: timeWindowDays ?? 30 }
  }

  throw new NewsletterTargetingPromptError()
}

function cutoffForDays(days: number | null): Date | null {
  if (!days) return null
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

const emailOptOutSql = sql`
  (
    COALESCE((s.email_preferences->>'unsubscribeAll')::boolean, false)
    OR COALESCE((s.email_preferences->>'unsubscribeMarketing')::boolean, false)
  )
`

function matchedUsersSql(criteria: NewsletterTargetingCriteria) {
  if (criteria.type === 'everyone') {
    return sql`
      SELECT DISTINCT
        u.id AS user_id,
        u.email,
        u.name,
        u.email_verified,
        u.banned,
        ${emailOptOutSql} AS unsubscribed,
        'Everyone with a Sim account'::text AS reason
      FROM "user" u
      LEFT JOIN settings s ON s.user_id = u.id
      WHERE u.email IS NOT NULL AND u.email <> ''
    `
  }

  if (criteria.type === 'integration_users') {
    const integration = criteria.integration.toLowerCase()
    const cutoff = cutoffForDays(criteria.timeWindowDays)
    const workflowCutoff = cutoff ? sql.param(cutoff, workflow.updatedAt) : null

    return sql`
      SELECT DISTINCT
        u.id AS user_id,
        u.email,
        u.name,
        u.email_verified,
        u.banned,
        ${emailOptOutSql} AS unsubscribed,
        ${`Workflow uses the ${integration} integration`}::text AS reason
      FROM "user" u
      LEFT JOIN settings s ON s.user_id = u.id
      INNER JOIN workflow w ON w.user_id = u.id
      INNER JOIN workflow_blocks wb ON wb.workflow_id = w.id
      WHERE u.email IS NOT NULL
        AND u.email <> ''
        AND w.archived_at IS NULL
        AND wb.enabled = true
        AND wb.type = ${integration}
        ${workflowCutoff ? sql`AND w.updated_at >= ${workflowCutoff}` : sql``}
    `
  }

  if (criteria.type === 'chat_mentions') {
    const term = criteria.term.toLowerCase()
    const pattern = `%${term}%`
    const cutoff = cutoffForDays(criteria.timeWindowDays)
    const messageCutoff = cutoff ? sql.param(cutoff, copilotMessages.createdAt) : null

    return sql`
      SELECT DISTINCT
        u.id AS user_id,
        u.email,
        u.name,
        u.email_verified,
        u.banned,
        ${emailOptOutSql} AS unsubscribed,
        ${`Copilot chat context mentions ${term}`}::text AS reason
      FROM "user" u
      LEFT JOIN settings s ON s.user_id = u.id
      INNER JOIN copilot_chats cc ON cc.user_id = u.id
      INNER JOIN copilot_messages cm ON cm.chat_id = cc.id
      WHERE u.email IS NOT NULL
        AND u.email <> ''
        AND cc.deleted_at IS NULL
        AND cm.deleted_at IS NULL
        AND cm.role = 'user'
        AND lower(cm.content::text) LIKE ${pattern}
        ${messageCutoff ? sql`AND cm.created_at >= ${messageCutoff}` : sql``}
    `
  }

  const cutoff = cutoffForDays(criteria.timeWindowDays) ?? new Date(Date.now() - 30 * 86400000)
  const workflowCutoff = sql.param(cutoff, workflow.updatedAt)
  const messageCutoff = sql.param(cutoff, copilotMessages.createdAt)

  return sql`
    SELECT DISTINCT
      u.id AS user_id,
      u.email,
      u.name,
      u.email_verified,
      u.banned,
      ${emailOptOutSql} AS unsubscribed,
      ${`Active in the last ${criteria.timeWindowDays} days`}::text AS reason
    FROM "user" u
    LEFT JOIN settings s ON s.user_id = u.id
    WHERE u.email IS NOT NULL
      AND u.email <> ''
      AND (
        EXISTS (
          SELECT 1
          FROM workflow w
          WHERE w.user_id = u.id
            AND w.archived_at IS NULL
            AND (
              w.updated_at >= ${workflowCutoff}
              OR w.last_run_at >= ${workflowCutoff}
            )
        )
        OR EXISTS (
          SELECT 1
          FROM copilot_chats cc
          INNER JOIN copilot_messages cm ON cm.chat_id = cc.id
          WHERE cc.user_id = u.id
            AND cc.deleted_at IS NULL
            AND cm.deleted_at IS NULL
            AND cm.created_at >= ${messageCutoff}
        )
      )
  `
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10)
}

function rowToCandidate(row: CandidateRow): NewsletterAudienceCandidate {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    banned: row.banned ?? false,
    unsubscribed: row.unsubscribed,
    reason: row.reason,
  }
}

export async function getNewsletterAudienceCounts(
  criteria: NewsletterTargetingCriteria,
  source: 'primary' | 'replica' = 'replica'
): Promise<NewsletterAudienceCounts> {
  const client = source === 'primary' ? db : dbReplica
  const result = await client.execute<CountRow>(sql`
    WITH matched AS (${matchedUsersSql(criteria)})
    SELECT
      count(*)::int AS total_matched,
      count(*) FILTER (WHERE COALESCE(banned, false))::int AS excluded_banned,
      count(*) FILTER (WHERE NOT email_verified)::int AS excluded_unverified,
      count(*) FILTER (WHERE unsubscribed)::int AS excluded_unsubscribed,
      count(*) FILTER (
        WHERE email_verified = true
          AND COALESCE(banned, false) = false
          AND unsubscribed = false
      )::int AS final_recipient_count
    FROM matched
  `)
  const row = result[0]
  return {
    totalMatched: row ? toNumber(row.total_matched) : 0,
    excludedBanned: row ? toNumber(row.excluded_banned) : 0,
    excludedUnverified: row ? toNumber(row.excluded_unverified) : 0,
    excludedUnsubscribed: row ? toNumber(row.excluded_unsubscribed) : 0,
    excludedSuppressed: 0,
    finalRecipientCount: row ? toNumber(row.final_recipient_count) : 0,
  }
}

export async function getNewsletterAudiencePage(
  criteria: NewsletterTargetingCriteria,
  limit: number,
  afterUserId: string | null = null,
  marketableOnly = true,
  source: 'primary' | 'replica' = 'replica'
): Promise<NewsletterAudienceCandidate[]> {
  const client = source === 'primary' ? db : dbReplica
  const result = await client.execute<CandidateRow>(sql`
    WITH matched AS (${matchedUsersSql(criteria)})
    SELECT user_id, email, name, email_verified, banned, unsubscribed, reason
    FROM matched
    WHERE ${
      marketableOnly
        ? sql`
            email_verified = true
            AND COALESCE(banned, false) = false
            AND unsubscribed = false
          `
        : sql`true`
    }
      ${afterUserId ? sql`AND user_id > ${afterUserId}` : sql``}
    ORDER BY user_id ASC
    LIMIT ${limit}
  `)
  return result.map(rowToCandidate)
}

export async function getNewsletterAudiencePreview(
  criteria: NewsletterTargetingCriteria,
  source: 'primary' | 'replica' = 'replica'
) {
  const [counts, sample] = await Promise.all([
    getNewsletterAudienceCounts(criteria, source),
    getNewsletterAudiencePage(criteria, NEWSLETTER_PREVIEW_SAMPLE_LIMIT, null, true, source),
  ])
  return { counts, sample }
}
