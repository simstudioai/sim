/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  rootInsert: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    insert: mocks.rootInsert,
    transaction: mocks.transaction,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'org-1' }] }) }) }),
  },
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: (database: object) => () => ({
    create: mocks.create,
    transaction: vi.fn(),
    database,
  }),
}))

import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'

describe('createSimAuthAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
