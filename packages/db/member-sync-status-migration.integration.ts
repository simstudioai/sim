import { readFile } from 'node:fs/promises'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL

describe.runIf(Boolean(databaseUrl))('member sync status upgrade in PostgreSQL', () => {
  let admin: Sql
  let sql: Sql
  let migration: string
  const schema = `member_sync_status_${generateId().replaceAll('-', '')}`

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/(^|_)test(_|$)/.test(url.pathname.slice(1))
    ) {
      throw new Error('Member sync migration tests require a disposable local test database')
    }
    admin = postgres(url.toString(), { max: 1, onnotice: () => undefined })
    await admin.unsafe(`CREATE SCHEMA "${schema}"`)
    sql = postgres(url.toString(), {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
    const original = await readFile(
      new URL('./migrations/0319_permission_aware_knowledge.sql', import.meta.url),
      'utf8'
    )
    const table = original.match(
      /CREATE TABLE IF NOT EXISTS "knowledge_connector_member_sync_log" \([\s\S]*?\n\);/
    )?.[0]
    if (!table) throw new Error('Original member sync log table DDL was not found')
    await sql.unsafe(table)
    const mergedMigration = await readFile(
      new URL('./migrations/0380_mothership_staging_merge.sql', import.meta.url),
      'utf8'
    )
    const statusMigration = mergedMigration.match(
      /ALTER TABLE "knowledge_connector_member_sync_log"[\s\S]*?NOT VALID;/
    )?.[0]
    if (!statusMigration) throw new Error('Member sync status upgrade was not found')
    migration = statusMigration
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it('repairs partial completion after an account failure without losing run history', async () => {
    await sql`INSERT INTO knowledge_connector_member_sync_log
      (id, connector_id, status, members_claimed, members_failed)
      VALUES ('current', 'connector', 'started', 1, 1),
             ('history', 'connector', 'completed', 1, 0)`
    await expect(
      sql`UPDATE knowledge_connector_member_sync_log SET status = 'partial' WHERE id = 'current'`
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'kcmsl_status_check' })

    await sql.unsafe(migration)
    await sql`UPDATE knowledge_connector_member_sync_log SET status = 'partial' WHERE id = 'current'`
    await sql.unsafe(migration)
    expect(
      await sql`SELECT id, status, members_failed FROM knowledge_connector_member_sync_log ORDER BY id`
    ).toEqual([
      { id: 'current', status: 'partial', members_failed: 1 },
      { id: 'history', status: 'completed', members_failed: 0 },
    ])
    for (const status of ['started', 'completed', 'failed']) {
      await sql`INSERT INTO knowledge_connector_member_sync_log (id, connector_id, status)
        VALUES (${status}, 'connector', ${status})`
    }
    await expect(
      sql`INSERT INTO knowledge_connector_member_sync_log (id, connector_id, status)
        VALUES ('invalid', 'connector', 'unknown')`
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'kcmsl_status_check' })
  })
})
