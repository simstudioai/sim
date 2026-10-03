import { db } from '@sim/db'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: (database: object) => () => ({
    create: hoisted.create,
    transaction: vi.fn(),
    database,
  }),
}))

import { getAuthDatabase } from '@/lib/auth/database-context'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'

const mocks = {
  ...hoisted,
  transaction: dbChainMockFns.transaction,
  rootInsert: dbChainMockFns.insert,
}

afterAll(resetDbChainMock)

describe('createSimAuthAdapter', () => {
  beforeEach(() => {
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([{ id: 'org-1' }])
    const tx = { insert: mocks.insert }
    mocks.transaction.mockImplementation(async (callback) => callback(tx))
    mocks.insert.mockReturnValue({
      values: (values: object) => ({
        onConflictDoUpdate: () => ({ returning: async () => [{ ...values, id: 'persisted' }] }),
      }),
    })
    mocks.create.mockResolvedValue({ id: 'base-record' })
  })

  it('retains both OAuth and subscription guards inside a transaction callback', async () => {
    const adapter = createSimAuthAdapter({})
    const now = new Date()

    await adapter.transaction(async (tx) => {
      await expect(
        tx.create({
          model: 'oauthConsent',
          data: {
            clientId: 'client-1',
            userId: 'user-1',
            referenceId: null,
            scopes: ['api:read'],
            createdAt: now,
            updatedAt: now,
          },
        })
      ).resolves.toMatchObject({ id: 'persisted' })

      await expect(
        tx.create({ model: 'subscription', data: { referenceId: 'org-1', plan: 'pro' } })
      ).rejects.toThrow('Organization-referenced subscriptions must hold a Team or Enterprise plan')

      await expect(tx.create({ model: 'user', data: { name: 'Ada' } })).resolves.toEqual({
        id: 'base-record',
      })
    })

    expect(mocks.insert).toHaveBeenCalledOnce()
    expect(mocks.rootInsert).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ model: 'user', data: { name: 'Ada' } })
  })

  it('scopes database hooks to the transaction and releases the executor after rollback', async () => {
    const adapter = createSimAuthAdapter({})
    const transaction = { insert: mocks.insert }
    mocks.transaction.mockImplementation(async (callback) => callback(transaction))

    expect(getAuthDatabase()).toBe(db)
    await expect(
      adapter.transaction(async () => {
        expect(getAuthDatabase()).toBe(transaction)
        await Promise.resolve()
        expect(getAuthDatabase()).toBe(transaction)
        throw new Error('Abort signup')
      })
    ).rejects.toThrow('Abort signup')
    expect(getAuthDatabase()).toBe(db)
  })
})
