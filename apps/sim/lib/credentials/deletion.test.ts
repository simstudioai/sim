/**
 * @vitest-environment node
 *
 * Coverage for {@link deleteOrphanedOAuthAccount}, the single predicate standing
 * between a workspace-scoped admin disconnect and a cross-workspace OAuth grant
 * wipe. `credential.accountId` is `ON DELETE CASCADE`, so a guard that stops
 * matching takes every other workspace's credential row down with the grant.
 *
 * Every other suite mocks this function out (`orchestration/index.test.ts`,
 * `__tests__/service-account.test.ts`) and only asserts that it is *called*, so
 * dropping the `notExists` clause would leave the whole suite green. These tests
 * therefore run the real query builder and assert on the statement Postgres
 * receives: `drizzle-orm` and `@sim/db/schema` are un-mocked here (the global
 * mocks in `vitest.setup.ts` replace the operators with plain object literals,
 * which cannot express a subquery), and `@sim/db` is a `drizzle-orm/pg-proxy`
 * client whose driver captures the compiled statement and replays the rows
 * Postgres would return for the scenario under test.
 */
import { drizzle } from 'drizzle-orm/pg-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { capturedQueries, driverRows, mockLogger } = vi.hoisted(() => ({
  capturedQueries: [] as { sql: string; params: unknown[] }[],
  driverRows: { value: [] as unknown[] },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')

vi.mock('@sim/logger', () => ({ createLogger: () => mockLogger }))

vi.mock('@sim/db', () => ({
  db: drizzle(async (sql: string, params: unknown[]) => {
    capturedQueries.push({ sql, params })
    return { rows: driverRows.value }
  }),
}))

import { deleteOrphanedOAuthAccount } from '@/lib/credentials/deletion'

const ACCOUNT_ID = 'acct-bob-google'

/** Collapses whitespace so assertions read against a stable, single-line statement. */
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function onlyQuery(): { sql: string; params: unknown[] } {
  expect(capturedQueries).toHaveLength(1)
  const query = capturedQueries[0]
  return { sql: normalizeSql(query.sql), params: query.params }
}

/** The `not exists (...)` guard body, i.e. everything the subquery constrains on. */
function guardSubquery(sql: string): string {
  const match = /not exists \((.*)\)/.exec(sql)
  if (!match) throw new Error(`statement has no "not exists" reference guard: ${sql}`)
  return match[1]
}

describe('deleteOrphanedOAuthAccount', () => {
  beforeEach(() => {
    capturedQueries.length = 0
    driverRows.value = []
    vi.clearAllMocks()
  })

  it('guards the account delete with a reference check against the credential table', async () => {
    await deleteOrphanedOAuthAccount(ACCOUNT_ID)

    const { sql, params } = onlyQuery()

    expect(sql).toContain('delete from "account"')
    expect(sql).toContain('"account"."id" = $1')
    expect(sql).toContain('returning "id"')

    const subquery = guardSubquery(sql)
    expect(subquery).toContain('from "credential"')
    expect(subquery).toContain('"credential"."account_id" = $2')
    expect(subquery).not.toContain('workspace_id')

    expect(params).toEqual([ACCOUNT_ID, ACCOUNT_ID])
  })

  it('keys the reference check on account_id alone and reports nothing when it matches no row', async () => {
    /**
     * The row matching itself is Postgres's, not this harness's — the driver
     * replays the empty RETURNING that a surviving workspace-B `credential` row
     * would produce, and the statement carries what makes that row visible: the
     * subquery is keyed on `account_id` alone. A `workspace_id` filter would hide
     * every other workspace's reference and turn an intra-workspace admin
     * disconnect into a cross-workspace grant wipe.
     */
    driverRows.value = []

    await deleteOrphanedOAuthAccount(ACCOUNT_ID)

    expect(guardSubquery(onlyQuery().sql)).not.toContain('workspace_id')
    expect(mockLogger.info).not.toHaveBeenCalled()
  })

  it('deletes a genuinely orphaned account', async () => {
    driverRows.value = [{ id: ACCOUNT_ID }]

    await deleteOrphanedOAuthAccount(ACCOUNT_ID)

    expect(onlyQuery().sql).toContain('returning "id"')
    expect(mockLogger.info).toHaveBeenCalledWith('Deleted orphaned OAuth account', {
      accountId: ACCOUNT_ID,
    })
  })

  it('does not scope the account delete by owner, so an admin can disconnect a teammate grant', async () => {
    /**
     * PR #6737 exists so a workspace admin can disconnect another member's OAuth
     * credential. An `account.user_id = <actor>` predicate would fail that case
     * closed and strand a live grant nothing can reap, so the reference count —
     * not ownership — is deliberately the only guard. A legacy reference that
     * addresses the grant by raw `account.id` is covered by the same count
     * WHENEVER a `workflowId` pins the workspace: `authorizeCredentialUseForAuth`
     * then resolves it only through a `credential` row in that workspace, and any
     * such row keeps `not exists` false. It is not covered when `scopeWorkspaceId`
     * is null — that path falls through to an owner-only lookup that reads
     * `account` directly (`lib/auth/credential-access.ts`), which no `credential`
     * row backs and this count therefore cannot see.
     */
    await deleteOrphanedOAuthAccount(ACCOUNT_ID)

    const { sql } = onlyQuery()
    expect(sql).not.toContain('user_id')
    expect(sql).not.toContain('provider_id')
  })
})
