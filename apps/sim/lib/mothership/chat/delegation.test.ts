/** @vitest-environment node */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  create: vi.fn(),
  decrypt: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@sim/logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }))
vi.mock('@sim/db', () => ({ db: { transaction: mocks.transaction } }))
vi.mock('@/lib/api-key/auth', () => ({ createApiKey: mocks.create }))
vi.mock('@/lib/api-key/crypto', () => ({
  decryptApiKey: mocks.decrypt,
  hashApiKey: (key: string) => `hash:${key}`,
}))

import { mintDelegationToken } from '@/lib/mothership/chat/delegation'

interface KeyRow {
  id: string
  name: string
  key: string
  expiresAt: Date
}

/** Models a transaction-scoped advisory lock and commits only after the entire callback succeeds. */
function database() {
  const rows = new Map<string, KeyRow>()
  const locks = new Map<string, Promise<void>>()
  let failInsert = false
  const dialect = new PgDialect()
  function transactionScope() {
    let name = ''
    let locked = false
    let release = () => {}
    let next: KeyRow | undefined
    return {
      tx: {
        async execute(sql: SQL) {
          const query = dialect.sqlToQuery(sql)
          expect(query.sql).toContain('pg_advisory_xact_lock')
          const key = query.params[0]
          if (typeof key !== 'string') throw new Error('Expected user lock identity')
          name = key
          const predecessor = locks.get(name) ?? Promise.resolve()
          locks.set(
            name,
            new Promise<void>((resolve) => {
              release = resolve
            })
          )
          await predecessor
          locked = true
        },
        select() {
          if (!locked) throw new Error('Read before acquiring the user lock')
          return {
            from: () => ({
              where: () => ({
                limit: async () => {
                  const row = rows.get(name)
                  return row && row.expiresAt.getTime() > Date.now() + 30 * 60_000 ? [row] : []
                },
              }),
            }),
          }
        },
        delete: () => ({
          where: async () => {
            if (!locked) throw new Error('Delete outside lock')
          },
        }),
        insert: () => ({
          values: async (row: KeyRow) => {
            if (failInsert) throw new Error('storage failed')
            next = row
          },
        }),
      },
      commit() {
        if (next) rows.set(name, next)
      },
      release() {
        release()
      },
    }
  }
  mocks.transaction.mockImplementation(
    async (callback: (tx: ReturnType<typeof transactionScope>['tx']) => Promise<string>) => {
      const scope = transactionScope()
      try {
        const value = await callback(scope.tx)
        scope.commit()
        return value
      } finally {
        scope.release()
      }
    }
  )
  return {
    rows,
    failNextInsert() {
      failInsert = true
    },
  }
}

describe('delegation key concurrency', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    let serial = 0
    mocks.create.mockImplementation(async () => {
      serial++
      return { key: `plain-${serial}`, encryptedKey: `encrypted-${serial}` }
    })
    mocks.decrypt.mockImplementation(async (value: string) => ({
      decrypted: value.replace('encrypted', 'plain'),
    }))
  })

  it('parallel first calls reuse one valid user key across workspace and sandbox lanes', async () => {
    const db = database()
    const keys = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        mintDelegationToken({ workspaceId: `workspace-${i}`, userId: 'actor' })
      )
    )
    expect(mocks.warn.mock.calls).toEqual([])
    expect(new Set(keys)).toEqual(new Set(['plain-1']))
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(db.rows.size).toBe(1)
    expect(db.rows.get('mothership-delegation:actor')?.key).toBe('encrypted-1')
  })

  it('a failed replacement preserves the prior key and different users have different locks', async () => {
    const db = database()
    const keys = await Promise.all(
      ['alice', 'bob'].map((userId) => mintDelegationToken({ workspaceId: 'shared', userId }))
    )
    expect(new Set(keys).size).toBe(2)
    const old = db.rows.get('mothership-delegation:alice')
    if (!old) throw new Error('Missing existing key')
    old.expiresAt = new Date(Date.now() + 15 * 60_000)
    db.failNextInsert()
    expect(await mintDelegationToken({ workspaceId: 'shared', userId: 'alice' })).toBeNull()
    expect(db.rows.get('mothership-delegation:alice')).toBe(old)
  })

  it('does not log bound credential values from database errors', async () => {
    mocks.transaction.mockRejectedValue(
      new Error('Failed query params: plaintext-key, encrypted-key')
    )
    expect(await mintDelegationToken({ workspaceId: 'shared', userId: 'alice' })).toBeNull()
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(
      'Delegation token minting failed; chat continues without one',
      { errorType: 'Error' }
    )
  })
})
