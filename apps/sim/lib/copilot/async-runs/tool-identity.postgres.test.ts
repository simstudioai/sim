/**
 * @vitest-environment node
 *
 * Exercises real repository queries against temporary PostgreSQL tables and,
 * when configured, the production confirmation/permission boundary over Redis.
 * Set COPILOT_IDENTITY_TEST_DATABASE_URL to a local PostgreSQL database and
 * COPILOT_IDENTITY_TEST_REDIS_URL to an isolated local Redis service.
 */
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import Redis from 'ioredis'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { database, redisState, databaseUrl, redisUrl } = vi.hoisted(() => {
  const databaseUrl = process.env.COPILOT_IDENTITY_TEST_DATABASE_URL
  const redisUrl = process.env.COPILOT_IDENTITY_TEST_REDIS_URL
  for (const value of [databaseUrl, redisUrl]) {
    if (value && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('Copilot identity integration tests require local services')
    }
  }
  const channels = globalThis as typeof globalThis & {
    _toolConfirmationChannel?: { dispose(): void }
    _toolPermissionChannel?: { dispose(): void }
  }
  channels._toolConfirmationChannel?.dispose()
  channels._toolPermissionChannel?.dispose()
  channels._toolConfirmationChannel = undefined
  channels._toolPermissionChannel = undefined
  return {
    databaseUrl,
    redisUrl: databaseUrl ? redisUrl : undefined,
    database: { current: undefined as PostgresJsDatabase | undefined },
    redisState: { current: undefined as Redis | undefined },
  }
})

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.unmock('ioredis')
vi.unmock('@/lib/events/pubsub')
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
  },
}))
vi.mock('@/lib/copilot/request/otel', () => ({ markSpanForError: vi.fn() }))
vi.mock('@/lib/core/config/redis', () => ({
  getConfiguredRedisUrl: () => redisUrl,
  getRedisConnectionDefaults: () => ({}),
  getRedisClient: () => redisState.current,
}))

import { AsyncToolCallOwnershipError } from '@/lib/copilot/async-runs/errors'
import * as asyncRepository from '@/lib/copilot/async-runs/repository'
import {
  completeAsyncToolCall,
  getAsyncToolCall,
  recordToolPermissionDecision,
  replaceTerminalAsyncToolCallResult,
  upsertAsyncToolCall,
} from '@/lib/copilot/async-runs/repository'
import {
  publishToolConfirmation,
  waitForToolConfirmation,
} from '@/lib/copilot/persistence/tool-confirm'
import {
  publishToolPermissionDecision,
  waitForToolPermissionDecision,
} from '@/lib/copilot/persistence/tool-permission'
import {
  createProviderToolCallIdentity,
  scopeProviderToolCallId,
} from '@/lib/copilot/request/go/tool-call-identity'

const connection = databaseUrl ? postgres(databaseUrl, { max: 1 }) : undefined
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
  await connection?.end()
})

describe.skipIf(!databaseUrl)('Copilot tool identity with PostgreSQL', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    database.current = drizzle(connection)
    await connection.unsafe(`
      CREATE TEMP TABLE copilot_async_tool_calls (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id uuid NOT NULL, checkpoint_id uuid,
        tool_call_id text NOT NULL UNIQUE, tool_name text NOT NULL,
        args jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'pending',
        result jsonb, error text, permission_decision text, permission_decided_at timestamp,
        claimed_at timestamp, claimed_by text, completed_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
      )
    `)
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
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
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
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
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
