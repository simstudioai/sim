import { permissionAccessRequest } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CursorKey } from '@/lib/api/list-query'
import type { DbOrTx } from '@/lib/db/types'
import { listAccessRequestRecords } from '@/ee/access-requests/lib/repository'

const databaseUrl = readTestDatabaseUrl()

async function createFixture() {
  const schema = `access_search_${generateId().replaceAll('-', '')}`
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  await client.unsafe(`CREATE SCHEMA "${schema}"`)
  await client.unsafe(`SET search_path TO "${schema}"`)
  await client.unsafe(`
    CREATE TABLE "user" (id text PRIMARY KEY, name text, email text);
    CREATE TABLE permission_access_request (
      id text PRIMARY KEY, organization_id text, workspace_id text, requester_id text,
      target jsonb DEFAULT '{"kind":"feature","configKey":"hideTablesTab"}',
      target_label text, reason text DEFAULT '', status text, decision_reason text,
      created_at timestamp DEFAULT now(), decided_at timestamp, group_name text
    );
    INSERT INTO "user" VALUES
      ('one', 'Alex Example', 'alex@example.com'),
      ('two', 'Jamie Example', 'jamie@example.com');
    INSERT INTO permission_access_request (id, organization_id, requester_id, target_label, status) VALUES
      ('a', 'org', 'one', 'Tables', 'pending'),
      ('b', 'org', 'two', 'Tables', 'pending'),
      ('c', 'org', 'one', 'Tables', 'fulfilled'),
      ('d', 'other', 'one', 'Tables', 'pending'),
      ('e', 'org', 'two', '100%_complete', 'pending'),
      ('f', 'org', 'one', '100percent-complete', 'pending');
  `)
  return {
    executor: drizzle(client) as DbOrTx,
    async cleanup() {
      try {
        await client.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
      } finally {
        await client.end()
      }
    },
  }
}

describe('organization request search on PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>
  beforeAll(async () => {
    fixture = await createFixture()
  })
  afterAll(async () => {
    await fixture?.cleanup()
  })

  const where = and(
    eq(permissionAccessRequest.organizationId, 'org'),
    eq(permissionAccessRequest.status, 'pending')
  )!

  it('searches before pagination and keeps totals scoped to the organization and status', async () => {
    const first = await listAccessRequestRecords(fixture.executor, where, 1, 0, '  TABLES  ')
    expect(first.requests.map((request) => request.id)).toEqual(['b'])
    expect(first.total).toBe(2)
    expect(first.hasMore).toBe(true)
    const second = await listAccessRequestRecords(fixture.executor, where, 1, 1, 'tables')
    expect(second.requests.map((request) => request.id)).toEqual(['a'])
    expect(second.total).toBe(2)
    expect(second.hasMore).toBe(false)
  })

  it.each(['Alex', 'ALEX@EXAMPLE.COM'])(
    'matches requester name or email with %s without broadening access',
    async (search) => {
      const result = await listAccessRequestRecords(fixture.executor, where, 25, 0, search)
      expect(result.requests.map((request) => request.id)).toEqual(['f', 'a'])
      expect(result.total).toBe(2)
    }
  )

  it('treats SQL wildcard characters literally and supports clearing search', async () => {
    const result = await listAccessRequestRecords(fixture.executor, where, 25, 0, '%_')
    expect(result.requests.map((request) => request.id)).toEqual(['e'])
    expect(result.total).toBe(1)
    const cleared = await listAccessRequestRecords(fixture.executor, where, 25, 0, '   ')
    expect(cleared.total).toBe(4)
    const missing = await listAccessRequestRecords(fixture.executor, where, 25, 0, 'missing')
    expect(missing).toEqual({ requests: [], total: 0, hasMore: false })
  })

  it.each([
    ['createdAt', 'asc'],
    ['createdAt', 'desc'],
    ['targetLabel', 'asc'],
    ['targetLabel', 'desc'],
  ] as const)(
    'pages %s %s across tied values without repeats or omissions',
    async (sortBy, sortOrder) => {
      const expected = await listAccessRequestRecords(fixture.executor, where, 100, 0, undefined, {
        sortBy,
        sortOrder,
      })
      const ids: string[] = []
      let cursorKeys: CursorKey[] | undefined
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        const page = await listAccessRequestRecords(
          fixture.executor,
          where,
          pageNumber === 0 ? 1 : 2,
          0,
          undefined,
          { sortBy, sortOrder, cursorKeys }
        )
        ids.push(...page.requests.map(({ id }) => id))
        expect(page.total).toBe(4)
        if (!page.nextCursorKeys) break
        cursorKeys = page.nextCursorKeys
      }
      expect(ids).toEqual(expected.requests.map(({ id }) => id))
      expect(new Set(ids).size).toBe(4)
    }
  )

  it('rejects invalid timestamp cursor values before PostgreSQL', async () => {
    await expect(
      listAccessRequestRecords(fixture.executor, where, 1, 0, undefined, {
        sortBy: 'createdAt',
        sortOrder: 'desc',
        cursorKeys: ['not-a-date', 'a'],
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
