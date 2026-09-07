/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.clearAllMocks()
    mocks.transaction.mockImplementation((work) =>
      work({ select: mocks.txSelect, delete: mocks.txDelete })
    )
    mocks.txSelect.mockImplementation(() => selectChain([], []))
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

  it('bounds family cascades independently of direct token pages and stops a full backlog', async () => {
    const families = Array.from({ length: 10 }, (_, index) => ({
      id: `family-${index}`,
      clientId: 'client-1',
      sessionId: null,
      userId: 'user-1',
      consentId: null,
    }))
    for (let page = 0; page < 10; page += 1) {
      mocks.select.mockReturnValueOnce(selectChain(families, []))
    }
    mocks.select.mockReturnValueOnce(selectChain([], []))
    mocks.txDelete.mockReturnValue({
      where: () => ({ returning: async () => families.map(({ id }) => ({ id })) }),
    })

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      tokenFamilies: 100,
      accessTokens: 0,
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(10)
    expect(mocks.limits.mock.calls.map(([limit]) => limit)).toEqual([
      ...Array.from({ length: 10 }, () => 10),
      5_000,
    ])
  })
})
