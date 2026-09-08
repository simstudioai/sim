/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
  txSelect: vi.fn(),
  txDelete: vi.fn(),
  limits: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mocks.select,
    delete: mocks.delete,
    transaction: mocks.transaction,
  },
}))

import {
  OAUTH_TOKEN_RETENTION_DAYS,
  runCleanupOAuthTokens,
} from '@/background/cleanup-oauth-tokens'

/** A select chain that answers `rows` once awaited, capturing its `where`. */
function selectChain(rows: unknown[], captured: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.where = (clause: unknown) => {
    captured.push(clause)
    return chain
  }
  chain.orderBy = () => chain
  chain.limit = (limit: number) => {
    mocks.limits(limit)
    return chain
  }
  chain.for = () => chain
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve)
  return chain
}

describe('runCleanupOAuthTokens', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    mocks.transaction.mockImplementation((work) =>
      work({ select: mocks.txSelect, delete: mocks.txDelete })
    )
    mocks.txSelect.mockImplementation(() => selectChain([], []))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('deletes exactly the expired rows it selected, and reports both counts', async () => {
    const deletedFrom: unknown[] = []
    mocks.select
      .mockReturnValueOnce(
        selectChain(
          [
            {
              id: 'r1',
              clientId: 'client-1',
              sessionId: null,
              userId: 'user-1',
              consentId: null,
            },
            {
              id: 'r2',
              clientId: 'client-1',
              sessionId: null,
              userId: 'user-1',
              consentId: null,
            },
          ],
          []
        )
      )
      .mockReturnValueOnce(selectChain([{ id: 'a1' }], []))
    mocks.txDelete.mockImplementation((table: unknown) => ({
      where: (clause: unknown) => {
        deletedFrom.push([table, clause])
        return { returning: () => Promise.resolve([{ id: 'r1' }, { id: 'r2' }]) }
      },
    }))
    mocks.delete.mockImplementation((table: unknown) => ({
      where: (clause: unknown) => {
        deletedFrom.push([table, clause])
        return { returning: () => Promise.resolve([{ id: 'a1' }]) }
      },
    }))

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      tokenFamilies: 2,
      accessTokens: 1,
    })
    expect(deletedFrom).toHaveLength(2)
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  /**
   * A sweep that issued its deletes unconditionally would send an empty `IN ()`
   * to the database on every quiet run.
   */
  it('issues no delete when nothing has expired', async () => {
    mocks.select.mockReturnValueOnce(selectChain([], [])).mockReturnValueOnce(selectChain([], []))

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      tokenFamilies: 0,
      accessTokens: 0,
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('keeps a tail rather than deleting the moment a token lapses', () => {
    expect(OAUTH_TOKEN_RETENTION_DAYS).toBeGreaterThan(0)
  })

  it('drains up to 50,000 families and access tokens with only ten families per transaction', async () => {
    const families = Array.from({ length: 10 }, (_, index) => ({
      id: `family-${index}`,
      clientId: 'client-1',
      sessionId: null,
      userId: 'user-1',
      consentId: null,
    }))
    const accessTokens = Array.from({ length: 5_000 }, (_, index) => ({ id: `access-${index}` }))
    mocks.select.mockImplementation((fields: Record<string, unknown>) =>
      selectChain('clientId' in fields ? families : accessTokens, [])
    )
    mocks.txDelete.mockReturnValue({
      where: () => ({ returning: async () => families.map(({ id }) => ({ id })) }),
    })
    mocks.delete.mockReturnValue({
      where: () => ({ returning: async () => accessTokens }),
    })

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      tokenFamilies: 50_000,
      accessTokens: 50_000,
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(5_000)
    expect(mocks.delete).toHaveBeenCalledTimes(10)
    const limits = mocks.limits.mock.calls.map(([limit]) => limit)
    expect(limits.filter((limit) => limit === 10)).toHaveLength(5_000)
    expect(limits.filter((limit) => limit === 5_000)).toHaveLength(10)
    expect(limits.slice(0, 4)).toEqual([10, 5_000, 10, 5_000])
  })

  it('stops at its deadline with committed progress from both backlogs', async () => {
    const startedAt = Date.now()
    const families = Array.from({ length: 10 }, (_, index) => ({
      id: `family-${index}`,
      clientId: 'client-1',
      sessionId: null,
      userId: 'user-1',
      consentId: null,
    }))
    const accessTokens = Array.from({ length: 5_000 }, (_, index) => ({ id: `access-${index}` }))
    mocks.select.mockImplementation((fields: Record<string, unknown>) =>
      selectChain('clientId' in fields ? families : accessTokens, [])
    )
    mocks.txDelete.mockReturnValue({
      where: () => ({ returning: async () => families.map(({ id }) => ({ id })) }),
    })
    mocks.delete.mockReturnValue({
      where: () => ({
        returning: async () => {
          vi.setSystemTime(startedAt + 45_000)
          return accessTokens
        },
      }),
    })

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      tokenFamilies: 10,
      accessTokens: 5_000,
    })
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.delete).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  it('does not begin a delete when selection exhausts the deadline', async () => {
    const startedAt = Date.now()
    mocks.select.mockImplementation(() => {
      vi.setSystemTime(startedAt + 45_000)
      return selectChain(
        [
          {
            id: 'family-1',
            clientId: 'client-1',
            sessionId: null,
            userId: 'user-1',
            consentId: null,
          },
        ],
        []
      )
    })

    await expect(runCleanupOAuthTokens()).resolves.toEqual({ tokenFamilies: 0, accessTokens: 0 })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.select).toHaveBeenCalledOnce()
  })
})
