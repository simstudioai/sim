import { db } from '@sim/db'
import {
  newsletterAudienceRecipients,
  newsletterAudienceRuns,
  settings,
  user,
} from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq, getTableColumns, gt, inArray, lt, ne, or, sql } from 'drizzle-orm'
import {
  type NewsletterRecipientSyncStatus,
  type NewsletterRun,
  type NewsletterTargetingCriteria,
  newsletterTargetingCriteriaSchema,
} from '@/lib/api/contracts/newsletters'
import { getResendExcludedEmails } from '@/lib/newsletters/resend'
import {
  classifyNewsletterPrompt,
  getNewsletterAudiencePage,
  getNewsletterAudiencePreview,
  NEWSLETTER_FINALIZE_PAGE_SIZE,
  NEWSLETTER_FINALIZE_SAFETY_CAP,
  NEWSLETTER_PREVIEW_SAMPLE_LIMIT,
  type NewsletterAudienceCandidate,
  type NewsletterAudienceCounts,
} from '@/lib/newsletters/targeting'
import { formatCsvValue, toCsvRow } from '@/lib/table/export-format'

type NewsletterRunRow = typeof newsletterAudienceRuns.$inferSelect

interface CreateNewsletterRunInput {
  name: string
  prompt: string
  createdById: string
}

interface FinalizeResult {
  run: NewsletterRun
  oversized: boolean
}

interface NewsletterResendAttempt {
  attempt: number
  jobId: string | null
  run: NewsletterRun
  shouldEnqueue: boolean
}

const NEWSLETTER_FINALIZATION_STALE_MS = 30 * 60 * 1000
const simMarketingOptOutSql = sql<boolean>`
  (
    COALESCE((${settings.emailPreferences}->>'unsubscribeAll')::boolean, false)
    OR COALESCE((${settings.emailPreferences}->>'unsubscribeMarketing')::boolean, false)
  )
`
const currentUserEligibleSql = sql<boolean>`
  (
    ${user.emailVerified} = true
    AND COALESCE(${user.banned}, false) = false
  )
`

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

function parseCriteria(criteria: unknown): NewsletterTargetingCriteria {
  return newsletterTargetingCriteriaSchema.parse(criteria)
}

function parseSampleRecipients(value: unknown): NewsletterRun['sampleRecipients'] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      if (typeof record.userId !== 'string' || typeof record.email !== 'string') return null
      return {
        userId: record.userId,
        email: record.email,
        name: typeof record.name === 'string' ? record.name : null,
        reason: typeof record.reason === 'string' ? record.reason : '',
      }
    })
    .filter((entry): entry is NewsletterRun['sampleRecipients'][number] => Boolean(entry))
}

export function serializeNewsletterRun(row: NewsletterRunRow): NewsletterRun {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    criteria: parseCriteria(row.criteria),
    status: row.status as NewsletterRun['status'],
    counts: {
      totalMatched: row.totalMatched,
      excludedBanned: row.excludedBanned,
      excludedUnverified: row.excludedUnverified,
      excludedUnsubscribed: row.excludedUnsubscribed,
      excludedSuppressed: row.excludedSuppressed,
      finalRecipientCount: row.finalRecipientCount,
    },
    sampleRecipients: parseSampleRecipients(row.sampleRecipients),
    resendSegmentId: row.resendSegmentId,
    resendSegmentName: row.resendSegmentName,
    resendSyncedAt: iso(row.resendSyncedAt),
    resendSyncJobId: row.resendSyncJobId,
    error: row.error,
    finalizedAt: iso(row.finalizedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getNewsletterRun(id: string): Promise<NewsletterRun | null> {
  const [row] = await db
    .select()
    .from(newsletterAudienceRuns)
    .where(eq(newsletterAudienceRuns.id, id))
    .limit(1)
  return row ? serializeNewsletterRun(row) : null
}

export async function requireNewsletterRun(id: string): Promise<NewsletterRun> {
  const run = await getNewsletterRun(id)
  if (!run) throw new Error('Newsletter run not found')
  return run
}

export async function listNewsletterRuns(limit: number, offset: number) {
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(newsletterAudienceRuns)
      .orderBy(desc(newsletterAudienceRuns.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(newsletterAudienceRuns),
  ])

  return {
    runs: rows.map(serializeNewsletterRun),
    total: totalRows[0]?.total ?? 0,
  }
}

function sampleFromCandidates(candidates: NewsletterAudienceCandidate[]) {
  return candidates.map((candidate) => ({
    userId: candidate.userId,
    email: candidate.email,
    name: candidate.name,
    reason: candidate.reason,
  }))
}

function inclusionReason(value: unknown): string {
  if (!value || typeof value !== 'object' || !('reason' in value)) return ''
  return String((value as { reason?: unknown }).reason ?? '')
}

async function sampleFromSnapshot(
  runId: string,
  snapshotVersion: number
): Promise<NewsletterRun['sampleRecipients']> {
  const rows = await db
    .select({
      userId: newsletterAudienceRecipients.userId,
      email: newsletterAudienceRecipients.email,
      name: newsletterAudienceRecipients.name,
      inclusionReason: newsletterAudienceRecipients.inclusionReason,
    })
    .from(newsletterAudienceRecipients)
    .where(
      and(
        eq(newsletterAudienceRecipients.runId, runId),
        eq(newsletterAudienceRecipients.snapshotVersion, snapshotVersion)
      )
    )
    .orderBy(newsletterAudienceRecipients.email)
    .limit(NEWSLETTER_PREVIEW_SAMPLE_LIMIT)

  return rows.flatMap((row) =>
    row.userId
      ? [
          {
            userId: row.userId,
            email: row.email,
            name: row.name,
            reason: inclusionReason(row.inclusionReason),
          },
        ]
      : []
  )
}

export async function createNewsletterRun({
  name,
  prompt,
  createdById,
}: CreateNewsletterRunInput): Promise<NewsletterRun> {
  const criteria = classifyNewsletterPrompt(prompt)
  const preview = await getNewsletterAudiencePreview(criteria)
  const now = new Date()
  const [row] = await db
    .insert(newsletterAudienceRuns)
    .values({
      id: generateId(),
      createdById,
      name,
      prompt,
      criteria,
      status: 'draft',
      totalMatched: preview.counts.totalMatched,
      excludedBanned: preview.counts.excludedBanned,
      excludedUnverified: preview.counts.excludedUnverified,
      excludedUnsubscribed: preview.counts.excludedUnsubscribed,
      excludedSuppressed: 0,
      finalRecipientCount: preview.counts.finalRecipientCount,
      sampleRecipients: sampleFromCandidates(preview.sample),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return serializeNewsletterRun(row)
}

function lowerEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function insertRecipientChunk(
  runId: string,
  candidates: NewsletterAudienceCandidate[],
  suppressedEmails: Set<string>,
  seenEmails: Set<string>,
  snapshotVersion: number
): Promise<{ inserted: number; suppressed: number }> {
  let suppressed = 0
  const now = new Date()
  const values: (typeof newsletterAudienceRecipients.$inferInsert)[] = []

  for (const candidate of candidates) {
    const email = lowerEmail(candidate.email)
    if (!email || seenEmails.has(email)) continue
    seenEmails.add(email)
    if (suppressedEmails.has(email)) {
      suppressed++
      continue
    }
    values.push({
      id: generateId(),
      runId,
      snapshotVersion,
      userId: candidate.userId,
      email,
      name: candidate.name,
      inclusionReason: { reason: candidate.reason },
      resendStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    })
  }

  if (values.length > 0) {
    await db.insert(newsletterAudienceRecipients).values(values).onConflictDoNothing()
  }

  return { inserted: values.length, suppressed }
}

export async function finalizeNewsletterRun(id: string): Promise<FinalizeResult> {
  const staleBefore = new Date(Date.now() - NEWSLETTER_FINALIZATION_STALE_MS)
  const [claimed] = await db
    .update(newsletterAudienceRuns)
    .set({
      status: 'finalizing',
      snapshotVersion: sql`${newsletterAudienceRuns.snapshotVersion} + 1`,
      updatedAt: new Date(),
      error: null,
    })
    .where(
      and(
        eq(newsletterAudienceRuns.id, id),
        or(
          eq(newsletterAudienceRuns.status, 'draft'),
          and(
            eq(newsletterAudienceRuns.status, 'finalizing'),
            lt(newsletterAudienceRuns.updatedAt, staleBefore)
          )
        )
      )
    )
    .returning()

  if (!claimed) {
    const [current] = await db
      .select()
      .from(newsletterAudienceRuns)
      .where(eq(newsletterAudienceRuns.id, id))
      .limit(1)
    if (!current) throw new Error('Newsletter run not found')
    if (current.status === 'finalizing') {
      throw new Error('Newsletter audience finalization is already in progress')
    }
    return { run: serializeNewsletterRun(current), oversized: current.status === 'oversized' }
  }

  const snapshotVersion = claimed.snapshotVersion
  try {
    const criteria = parseCriteria(claimed.criteria)
    const [preview, suppressedEmails] = await Promise.all([
      getNewsletterAudiencePreview(criteria, 'primary'),
      getResendExcludedEmails(),
    ])
    const seenEmails = new Set<string>()
    let inserted = 0
    let suppressed = 0
    let afterUserId: string | null = null
    let scanned = 0

    while (scanned <= NEWSLETTER_FINALIZE_SAFETY_CAP) {
      const pageLimit = Math.min(
        NEWSLETTER_FINALIZE_PAGE_SIZE,
        NEWSLETTER_FINALIZE_SAFETY_CAP + 1 - scanned
      )
      const candidates = await getNewsletterAudiencePage(
        criteria,
        pageLimit,
        afterUserId,
        true,
        'primary'
      )
      if (candidates.length === 0) break
      const result = await insertRecipientChunk(
        id,
        candidates,
        suppressedEmails,
        seenEmails,
        snapshotVersion
      )
      inserted += result.inserted
      suppressed += result.suppressed
      scanned += candidates.length
      afterUserId = candidates.at(-1)?.userId ?? afterUserId
      if (scanned > NEWSLETTER_FINALIZE_SAFETY_CAP || candidates.length < pageLimit) break
    }

    if (scanned > NEWSLETTER_FINALIZE_SAFETY_CAP) {
      await db
        .delete(newsletterAudienceRecipients)
        .where(
          and(
            eq(newsletterAudienceRecipients.runId, id),
            eq(newsletterAudienceRecipients.snapshotVersion, snapshotVersion)
          )
        )
      const [oversized] = await db
        .update(newsletterAudienceRuns)
        .set({
          status: 'oversized',
          totalMatched: preview.counts.totalMatched,
          excludedBanned: preview.counts.excludedBanned,
          excludedUnverified: preview.counts.excludedUnverified,
          excludedUnsubscribed: preview.counts.excludedUnsubscribed,
          excludedSuppressed: suppressed,
          finalRecipientCount: 0,
          sampleRecipients: [],
          updatedAt: new Date(),
          error: `Audience exceeds the ${NEWSLETTER_FINALIZE_SAFETY_CAP} recipient safety limit; create a narrower run`,
        })
        .where(
          and(
            eq(newsletterAudienceRuns.id, id),
            eq(newsletterAudienceRuns.status, 'finalizing'),
            eq(newsletterAudienceRuns.snapshotVersion, snapshotVersion)
          )
        )
        .returning()
      if (!oversized) throw new Error('Newsletter finalization was superseded')
      return { run: serializeNewsletterRun(oversized), oversized: true }
    }

    const counts: NewsletterAudienceCounts = {
      ...preview.counts,
      excludedSuppressed: suppressed,
      finalRecipientCount: inserted,
    }
    const snapshotSample = await sampleFromSnapshot(id, snapshotVersion)
    const now = new Date()
    const [updated] = await db
      .update(newsletterAudienceRuns)
      .set({
        status: 'finalized',
        totalMatched: counts.totalMatched,
        excludedBanned: counts.excludedBanned,
        excludedUnverified: counts.excludedUnverified,
        excludedUnsubscribed: counts.excludedUnsubscribed,
        excludedSuppressed: counts.excludedSuppressed,
        finalRecipientCount: counts.finalRecipientCount,
        sampleRecipients: snapshotSample,
        finalizedAt: now,
        updatedAt: now,
        error: null,
      })
      .where(
        and(
          eq(newsletterAudienceRuns.id, id),
          eq(newsletterAudienceRuns.status, 'finalizing'),
          eq(newsletterAudienceRuns.snapshotVersion, snapshotVersion)
        )
      )
      .returning()

    if (!updated) throw new Error('Newsletter finalization was superseded')
    await db
      .delete(newsletterAudienceRecipients)
      .where(
        and(
          eq(newsletterAudienceRecipients.runId, id),
          ne(newsletterAudienceRecipients.snapshotVersion, snapshotVersion)
        )
      )
    return { run: serializeNewsletterRun(updated), oversized: false }
  } catch (error) {
    await db
      .delete(newsletterAudienceRecipients)
      .where(
        and(
          eq(newsletterAudienceRecipients.runId, id),
          eq(newsletterAudienceRecipients.snapshotVersion, snapshotVersion)
        )
      )
    await db
      .update(newsletterAudienceRuns)
      .set({
        status: 'draft',
        error: getErrorMessage(error, 'Newsletter finalization failed'),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(newsletterAudienceRuns.id, id),
          eq(newsletterAudienceRuns.status, 'finalizing'),
          eq(newsletterAudienceRuns.snapshotVersion, snapshotVersion)
        )
      )
    throw error
  }
}

export async function claimNewsletterRunResendAttempt(
  runId: string
): Promise<NewsletterResendAttempt> {
  const [claimed] = await db
    .update(newsletterAudienceRuns)
    .set({
      status: 'pushing',
      resendSyncAttempt: sql`${newsletterAudienceRuns.resendSyncAttempt} + 1`,
      resendSyncJobId: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRuns.id, runId),
        inArray(newsletterAudienceRuns.status, ['finalized', 'failed'])
      )
    )
    .returning()

  if (claimed) {
    return {
      attempt: claimed.resendSyncAttempt,
      jobId: null,
      run: serializeNewsletterRun(claimed),
      shouldEnqueue: true,
    }
  }

  const [current] = await db
    .select()
    .from(newsletterAudienceRuns)
    .where(eq(newsletterAudienceRuns.id, runId))
    .limit(1)
  if (!current) throw new Error('Newsletter run not found')
  if (current.status === 'pushed') {
    return {
      attempt: current.resendSyncAttempt,
      jobId: current.resendSyncJobId,
      run: serializeNewsletterRun(current),
      shouldEnqueue: current.resendSyncJobId === null,
    }
  }
  if (current.status === 'pushing') {
    return {
      attempt: current.resendSyncAttempt,
      jobId: current.resendSyncJobId,
      run: serializeNewsletterRun(current),
      shouldEnqueue: current.resendSyncJobId === null,
    }
  }
  throw new Error('Finalize the newsletter audience before pushing to Resend')
}

export async function setNewsletterRunResendJob(runId: string, attempt: number, jobId: string) {
  const [updated] = await db
    .update(newsletterAudienceRuns)
    .set({
      resendSyncJobId: jobId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRuns.id, runId),
        eq(newsletterAudienceRuns.resendSyncAttempt, attempt),
        inArray(newsletterAudienceRuns.status, ['pushing', 'failed', 'pushed'])
      )
    )
    .returning()
  if (!updated) throw new Error('Newsletter Resend enqueue attempt was superseded')
  return serializeNewsletterRun(updated)
}

export async function markNewsletterRunPushFailed(runId: string, attempt: number, error: unknown) {
  await db
    .update(newsletterAudienceRuns)
    .set({
      status: 'failed',
      error: getErrorMessage(error, 'Newsletter push failed'),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRuns.id, runId),
        eq(newsletterAudienceRuns.resendSyncAttempt, attempt),
        inArray(newsletterAudienceRuns.status, ['pushing', 'failed'])
      )
    )
}

export async function markNewsletterRunPushed(
  runId: string,
  attempt: number,
  segmentId: string,
  segmentName: string
) {
  await db
    .update(newsletterAudienceRuns)
    .set({
      status: 'pushed',
      resendSegmentId: segmentId,
      resendSegmentName: segmentName,
      resendSyncedAt: new Date(),
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRuns.id, runId),
        eq(newsletterAudienceRuns.resendSyncAttempt, attempt),
        inArray(newsletterAudienceRuns.status, ['pushing', 'failed'])
      )
    )
}

export async function setNewsletterRunResendSegment(
  runId: string,
  attempt: number,
  segmentId: string,
  segmentName: string
) {
  await db
    .update(newsletterAudienceRuns)
    .set({
      resendSegmentId: segmentId,
      resendSegmentName: segmentName,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRuns.id, runId),
        eq(newsletterAudienceRuns.resendSyncAttempt, attempt)
      )
    )
}

const NEWSLETTER_CSV_PAGE_SIZE = 1000

async function* generateNewsletterCsvLines(
  runId: string,
  runSnapshotVersion: number,
  resendExcludedEmails: Set<string>
): AsyncGenerator<string> {
  yield toCsvRow(['email', 'first_name', 'last_name', 'sim_user_id', 'inclusion_reason'])

  let afterEmail: string | null = null
  while (true) {
    const conditions = [
      eq(newsletterAudienceRecipients.runId, runId),
      eq(newsletterAudienceRecipients.snapshotVersion, runSnapshotVersion),
      currentUserEligibleSql,
      sql`lower(${user.email}) = ${newsletterAudienceRecipients.email}`,
      sql`${simMarketingOptOutSql} = false`,
    ]
    if (afterEmail) conditions.push(gt(newsletterAudienceRecipients.email, afterEmail))

    const rows = await db
      .select({
        email: newsletterAudienceRecipients.email,
        name: newsletterAudienceRecipients.name,
        userId: newsletterAudienceRecipients.userId,
        inclusionReason: newsletterAudienceRecipients.inclusionReason,
      })
      .from(newsletterAudienceRecipients)
      .innerJoin(user, eq(user.id, newsletterAudienceRecipients.userId))
      .leftJoin(settings, eq(settings.userId, newsletterAudienceRecipients.userId))
      .where(and(...conditions))
      .orderBy(newsletterAudienceRecipients.email)
      .limit(NEWSLETTER_CSV_PAGE_SIZE)

    for (const row of rows) {
      if (resendExcludedEmails.has(lowerEmail(row.email))) continue
      const [firstName, ...rest] = (row.name ?? '').trim().split(/\s+/).filter(Boolean)
      const reason = inclusionReason(row.inclusionReason)
      yield toCsvRow([
        formatCsvValue(row.email),
        formatCsvValue(firstName ?? ''),
        formatCsvValue(rest.join(' ')),
        formatCsvValue(row.userId ?? ''),
        formatCsvValue(reason),
      ])
    }

    if (rows.length < NEWSLETTER_CSV_PAGE_SIZE) break
    afterEmail = rows.at(-1)?.email ?? afterEmail
  }
}

export async function createNewsletterCsvExport(
  runId: string
): Promise<{ filename: string; lines: AsyncGenerator<string> }> {
  const run = await requireNewsletterRun(runId)
  if (!['finalized', 'pushing', 'pushed', 'failed'].includes(run.status)) {
    throw new Error('Finalize the newsletter audience before exporting CSV')
  }

  const [row] = await db
    .select({ snapshotVersion: newsletterAudienceRuns.snapshotVersion })
    .from(newsletterAudienceRuns)
    .where(eq(newsletterAudienceRuns.id, runId))
    .limit(1)
  if (!row) throw new Error('Newsletter run not found')
  const resendExcludedEmails = await getResendExcludedEmails()

  return {
    filename: `newsletter-${run.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${run.id.slice(0, 8)}.csv`,
    lines: generateNewsletterCsvLines(runId, row.snapshotVersion, resendExcludedEmails),
  }
}

export async function countNewsletterRecipientsByStatus(runId: string) {
  const [run] = await db
    .select({ snapshotVersion: newsletterAudienceRuns.snapshotVersion })
    .from(newsletterAudienceRuns)
    .where(eq(newsletterAudienceRuns.id, runId))
    .limit(1)
  if (!run) throw new Error('Newsletter run not found')

  const rows = await db
    .select({
      status: newsletterAudienceRecipients.resendStatus,
      total: count(),
    })
    .from(newsletterAudienceRecipients)
    .where(
      and(
        eq(newsletterAudienceRecipients.runId, runId),
        eq(newsletterAudienceRecipients.snapshotVersion, run.snapshotVersion)
      )
    )
    .groupBy(newsletterAudienceRecipients.resendStatus)

  return Object.fromEntries(rows.map((row) => [row.status, row.total]))
}

export async function updateRecipientSyncStatus(
  runId: string,
  snapshotVersion: number,
  email: string,
  status: NewsletterRecipientSyncStatus,
  options?: { contactId?: string; error?: string | null }
) {
  await db
    .update(newsletterAudienceRecipients)
    .set({
      resendStatus: status,
      resendContactId: options?.contactId,
      error: options?.error ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRecipients.runId, runId),
        eq(newsletterAudienceRecipients.snapshotVersion, snapshotVersion),
        eq(newsletterAudienceRecipients.email, email)
      )
    )
}

export async function getPendingNewsletterRecipients(runId: string, limit: number) {
  const [run] = await db
    .select({ snapshotVersion: newsletterAudienceRuns.snapshotVersion })
    .from(newsletterAudienceRuns)
    .where(eq(newsletterAudienceRuns.id, runId))
    .limit(1)
  if (!run) throw new Error('Newsletter run not found')

  return db
    .select({
      ...getTableColumns(newsletterAudienceRecipients),
      simUnsubscribed: simMarketingOptOutSql,
      currentUserEligible: sql<boolean>`
        (
          ${user.id} IS NOT NULL
          AND ${currentUserEligibleSql}
          AND lower(${user.email}) = ${newsletterAudienceRecipients.email}
        )
      `,
    })
    .from(newsletterAudienceRecipients)
    .leftJoin(user, eq(user.id, newsletterAudienceRecipients.userId))
    .leftJoin(settings, eq(settings.userId, newsletterAudienceRecipients.userId))
    .where(
      and(
        eq(newsletterAudienceRecipients.runId, runId),
        eq(newsletterAudienceRecipients.snapshotVersion, run.snapshotVersion),
        eq(newsletterAudienceRecipients.resendStatus, 'pending')
      )
    )
    .orderBy(newsletterAudienceRecipients.email)
    .limit(limit)
}

export async function resetFailedNewsletterRecipients(runId: string) {
  const [run] = await db
    .select({ snapshotVersion: newsletterAudienceRuns.snapshotVersion })
    .from(newsletterAudienceRuns)
    .where(eq(newsletterAudienceRuns.id, runId))
    .limit(1)
  if (!run) throw new Error('Newsletter run not found')

  await db
    .update(newsletterAudienceRecipients)
    .set({
      resendStatus: 'pending',
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterAudienceRecipients.runId, runId),
        eq(newsletterAudienceRecipients.snapshotVersion, run.snapshotVersion),
        eq(newsletterAudienceRecipients.resendStatus, 'failed')
      )
    )
}

export async function requireNewsletterRunAttempt(runId: string, attempt: number) {
  const [row] = await db
    .select()
    .from(newsletterAudienceRuns)
    .where(
      and(
        eq(newsletterAudienceRuns.id, runId),
        eq(newsletterAudienceRuns.resendSyncAttempt, attempt)
      )
    )
    .limit(1)
  if (!row) throw new Error('Newsletter Resend sync attempt was superseded')
  return serializeNewsletterRun(row)
}
