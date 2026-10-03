/**
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
 *
 * Credential-reference scans also use the real query builder to verify that
 * workspace filtering stays inside a materialized boundary before JSON search.
 */
import { drizzle } from 'drizzle-orm/pg-proxy'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { capturedQueries, driverRows } = vi.hoisted(() => ({
  capturedQueries: [] as { sql: string; params: unknown[] }[],
  driverRows: { value: [] as unknown[] },
}))

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')

vi.mock('@sim/db', () => ({
  db: drizzle(async (sql: string, params: unknown[]) => {
    capturedQueries.push({ sql, params })
    return { rows: driverRows.value }
  }),
}))

import {
  clearCredentialInValue,
  clearCredentialRefs,
  deleteOrphanedOAuthAccount,
} from '@/lib/credentials/deletion'

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

beforeEach(() => {
  capturedQueries.length = 0
  driverRows.value = []
})

describe('deleteOrphanedOAuthAccount', () => {
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

describe('clearCredentialRefs', () => {
  const sources = [
    ['workflow_blocks', 'sub_blocks'],
    ['workflow_deployment_version', 'state'],
    ['paused_executions', 'execution_snapshot'],
    ['workflow_checkpoints', 'workflow_state'],
  ] as const

  it('scopes every snapshot scan before converting JSON to text, including archived workflows', async () => {
    await clearCredentialRefs('credential-target', 'workspace-target')

    const reads = capturedQueries.filter((query) => normalizeSql(query.sql).startsWith('WITH'))
    expect(reads).toHaveLength(sources.length)
    for (const [table, column] of sources) {
      const query = reads.find((query) => query.sql.includes(`FROM "${table}"`))
      expect(query).toBeDefined()
      const statement = normalizeSql(query!.sql)
      expect(statement).toContain(
        `WITH workspace_credential_refs AS MATERIALIZED ( SELECT "${table}"."id" AS id, "${table}"."${column}" AS value FROM "${table}" INNER JOIN "workflow" ON "workflow"."id" = "${table}"."workflow_id" WHERE "workflow"."workspace_id" = $1 ) SELECT id, value FROM workspace_credential_refs WHERE value::text LIKE $2`
      )
      expect(statement).not.toContain('deleted_at')
      expect(query!.params).toEqual(['workspace-target', '%credential-target%'])
    }
  })

  it('clears matching references returned by every raw scan and preserves other values', async () => {
    driverRows.value = [
      {
        id: 'snapshot-target',
        value: {
          blocks: [{ id: 'credential', value: 'credential-target' }],
          params: { credential: 'credential-target', other: 'credential-other' },
          name: 'credential-target',
        },
      },
      { id: 'substring-only', value: { name: 'credential-target' } },
    ]

    await clearCredentialRefs('credential-target', 'workspace-target')

    for (const [table] of sources) {
      const updates = capturedQueries.filter((query) => query.sql.startsWith(`update "${table}"`))
      expect(updates).toHaveLength(1)
      expect(JSON.parse(updates[0].params[0] as string)).toEqual({
        blocks: [{ id: 'credential', value: '' }],
        params: { credential: '', other: 'credential-other' },
        name: 'credential-target',
      })
      expect(updates[0].params.at(-1)).toBe('snapshot-target')
    }
  })

  it('leaves a connector whose credential is removed unscheduled with the reconnect error', async () => {
    await clearCredentialRefs('credential-target', {
      kind: 'organization',
      organizationId: 'organization-target',
    })

    const updates = capturedQueries.filter((query) =>
      query.sql.startsWith('update "knowledge_connector"')
    )
    expect(updates).toHaveLength(2)
    const statement = normalizeSql(updates[0].sql)
    expect(statement).toContain('"credential_id" = $')
    expect(statement).toContain('"last_sync_error" = $')
    expect(statement).toContain('"next_sync_at" = $')
    expect(statement).toContain('"sync_lock_token" = $')
    expect(statement).toContain('"sync_lock_lease_at" = $')
    expect(statement).toContain(
      `CASE WHEN "knowledge_connector"."status" IN ('paused', 'disabled')`
    )
    expect(statement).toContain('"access_mode" in ($')
    expect(statement).toContain('"encrypted_api_key" is null')
    expect(updates[0].params).toEqual(
      expect.arrayContaining([
        'Credential removed. Reconnect the connector to resume syncing.',
        'credential-target',
        'workspace',
        'admin',
      ])
    )
    const rest = normalizeSql(updates[1].sql)
    expect(rest).toContain('"credential_id" = $')
    expect(rest).not.toContain('"last_sync_error"')
    expect(updates[1].params).toEqual(expect.arrayContaining([null, 'credential-target']))
  })
})

describe('clearCredentialInValue', () => {
  const TARGET = 'cred_target123'
  const OTHER = 'cred_other999'

  it('clears matching subBlock value with id="credential"', () => {
    const input = { id: 'credential', type: 'oauth-input', value: TARGET }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    expect(result.value).toEqual({ id: 'credential', type: 'oauth-input', value: '' })
  })

  it('leaves unrelated subBlock value untouched', () => {
    const input = { id: 'someOtherField', value: TARGET }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('leaves matching subBlock with non-matching value untouched', () => {
    const input = { id: 'credential', value: OTHER }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('clears nested tools[].params.credential', () => {
    const input = {
      id: 'tools',
      value: [
        { type: 'gmail_send', params: { credential: TARGET, to: 'a@b.com' } },
        { type: 'slack_message', params: { credential: OTHER, channel: '#x' } },
      ],
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as { value: Array<{ params: { credential: string } }> }
    expect(value.value[0].params.credential).toBe('')
    expect(value.value[1].params.credential).toBe(OTHER)
  })

  it('walks workflow_blocks-style keyed subBlocks structure', () => {
    const input = {
      credential: { id: 'credential', value: TARGET },
      messages: { id: 'messages', value: 'hello' },
      tools: {
        id: 'tools',
        value: [{ type: 'x', params: { credential: TARGET } }],
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as typeof input
    expect(value.credential.value).toBe('')
    expect(value.messages.value).toBe('hello')
    expect(value.tools.value[0].params.credential).toBe('')
  })

  it('walks deployment-style nested blocks structure', () => {
    const input = {
      blocks: {
        block1: {
          subBlocks: {
            credential: { id: 'credential', value: TARGET },
          },
        },
        block2: {
          subBlocks: {
            other: { id: 'other', value: 'unrelated' },
          },
        },
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as typeof input
    expect(value.blocks.block1.subBlocks.credential.value).toBe('')
    expect(value.blocks.block2.subBlocks.other.value).toBe('unrelated')
  })

  it('clears params.credential string directly even when not nested in tools', () => {
    const input = { params: { credential: TARGET, channel: '#x' } }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    expect((result.value as typeof input).params).toEqual({ credential: '', channel: '#x' })
  })

  it('does not match "credential" key when value is a different string', () => {
    const input = { credential: 'cred_unrelated' }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(input)
  })

  it('clears multiple references in a single pass', () => {
    const input = {
      blocks: {
        a: { subBlocks: { credential: { id: 'credential', value: TARGET } } },
        b: { subBlocks: { triggerCredentials: { id: 'triggerCredentials', value: TARGET } } },
        c: {
          subBlocks: {
            tools: {
              id: 'tools',
              value: [{ params: { credential: TARGET } }, { params: { credential: TARGET } }],
            },
          },
        },
      },
    }
    const result = clearCredentialInValue(input, TARGET)
    expect(result.changed).toBe(true)
    const value = result.value as typeof input
    expect(value.blocks.a.subBlocks.credential.value).toBe('')
    expect(value.blocks.b.subBlocks.triggerCredentials.value).toBe('')
    expect(value.blocks.c.subBlocks.tools.value[0].params.credential).toBe('')
    expect(value.blocks.c.subBlocks.tools.value[1].params.credential).toBe('')
  })
})
