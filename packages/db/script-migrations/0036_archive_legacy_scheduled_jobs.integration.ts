import { archiveLegacyScheduledJobs } from '@sim/db/script-migrations/0036_archive_legacy_scheduled_jobs'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = readTestDatabaseUrl()

/** Copies the schedule table into an isolated disposable schema; no public rows are touched. */
describe('archiving legacy scheduled jobs in PostgreSQL', () => {
  let sql: Sql
  let admin: Sql
  const schemaName = `legacy_jobs_${generateId().replaceAll('-', '')}`

  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await admin.unsafe(
      `CREATE TABLE "${schemaName}"."workflow_schedule" (LIKE public."workflow_schedule" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`
    )
    sql = postgres(databaseUrl, {
      max: 2,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await admin.end()
    }
  })

  beforeEach(async () => {
    await sql`TRUNCATE workflow_schedule`
  })

  async function schedule(
    sourceType: 'job' | 'workflow',
    status: 'active' | 'disabled' | 'completed' = 'active',
    archivedAt: Date | null = null
  ) {
    const id = generateId()
    await sql`INSERT INTO workflow_schedule (id, trigger_type, source_type, status, archived_at, next_run_at, prompt)
      VALUES (${id}, 'schedule', ${sourceType}, ${status}, ${archivedAt}, now(), 'legacy prompt')`
    return id
  }

  async function stored(id: string) {
    const [row] = await sql<{ status: string; archived_at: Date | null }[]>`
      SELECT status, archived_at FROM workflow_schedule WHERE id = ${id}`
    return row
  }

  it('archives every unarchived job across many batches, leaving workflow schedules alone', async () => {
    const jobs = await Promise.all(Array.from({ length: 7 }, () => schedule('job')))
    const completed = await schedule('job', 'completed')
    const workflowSchedule = await schedule('workflow')
    const archivedAt = new Date('2026-08-04T00:00:00Z')
    const alreadyArchived = await schedule('job', 'disabled', archivedAt)
    /** Read as text on both sides: a timestamp without zone round-trips through the local zone. */
    const archivedAtText = async () =>
      (
        await sql<{ at: string }[]>`
          SELECT archived_at::text AS at FROM workflow_schedule WHERE id = ${alreadyArchived}`
      )[0].at
    const archivedBefore = await archivedAtText()

    expect(await archiveLegacyScheduledJobs(sql, 2)).toBe(8)

    for (const id of jobs) {
      expect(await stored(id)).toMatchObject({ status: 'disabled', archived_at: expect.any(Date) })
    }
    expect(await stored(completed)).toMatchObject({
      status: 'completed',
      archived_at: expect.any(Date),
    })
    expect(await stored(workflowSchedule)).toEqual({ status: 'active', archived_at: null })
    expect(await archivedAtText()).toBe(archivedBefore)
    const [{ due }] = await sql<{ due: number }[]>`
      SELECT count(*)::int AS due FROM workflow_schedule
      WHERE source_type = 'job' AND archived_at IS NULL`
    expect(due).toBe(0)
  })

  it('is a no-op when re-run after it finished, and when there is nothing to archive', async () => {
    await schedule('job')
    expect(await archiveLegacyScheduledJobs(sql)).toBe(1)
    expect(await archiveLegacyScheduledJobs(sql)).toBe(0)
    await sql`TRUNCATE workflow_schedule`
    expect(await archiveLegacyScheduledJobs(sql)).toBe(0)
  })
})
