import { db } from '@sim/db'
import { organization, peopleDirectoryEntry, peopleDirectorySync } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import { publishStagedSnapshot } from '@/lib/people/sync/projection'
import {
  pendingManagers,
  type StageRun,
  stageRelationships,
  stageUsers,
} from '@/lib/people/sync/stage'
import type { DirectoryPerson } from '@/lib/people/sync/types'

let run: StageRun
const person = (id: string, managerExternalId: string | null = null): DirectoryPerson => ({
  externalId: id,
  email: `${id}@example.test`,
  name: id,
  managerExternalId,
  title: null,
  location: null,
  department: null,
})
const published = () =>
  db
    .select()
    .from(peopleDirectoryEntry)
    .where(eq(peopleDirectoryEntry.organizationId, run.organizationId))
beforeEach(async () => {
  run = { organizationId: generateId(), runId: generateId() }
  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: run.organizationId,
      slug: run.organizationId,
      name: 'Staged sync test',
      createdAt: new Date(),
    })
    await tx.insert(peopleDirectorySync).values({
      ...run,
      source: 'okta',
      sourceTarget: 'example.okta.com',
      phase: 'publish',
    })
  })
})
afterEach(async () => {
  await db.delete(organization).where(eq(organization.id, run.organizationId))
})
const writeUsers = (cursor: string | null, people: DirectoryPerson[]) =>
  db.transaction((tx) => stageUsers(tx, run, cursor, people))
function publish(tx: DbTransaction) {
  return publishStagedSnapshot(tx, run, 'okta')
}

it('atomically publishes a complete generation, preserving existing IDs and removing departed people', async () => {
  await writeUsers(null, [person('lead'), person('departed')])
  await db.transaction(publish)
  const first = await published()
  const lead = first.find((row) => row.externalId === 'lead')
  expect(lead?.id).toBeTruthy()
  run = { ...run, runId: generateId() }
  await db
    .update(peopleDirectorySync)
    .set({ runId: run.runId })
    .where(eq(peopleDirectorySync.organizationId, run.organizationId))
  await writeUsers(null, [person('report', 'lead')])
  expect((await published()).map((p) => p.id).sort()).toEqual(first.map((p) => p.id).sort())
  await writeUsers('later', [{ ...person('lead', 'missing'), name: 'Renamed' }])
  await db.transaction(publish)
  expect(
    (await published())
      .map((p) => ({ id: p.externalId, manager: p.managerExternalId, name: p.name }))
      .sort((a, b) => a.id.localeCompare(b.id))
  ).toEqual([
    { id: 'lead', manager: null, name: 'Renamed' },
    { id: 'report', manager: 'lead', name: 'report' },
  ])
  expect((await published()).find((p) => p.externalId === 'lead')?.id).toBe(lead?.id)
})
it('rejects repeated cursors, IDs, and emails across pages without publishing a partial directory', async () => {
  await writeUsers(null, [person('stable')])
  await db.transaction(publish)
  await writeUsers('page-2', [person('next')])
  await expect(writeUsers('page-2', [person('intruder')])).rejects.toThrow(/page|cursor/i)
  await expect(
    writeUsers('page-3', [{ ...person('stable'), email: 'other@example.test' }])
  ).rejects.toThrow(/unique|repeated|duplicate/i)
  await expect(
    writeUsers('page-3', [{ ...person('case-variant'), email: ' STABLE@EXAMPLE.TEST ' }])
  ).rejects.toThrow(/unique|repeated|duplicate/i)
  expect((await published()).map((p) => p.externalId)).toEqual(['stable'])
})
it('refuses cyclic components, including cycles outside otherwise publishable trees', async () => {
  await writeUsers(null, [person('root')])
  await db.transaction(publish)
  await writeUsers('next', [person('one', 'two'), person('two', 'one')])
  await expect(db.transaction(publish)).rejects.toThrow(/loop|cycle/i)
  expect((await published()).map((p) => p.externalId)).toEqual(['root'])
})
it('resumes relationship pages from stored continuations, refuses incomplete Graph data, and keeps the latest manager read', async () => {
  await db
    .update(peopleDirectorySync)
    .set({ source: 'entra' })
    .where(eq(peopleDirectorySync.organizationId, run.organizationId))
  await writeUsers(null, [person('lead'), person('worker'), person('other'), person('peer')])
  await expect(db.transaction((tx) => publishStagedSnapshot(tx, run, 'entra'))).rejects.toThrow(
    /relationship|report/i
  )
  const record = (
    managerId: string,
    cursor: string | null,
    reportIds: string[],
    nextCursor: string | null
  ) =>
    db.transaction((tx) =>
      stageRelationships(tx, run, [{ managerId, cursor, reportIds, nextCursor }])
    )
  await record('lead', null, ['offboarded'], 'continuation')
  expect(await pendingManagers(db, run)).toContainEqual({
    managerId: 'lead',
    cursor: 'continuation',
  })
  await record('lead', 'continuation', ['worker'], null)
  await record('other', null, ['worker'], null)
  await db.transaction((tx) =>
    stageRelationships(tx, run, [
      { managerId: 'worker', cursor: null, reportIds: ['other'], nextCursor: null },
      { managerId: 'peer', cursor: null, reportIds: ['other'], nextCursor: null },
    ])
  )
  expect(await pendingManagers(db, run)).toEqual([])
  await db.transaction((tx) => publishStagedSnapshot(tx, run, 'entra'))
  const managers = new Map((await published()).map((r) => [r.externalId, r.managerExternalId]))
  expect(managers.get('worker')).toBe('other')
  expect(managers.get('other')).toBe('peer')
})
it('refuses to publish a replaced generation', async () => {
  await writeUsers(null, [person('live')])
  await db.transaction(publish)
  await db
    .update(peopleDirectorySync)
    .set({ source: 'scim', runId: generateId() })
    .where(eq(peopleDirectorySync.organizationId, run.organizationId))
  await writeUsers('next', [person('stale')])
  await expect(db.transaction((tx) => publishStagedSnapshot(tx, run, 'scim'))).rejects.toThrow(
    /generation/i
  )
  expect((await published()).map((p) => p.externalId)).toEqual(['live'])
})
it('publishes a 12,000-person reporting chain', async () => {
  await db.execute(sql`INSERT INTO people_directory_stage (organization_id,run_id,external_id,proposed_id,email,name,manager_external_id)
    SELECT ${run.organizationId},${run.runId},n::text,${run.runId}||'-'||n,n||'@example.test','User '||n,CASE WHEN n>1 THEN (n-1)::text END
    FROM generate_series(1,12000) n`)
  await db.transaction(publish)
  const [count] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM people_directory_entry WHERE organization_id=${run.organizationId}`
  )
  expect(count.n).toBe(12_000)
})
