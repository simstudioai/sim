/**
 * Re-derives a turn's secret authority from real `copilot_runs` rows in a temporary PostgreSQL
 * table. Set TEST_DATABASE_URL to a local PostgreSQL database.
 */
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { database, databaseUrl } = await vi.hoisted(async () => {
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  return {
    databaseUrl: readTestDatabaseUrl(),
    database: { current: undefined as PostgresJsDatabase | undefined },
  }
})

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.select, database.current, args)
    },
  },
}))
vi.mock('@/lib/mothership/request/otel', () => ({ markSpanForError: vi.fn() }))

import { getRunSecretAuthority } from '@/lib/mothership/async-runs/repository'
import { NO_SECRET_AUTHORITY } from '@/lib/mothership/secret-mount-policy'

const connection = postgres(databaseUrl, { max: 1 })
const userId = 'user-secret-authority'
const chatId = generateId()

async function insertRun(streamId: string, requestContext: unknown, owner = userId) {
  await connection`
    INSERT INTO copilot_runs (execution_id, chat_id, user_id, stream_id, request_context)
    VALUES (${generateId()}, ${chatId}, ${owner}, ${streamId},
      ${JSON.stringify(requestContext)}::jsonb)
  `
}

function interactiveContext(mode?: string) {
  return {
    controllerToken: 'lease',
    recovery: {
      kind: 'interactive_stream',
      request: { message: 'hi', userId, chatId, ...(mode ? { mode } : {}) },
      goRoute: '/api/copilot',
      clientToolPickupExpected: true,
    },
  }
}

afterAll(async () => {
  await connection.end()
})

describe('getRunSecretAuthority with PostgreSQL', () => {
  beforeAll(async () => {
    database.current = drizzle(connection)
    await connection.unsafe(`
      CREATE TEMP TABLE copilot_runs
        (LIKE public.copilot_runs INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
    `)
  })

  beforeEach(async () => {
    await connection.unsafe('TRUNCATE pg_temp.copilot_runs')
  })

  it("returns a headless run's recorded authority, including a refused actor", async () => {
    await insertRun('stream-inbox', {
      source: 'headless_lifecycle',
      secretAuthority: {
        secretMountPolicy: { secretScope: 'selected', mountedSecrets: ['STRIPE_KEY'] },
        secretActorUserId: null,
      },
    })

    await expect(
      getRunSecretAuthority({ streamId: 'stream-inbox', userId, chatId })
    ).resolves.toEqual({
      secretMountPolicy: { secretScope: 'selected', mountedSecrets: ['STRIPE_KEY'] },
      secretActorUserId: null,
    })
  })

  it('gives an interactive agent turn every secret, as the turn user', async () => {
    await insertRun('stream-agent', interactiveContext())
    await insertRun('stream-build', interactiveContext('build'))

    for (const streamId of ['stream-agent', 'stream-build']) {
      await expect(getRunSecretAuthority({ streamId, userId, chatId })).resolves.toEqual({
        secretMountPolicy: { secretScope: 'all', mountedSecrets: [] },
        secretActorUserId: userId,
      })
    }
  })

  it('gives an interactive assistant turn no secrets', async () => {
    await insertRun('stream-assistant', interactiveContext('assistant'))

    await expect(
      getRunSecretAuthority({ streamId: 'stream-assistant', userId, chatId })
    ).resolves.toEqual(NO_SECRET_AUTHORITY)
  })

  it('gives a headless run that recorded nothing no secrets', async () => {
    await insertRun('stream-legacy', { source: 'headless_lifecycle' })
    await insertRun('stream-empty', {})

    for (const streamId of ['stream-legacy', 'stream-empty']) {
      await expect(getRunSecretAuthority({ streamId, userId, chatId })).resolves.toEqual(
        NO_SECRET_AUTHORITY
      )
    }
  })

  it('refuses a malformed recorded authority instead of reading it as the permissive default', async () => {
    await insertRun('stream-no-scope', {
      secretAuthority: { secretMountPolicy: {}, secretActorUserId: userId },
    })
    await insertRun('stream-bad-actor', {
      secretAuthority: {
        secretMountPolicy: { secretScope: 'all', mountedSecrets: [] },
        secretActorUserId: 42,
      },
    })

    for (const streamId of ['stream-no-scope', 'stream-bad-actor']) {
      await expect(getRunSecretAuthority({ streamId, userId, chatId })).resolves.toEqual(
        NO_SECRET_AUTHORITY
      )
    }
  })

  it("never lends a run's authority to another user, another chat, or an unknown turn", async () => {
    await insertRun('stream-owned', interactiveContext())

    const lookups = [
      { streamId: 'stream-owned', userId: 'someone-else', chatId },
      { streamId: 'stream-owned', userId, chatId: generateId() },
      { streamId: 'stream-owned', userId, chatId: 'not-a-uuid' },
      { streamId: 'stream-missing', userId, chatId },
    ]
    for (const lookup of lookups) {
      await expect(getRunSecretAuthority(lookup)).resolves.toEqual(NO_SECRET_AUTHORITY)
    }
  })
})
