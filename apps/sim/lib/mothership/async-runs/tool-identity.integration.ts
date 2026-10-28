/**
 * Exercises real repository queries against temporary PostgreSQL tables and,
 * when configured, the production confirmation/permission boundary over Redis.
 * Set TEST_DATABASE_URL to a local PostgreSQL database and
 * TEST_REDIS_URL to an isolated local Redis service.
 */
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import Redis from 'ioredis'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { database, redisState, databaseUrl, redisUrl } = await vi.hoisted(async () => {
  const { readTestDatabaseUrl, readTestRedisUrl } = await import(
    '@sim/db/testing/test-infrastructure'
  )
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
    _toolPermissionChannel?: { dispose(): void }
  }
  channels._toolConfirmationChannel?.dispose()
  channels._toolPermissionChannel?.dispose()
  channels._toolConfirmationChannel = undefined
  channels._toolPermissionChannel = undefined
  return {
    databaseUrl: readTestDatabaseUrl(),
    redisUrl: readTestRedisUrl(),
    database: { current: undefined as PostgresJsDatabase | undefined },
    redisState: { current: undefined as Redis | undefined },
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.select, database.current, args)
    },
    insert: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.insert, database.current, args)
    },
    update: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.update, database.current, args)
    },
    transaction: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.transaction, database.current, args)
    },
  },
}))
vi.mock('@/lib/mothership/request/otel', () => ({ markSpanForError: vi.fn() }))
vi.mock('@/lib/core/config/redis', () => ({
  getConfiguredRedisUrl: () => redisUrl,
  getRedisConnectionDefaults: () => ({}),
  getRedisClient: () => redisState.current,
}))

import { AsyncToolCallOwnershipError } from '@/lib/mothership/async-runs/errors'
import * as asyncRepository from '@/lib/mothership/async-runs/repository'
import {
  claimToolExecution,
  completeAsyncToolCall,
  getAsyncToolCall,
  recordToolPermissionDecision,
  replaceTerminalAsyncToolCallResult,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import {
  publishToolConfirmation,
  waitForToolConfirmation,
} from '@/lib/mothership/persistence/tool-confirm'
import {
  publishToolPermissionDecision,
  waitForToolPermissionDecision,
} from '@/lib/mothership/persistence/tool-permission'
import {
  createProviderToolCallIdentity,
  scopeProviderToolCallId,
} from '@/lib/mothership/request/go/tool-call-identity'

const connection = postgres(databaseUrl, { max: 1 })
const providerId = 'call_reused_fixture'
const legacyRunId = generateId()
const firstRunId = generateId()
const secondRunId = generateId()
const firstIdentity = createProviderToolCallIdentity(firstRunId)
const secondIdentity = createProviderToolCallIdentity(secondRunId)
const firstId = scopeProviderToolCallId(providerId, firstIdentity)
const secondId = scopeProviderToolCallId(providerId, secondIdentity)
const publishedIds = new Set<string>()

async function createCurrentCalls() {
  return Promise.all([
    upsertAsyncToolCall({ runId: firstRunId, toolCallId: firstId, toolName: 'glob' }),
    upsertAsyncToolCall({ runId: secondRunId, toolCallId: secondId, toolName: 'glob' }),
  ])
}

function publishCompletion(toolCallId: string, status: 'success' | 'error' | 'background') {
  publishedIds.add(toolCallId)
  publishToolConfirmation({ toolCallId, status })
}

afterAll(async () => {
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
    _toolPermissionChannel?: { dispose(): void }
  }
  channels._toolConfirmationChannel?.dispose()
  channels._toolPermissionChannel?.dispose()
  channels._toolConfirmationChannel = undefined
  channels._toolPermissionChannel = undefined
  if (redisState.current) {
    for (const id of publishedIds) {
      await redisState.current.del(`copilot:tool-confirmation:${id}`)
    }
    await redisState.current.quit()
  }
  await connection.end()
})

describe('Copilot tool identity with PostgreSQL', () => {
  beforeAll(async () => {
    database.current = drizzle(connection)
    await connection.unsafe(`
      CREATE TEMP TABLE copilot_async_tool_calls
        (LIKE public.copilot_async_tool_calls INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    `)
    await connection.unsafe(`
      CREATE TEMP TABLE copilot_runs
        (LIKE public.copilot_runs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    `)
    await connection`INSERT INTO copilot_runs (id, execution_id, chat_id, stream_id, user_id, tool_execution_version)
      VALUES (${firstRunId}, ${generateId()}, ${generateId()}, ${generateId()}, 'approval-user', 3)`
    if (redisUrl) {
      redisState.current = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
      await redisState.current.ping()
      await vi.waitFor(async () => {
        const counts = await redisState.current?.pubsub(
          'NUMSUB',
          'copilot:tool-confirmation',
          'copilot:tool-permission'
        )
        expect(Array.isArray(counts) ? [Number(counts[1]), Number(counts[3])] : []).toEqual([1, 1])
      })
    }
  })

  beforeEach(async () => {
    vi.restoreAllMocks()
    await connection.unsafe('TRUNCATE pg_temp.copilot_async_tool_calls')
    await connection`
      INSERT INTO copilot_async_tool_calls
        (run_id, tool_call_id, tool_name, status, result, created_at, updated_at)
      VALUES (${legacyRunId}, ${providerId}, 'browser_close_tab', 'completed',
        '{"legacy":true}'::jsonb, '2025-01-02 00:00:00', '2025-01-02 00:00:00')
    `
  })

  it('keeps repeated provider IDs independent and retries one run idempotently', async () => {
    const legacy = await getAsyncToolCall(providerId)
    const [first, second, ...retries] = await Promise.all([
      upsertAsyncToolCall({ runId: firstRunId, toolCallId: firstId, toolName: 'glob' }),
      upsertAsyncToolCall({ runId: secondRunId, toolCallId: secondId, toolName: 'glob' }),
      ...Array.from({ length: 4 }, () =>
        upsertAsyncToolCall({
          runId: firstRunId,
          toolCallId: scopeProviderToolCallId(providerId, firstIdentity),
          toolName: 'glob',
        })
      ),
    ])

    expect(first?.id).not.toBe(second?.id)
    expect(first?.runId).toBe(firstRunId)
    expect(second?.runId).toBe(secondRunId)
    expect(retries.every((row) => row?.id === first?.id)).toBe(true)
    expect(await getAsyncToolCall(providerId)).toEqual(legacy)
    const counts = await connection`SELECT count(*)::integer AS count FROM copilot_async_tool_calls`
    expect(counts[0].count).toBe(3)
  })

  it('refuses a conflicting owner without changing the existing legacy row', async () => {
    const legacy = await getAsyncToolCall(providerId)
    await expect(
      upsertAsyncToolCall({ runId: firstRunId, toolCallId: providerId, toolName: 'glob' })
    ).rejects.toBeInstanceOf(AsyncToolCallOwnershipError)
    expect(await getAsyncToolCall(providerId)).toEqual(legacy)
  })

  it.each([
    { operationVersion: 2, effect: 'read' as const, credentialId: 'account-one' },
    { operationVersion: 1, effect: 'write' as const, credentialId: 'account-one' },
    { operationVersion: 1, effect: 'read' as const, credentialId: 'account-two' },
    undefined,
  ])(
    'refuses a replay that changes or removes its Assistant authority: %j',
    async (assistantAction) => {
      const invocation = {
        runId: firstRunId,
        toolCallId: firstId,
        toolName: 'gmail_list_labels_v2',
        args: { credential: 'account-one' },
        assistantAction: {
          operationVersion: 1,
          effect: 'read' as const,
          credentialId: 'account-one',
        },
      }
      const original = await upsertAsyncToolCall(invocation)
      await expect(upsertAsyncToolCall({ ...invocation, assistantAction })).rejects.toBeInstanceOf(
        AsyncToolCallOwnershipError
      )
      expect(await getAsyncToolCall(firstId)).toEqual(original)
    }
  )

  it.each([
    { toolName: 'gmail_send', args: { to: 'review@example.test', body: 'Reviewed' } },
    { toolName: 'gmail_draft_v2', args: { to: 'other@example.test', body: 'Reviewed' } },
    { toolName: 'gmail_draft_v2', args: { to: 'review@example.test', body: 'Changed' } },
  ])('refuses a replay that changes the persisted proposal: $toolName $args', async (replay) => {
    const original = await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'gmail_draft_v2',
      args: { to: 'review@example.test', body: 'Reviewed' },
      permissionRequested: true,
    })
    await expect(
      upsertAsyncToolCall({ runId: firstRunId, toolCallId: firstId, ...replay })
    ).rejects.toBeInstanceOf(AsyncToolCallOwnershipError)
    expect(await getAsyncToolCall(firstId)).toEqual(original)
  })

  it('accepts an identical proposal replay regardless of JSON object key order', async () => {
    const original = await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'gmail_draft_v2',
      args: { to: 'review@example.test', message: { body: 'Reviewed', subject: 'Draft' } },
    })
    expect(
      await upsertAsyncToolCall({
        runId: firstRunId,
        toolCallId: firstId,
        toolName: 'gmail_draft_v2',
        args: { message: { subject: 'Draft', body: 'Reviewed' }, to: 'review@example.test' },
      })
    ).toEqual(original)
  })

  it('rejects a conflicting invocation that loses the first-insert race', async () => {
    const attempts = await Promise.allSettled(
      ['first@example.test', 'second@example.test'].map((to) =>
        upsertAsyncToolCall({
          runId: firstRunId,
          toolCallId: firstId,
          toolName: 'gmail_draft_v2',
          args: { to },
          permissionRequested: true,
        })
      )
    )
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find((attempt) => attempt.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(AsyncToolCallOwnershipError)
  })

  it.each([
    { executableName: 'other_operation', targetWorkspaceId: 'reviewed-workspace' },
    { executableName: 'reviewed_operation', targetWorkspaceId: 'other-workspace' },
  ])('refuses a replay that changes executable context: %j', async (replay) => {
    const original = await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'display_operation',
      executableName: 'reviewed_operation',
      targetWorkspaceId: 'reviewed-workspace',
      permissionRequested: true,
    })
    await expect(
      upsertAsyncToolCall({
        runId: firstRunId,
        toolCallId: firstId,
        toolName: 'display_operation',
        ...replay,
      })
    ).rejects.toBeInstanceOf(AsyncToolCallOwnershipError)
    expect(await getAsyncToolCall(firstId)).toEqual(original)
  })

  it.each([null, 'skip'] as const)(
    'cannot claim an unapproved or declined Sim action: %s',
    async (decision) => {
      await upsertAsyncToolCall({
        runId: firstRunId,
        toolCallId: firstId,
        toolName: 'gmail_draft_v2',
        args: { to: 'review@example.test' },
        permissionRequested: true,
      })
      if (decision) await recordToolPermissionDecision(firstId, decision)
      expect(
        await claimToolExecution({
          toolCallId: firstId,
          runId: firstRunId,
          userId: 'approval-user',
          ownerToken: generateId(),
        })
      ).toEqual({ outcome: 'awaiting_permission' })
      expect(await getAsyncToolCall(firstId)).toMatchObject({
        status: 'pending',
        executionStartedAt: null,
        executionAttempts: 0,
      })
    }
  )

  it('admits exactly one execution after a durable approval', async () => {
    await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'gmail_draft_v2',
      permissionRequested: true,
    })
    await recordToolPermissionDecision(firstId, 'allow')
    const claims = await Promise.all(
      Array.from({ length: 12 }, () =>
        claimToolExecution({
          toolCallId: firstId,
          runId: firstRunId,
          userId: 'approval-user',
          ownerToken: generateId(),
        })
      )
    )
    expect(claims.filter((claim) => claim.outcome === 'claimed')).toHaveLength(1)
    expect(await getAsyncToolCall(firstId)).toMatchObject({ executionAttempts: 1 })
  })

  it('never lets another actor consume an approved action', async () => {
    await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'gmail_draft_v2',
      permissionRequested: true,
    })
    await recordToolPermissionDecision(firstId, 'allow')
    await expect(
      claimToolExecution({
        toolCallId: firstId,
        runId: firstRunId,
        userId: 'another-user',
        ownerToken: generateId(),
      })
    ).rejects.toThrow('ownership is unavailable')
    expect(await getAsyncToolCall(firstId)).toMatchObject({
      status: 'pending',
      executionAttempts: 0,
    })
  })

  it('executes the winning approved edits while preserving the original proposal', async () => {
    const original = { issueKey: 'TEST-42', body: 'Proposed comment' }
    const edited = { issueKey: 'TEST-42', body: 'Reviewed comment' }
    await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'jira_add_comment',
      args: original,
      permissionRequested: true,
      executionRetryable: false,
    })
    const decisions = await Promise.all([
      recordToolPermissionDecision(firstId, 'allow', { approvedArgs: edited }),
      recordToolPermissionDecision(firstId, 'skip'),
    ])
    expect(decisions.filter(Boolean)).toHaveLength(1)
    const winner = decisions.find((decision) => decision !== null)
    const claim = await claimToolExecution({
      toolCallId: firstId,
      runId: firstRunId,
      userId: 'approval-user',
      ownerToken: generateId(),
    })
    if (winner?.permissionDecision === 'allow') {
      expect(claim).toMatchObject({
        outcome: 'claimed',
        invocation: { executableName: 'jira_add_comment', args: edited },
      })
    } else {
      expect(claim).toEqual({ outcome: 'awaiting_permission' })
    }
    expect((await getAsyncToolCall(firstId))?.args).toEqual(original)
  })

  it('never repeats an external write after its executor dies with an unknown outcome', async () => {
    await upsertAsyncToolCall({
      runId: firstRunId,
      toolCallId: firstId,
      toolName: 'gmail_draft_v2',
      executionRetryable: false,
      permissionRequested: true,
    })
    await recordToolPermissionDecision(firstId, 'allow')
    const owner = { toolCallId: firstId, runId: firstRunId, userId: 'approval-user' }
    expect(await claimToolExecution({ ...owner, ownerToken: generateId() })).toMatchObject({
      outcome: 'claimed',
    })
    await connection`UPDATE copilot_async_tool_calls
      SET execution_lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE tool_call_id = ${firstId}`
    expect(await claimToolExecution({ ...owner, ownerToken: generateId() })).toEqual({
      outcome: 'existing',
    })
    expect((await getAsyncToolCall(firstId))?.executionAttempts).toBe(1)
  })

  it('settles and replaces only the intended current run, preserving the legacy completion', async () => {
    const legacy = await getAsyncToolCall(providerId)
    await createCurrentCalls()
    await Promise.all([
      completeAsyncToolCall({ toolCallId: firstId, status: 'completed', result: { run: 'first' } }),
      completeAsyncToolCall({ toolCallId: secondId, status: 'failed', error: 'second failed' }),
    ])
    const second = await getAsyncToolCall(secondId)
    await replaceTerminalAsyncToolCallResult({
      toolCallId: firstId,
      status: 'completed',
      result: { projected: 'first' },
      error: null,
    })
    expect((await getAsyncToolCall(firstId))?.result).toEqual({ projected: 'first' })
    expect(await getAsyncToolCall(secondId)).toEqual(second)
    expect(await getAsyncToolCall(providerId)).toEqual(legacy)
    await expect(
      completeAsyncToolCall({ toolCallId: firstId, status: 'failed', error: 'late failure' })
    ).resolves.toBeNull()
  })

  it('allows only one projected receipt to replace the exact JSONB source across competing waiters', async () => {
    await createCurrentCalls()
    const source = { completion: 'sealed-source', context: { run: 'bound', user: 'bound' } }
    await completeAsyncToolCall({ toolCallId: firstId, status: 'completed', result: source })
    const receipts = [
      { __sealedClientToolProjectionV1: 'first-authenticated-projection' },
      { __sealedClientToolProjectionV1: 'second-authenticated-projection' },
    ]
    const attempts = await Promise.all(
      receipts.map((result) =>
        replaceTerminalAsyncToolCallResult({
          toolCallId: firstId,
          status: 'completed',
          error: null,
          result,
          expectedResult: { context: { user: 'bound', run: 'bound' }, completion: 'sealed-source' },
        })
      )
    )
    expect(attempts.filter(Boolean)).toHaveLength(1)
    const winner = attempts.find((row) => row !== null)
    expect((await getAsyncToolCall(firstId))?.result).toEqual(winner?.result)
    expect(
      await replaceTerminalAsyncToolCallResult({
        toolCallId: firstId,
        status: 'completed',
        result: { success: true },
        error: null,
        expectedResult: source,
      })
    ).toBeNull()
    expect((await getAsyncToolCall(firstId))?.result).toEqual(winner?.result)
  })

  describe.skipIf(!redisUrl)('with actual Redis confirmation and permission channels', () => {
    it('wakes only the matching waiter and reads its durable terminal result', async () => {
      await createCurrentCalls()
      const durableReads = vi.spyOn(asyncRepository, 'getAsyncToolCalls')
      const abort = new AbortController()
      let firstSettled = false
      const acceptStatus = (status: string) => status === 'success' || status === 'error'
      const first = waitForToolConfirmation(firstId, 5_000, abort.signal, { acceptStatus }).then(
        (result) => {
          firstSettled = true
          return result
        }
      )
      const second = waitForToolConfirmation(secondId, 5_000, abort.signal, { acceptStatus })
      try {
        expect(durableReads).toHaveBeenCalledTimes(2)
        await Promise.all(durableReads.mock.results.map((result) => result.value))
        await completeAsyncToolCall({
          toolCallId: secondId,
          status: 'completed',
          result: { run: 'second' },
        })
        publishCompletion(secondId, 'success')
        expect(await second).toMatchObject({ status: 'success', data: { run: 'second' } })
        expect(firstSettled).toBe(false)
        expect((await getAsyncToolCall(firstId))?.status).toBe('pending')

        await completeAsyncToolCall({
          toolCallId: firstId,
          status: 'completed',
          result: { run: 'first' },
        })
        publishCompletion(firstId, 'success')
        expect(await first).toMatchObject({ status: 'success', data: { run: 'first' } })
        await expect
          .poll(() => redisState.current?.get(`copilot:tool-confirmation:${firstId}`))
          .toBe(JSON.stringify({ toolCallId: firstId, status: 'success' }))
      } finally {
        abort.abort()
        await Promise.all([first, second])
      }
    })

    it('does not detach another run when a background signal arrives', async () => {
      await createCurrentCalls()
      const durableReads = vi.spyOn(asyncRepository, 'getAsyncToolCalls')
      const abort = new AbortController()
      let firstSettled = false
      const acceptStatus = (status: string) => status === 'background'
      const first = waitForToolConfirmation(firstId, 5_000, abort.signal, { acceptStatus }).then(
        (result) => {
          firstSettled = true
          return result
        }
      )
      const second = waitForToolConfirmation(secondId, 5_000, abort.signal, { acceptStatus })
      try {
        expect(durableReads).toHaveBeenCalledTimes(2)
        await Promise.all(durableReads.mock.results.map((result) => result.value))
        publishCompletion(secondId, 'background')
        expect(await second).toMatchObject({ status: 'background' })
        expect(firstSettled).toBe(false)
        expect((await getAsyncToolCall(firstId))?.status).toBe('pending')
      } finally {
        abort.abort()
        await Promise.all([first, second])
      }
    })

    it('does not authorize another run when a permission decision arrives', async () => {
      await createCurrentCalls()
      const durableReads = vi.spyOn(asyncRepository, 'getAsyncToolCall')
      const abort = new AbortController()
      let firstSettled = false
      const first = waitForToolPermissionDecision(firstId, 5_000, abort.signal).then((result) => {
        firstSettled = true
        return result
      })
      const second = waitForToolPermissionDecision(secondId, 5_000, abort.signal)
      try {
        expect(durableReads).toHaveBeenCalledTimes(2)
        await Promise.all(durableReads.mock.results.map((result) => result.value))
        await recordToolPermissionDecision(secondId, 'skip')
        publishToolPermissionDecision({ toolCallId: secondId, decision: 'skip' })
        expect(await second).toMatchObject({ toolCallId: secondId, decision: 'skip' })
        expect(firstSettled).toBe(false)
        expect((await getAsyncToolCall(firstId))?.permissionDecision).toBeNull()

        await recordToolPermissionDecision(firstId, 'allow')
        publishToolPermissionDecision({ toolCallId: firstId, decision: 'allow' })
        expect(await first).toMatchObject({ toolCallId: firstId, decision: 'allow' })
        expect((await getAsyncToolCall(secondId))?.permissionDecision).toBe('skip')
        expect((await getAsyncToolCall(providerId))?.permissionDecision).toBeNull()
      } finally {
        abort.abort()
        await Promise.all([first, second])
      }
    })
  })
})
