import { db } from '@sim/db'
import {
  peopleDirectoryEntry as entry,
  organization,
  scimConnection,
  peopleDirectorySync as sync,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, expect, it, vi } from 'vitest'
import { syncDueDirectories } from '@/lib/people/sync/runner'

vi.hoisted(() => {
  vi.stubEnv('PEOPLE', 'true')
  vi.stubEnv('SCIM_ENABLED', 'true')
})
afterAll(() => vi.unstubAllEnvs())

it('continues the directory sweep when the first organization cannot claim its lease', async () => {
  const ids = [generateId(), generateId(), generateId()]
  const [blocked] = ids
  const constraint = sql.identifier(`reject_claim_${generateId()}`)
  try {
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        const connection = generateId()
        await tx
          .insert(organization)
          .values({ id, name: 'Sweep fixture', slug: id, createdAt: new Date() })
        await tx.insert(scimConnection).values({ id: connection, organizationId: id })
        await tx.insert(sync).values({
          organizationId: id,
          source: 'scim',
          sourceTarget: connection,
          nextSyncAt: new Date(i * 1000),
        })
        await tx.insert(entry).values({
          id: generateId(),
          organizationId: id,
          source: 'scim',
          externalId: 'retired',
          email: 'retired@example.test',
          name: 'Retired',
        })
      }
      await tx.execute(
        sql`ALTER TABLE ${sync} ADD CONSTRAINT ${constraint}
          CHECK (organization_id <> ${blocked} OR lease_token IS NULL) NOT VALID`.inlineParams()
      )
    })

    await syncDueDirectories()
    const remaining = await db
      .select({ id: entry.organizationId })
      .from(entry)
      .where(inArray(entry.organizationId, ids))
    expect(remaining).toEqual([{ id: blocked }])
    const [unchanged] = await db
      .select({
        token: sync.leaseToken,
        run: sync.runId,
        success: sync.lastSuccessAt,
      })
      .from(sync)
      .where(eq(sync.organizationId, blocked))
    expect(unchanged).toEqual({ token: null, run: null, success: null })
  } finally {
    await db.execute(sql`ALTER TABLE ${sync} DROP CONSTRAINT IF EXISTS ${constraint}`)
    await db.delete(organization).where(inArray(organization.id, ids))
  }
})
