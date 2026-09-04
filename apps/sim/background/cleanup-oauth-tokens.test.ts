/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { select: mocks.select, delete: mocks.delete } }))

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
  chain.limit = () => chain
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve)
  return chain
}

describe('runCleanupOAuthTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes exactly the expired rows it selected, and reports both counts', async () => {
    const deletedFrom: unknown[] = []
    mocks.select
      .mockReturnValueOnce(selectChain([{ id: 'r1' }, { id: 'r2' }], []))
      .mockReturnValueOnce(selectChain([{ id: 'a1' }], []))
    mocks.delete.mockImplementation((table: unknown) => ({
      where: (clause: unknown) => {
        deletedFrom.push([table, clause])
        return Promise.resolve()
      },
    }))

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      refreshTokens: 2,
      accessTokens: 1,
    })
    expect(deletedFrom).toHaveLength(2)
  })

  /**
   * A sweep that issued its deletes unconditionally would send an empty `IN ()`
   * to the database on every quiet run.
   */
  it('issues no delete when nothing has expired', async () => {
    mocks.select.mockReturnValueOnce(selectChain([], [])).mockReturnValueOnce(selectChain([], []))

    await expect(runCleanupOAuthTokens()).resolves.toEqual({
      refreshTokens: 0,
      accessTokens: 0,
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('keeps a tail rather than deleting the moment a token lapses', () => {
    expect(OAUTH_TOKEN_RETENTION_DAYS).toBeGreaterThan(0)
  })
})
