import { peopleDirectoryPage, peopleDirectoryStage as stage } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { normalizeEmail } from '@sim/utils/string'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { GRAPH_BATCH_SIZE, MAX_REPORTS_PER_PAGE } from '@/lib/people/sync/limits'
import type { DirectoryPerson } from '@/lib/people/sync/types'

export interface StageRun {
  organizationId: string
  runId: string
}

interface RelationshipPage {
  managerId: string
  cursor: string | null
  reportIds: readonly string[]
  nextCursor: string | null
}

const MAX_USERS_PER_PAGE = 1000
const emailSchema = z.email().max(320)

function runPredicate(run: StageRun) {
  return and(eq(stage.organizationId, run.organizationId), eq(stage.runId, run.runId))
}

async function rememberPages(tx: DbTransaction, run: StageRun, hashes: string[]) {
  const inserted = await tx
    .insert(peopleDirectoryPage)
    .values(
      hashes.map((pageHash) => ({ organizationId: run.organizationId, runId: run.runId, pageHash }))
    )
    .onConflictDoNothing()
    .returning({ pageHash: peopleDirectoryPage.pageHash })
  if (inserted.length !== hashes.length)
    throw new OrchestrationError(
      'validation',
      'The directory repeated a pagination cursor. Restart the sync.'
    )
}

/** Inserts one fetched page in the same fenced transaction that advances its checkpoint. */
export async function stageUsers(
  tx: DbTransaction,
  run: StageRun,
  cursor: string | null,
  people: readonly DirectoryPerson[]
) {
  if (people.length > MAX_USERS_PER_PAGE)
    throw new OrchestrationError(
      'validation',
      'The directory returned too many people in a single page.'
    )
  const rows = people.map((person) => {
    const email = normalizeEmail(person.email)
    if (!emailSchema.safeParse(email).success)
      throw new OrchestrationError(
        'validation',
        'Each directory user needs a valid email address. Correct the source and sync again.'
      )
    if (!person.externalId.trim() || person.externalId.length > 512)
      throw new OrchestrationError(
        'validation',
        'The directory returned an invalid user ID. Correct the source and sync again.'
      )
    return {
      ...person,
      organizationId: run.organizationId,
      runId: run.runId,
      proposedId: generateId(),
      email,
      name: person.name.trim() || email,
    }
  })
  await rememberPages(tx, run, [sha256Hex(JSON.stringify(['users', cursor]))])
  if (!rows.length) return
  try {
    await tx.insert(stage).values(rows)
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505')
      throw new OrchestrationError(
        'validation',
        'The directory returned a repeated user ID or email address. Each directory account must have a unique ID and email.'
      )
    throw error
  }
}

/** At most one Graph batch, ordered across retries, including each manager's unfinished page. */
export async function pendingManagers(executor: DbOrTx, run: StageRun) {
  return executor
    .select({ managerId: stage.externalId, cursor: stage.reportsCursor })
    .from(stage)
    .where(and(runPredicate(run), sql`NOT ${stage.reportsComplete}`))
    .orderBy(stage.externalId)
    .limit(GRAPH_BATCH_SIZE)
}

/**
 * Commits only completed subrequests and rejects a cursor replay. Graph gives a person one
 * manager, so a person claimed again was moved during a read that spans many slices: a later
 * batch overwrites an earlier one, and publication's cycle check still guards the finished
 * graph. Reads inside one batch are concurrent, so a claim repeated there resolves to the
 * lowest manager ID, independent of response order.
 */
export async function stageRelationships(
  tx: DbTransaction,
  run: StageRun,
  pages: readonly RelationshipPage[]
) {
  if (!pages.length) return
  if (
    pages.length > GRAPH_BATCH_SIZE ||
    pages.some((page) => page.reportIds.length > MAX_REPORTS_PER_PAGE)
  ) {
    throw new OrchestrationError(
      'validation',
      'The directory returned too many reporting relationships in a single batch.'
    )
  }
  await rememberPages(
    tx,
    run,
    pages.map((page) => sha256Hex(JSON.stringify(['relationships', page.managerId, page.cursor])))
  )
  const checkpoints = await tx.execute<{ id: string }>(sql`
    UPDATE ${stage} s SET reports_cursor = p."nextCursor", reports_complete = (p."nextCursor" IS NULL)
    FROM jsonb_to_recordset(${JSON.stringify(pages.map(({ managerId, cursor, nextCursor }) => ({ managerId, cursor, nextCursor })))}::text::jsonb)
      AS p("managerId" text,cursor text,"nextCursor" text)
    WHERE s.organization_id = ${run.organizationId} AND s.run_id = ${run.runId}
      AND s.external_id = p."managerId" AND NOT s.reports_complete AND s.reports_cursor IS NOT DISTINCT FROM p.cursor
    RETURNING s.external_id AS id
  `)
  if (checkpoints.length !== pages.length)
    throw new OrchestrationError(
      'conflict',
      'The directory relationship page no longer matches its checkpoint.'
    )
  await tx.execute(sql`
    WITH claims AS (
      SELECT p."managerId" AS manager, jsonb_array_elements_text(p."reportIds") AS report
      FROM jsonb_to_recordset(${JSON.stringify(pages.map(({ managerId, reportIds }) => ({ managerId, reportIds })))}::text::jsonb)
        AS p("managerId" text,"reportIds" jsonb)
    ), assignments AS (
      SELECT c.report AS external_id, min(c.manager) AS manager FROM claims c GROUP BY c.report
    )
    UPDATE ${stage} s SET manager_external_id = a.manager FROM assignments a
    WHERE s.organization_id = ${run.organizationId} AND s.run_id = ${run.runId} AND s.external_id = a.external_id
  `)
}

/** Clears private pages and rows on reset, replacement, or completion with the organization's sync row locked. */
export async function discardStage(tx: DbTransaction, organizationId: string) {
  await tx.delete(peopleDirectoryPage).where(eq(peopleDirectoryPage.organizationId, organizationId))
  await tx.delete(stage).where(eq(stage.organizationId, organizationId))
}
