/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  return {
    chain,
    select: vi.fn(() => chain),
  }
})

vi.mock('@sim/db', () => ({ db: { select: mocks.select } }))

import { listWorkspaceFiles } from './workspace-file-manager'

describe('listWorkspaceFiles error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chain.from.mockReturnValue(mocks.chain)
    mocks.chain.where.mockReturnValue(mocks.chain)
    mocks.chain.orderBy.mockRejectedValue(new Error('database unavailable'))
    mocks.select.mockReturnValue(mocks.chain)
  })

  it('keeps the established best-effort behavior by default', async () => {
    await expect(listWorkspaceFiles('workspace-1')).resolves.toEqual([])
  })

  it('propagates failures when a caller requires an authoritative list', async () => {
    await expect(listWorkspaceFiles('workspace-1', { throwOnError: true })).rejects.toThrow(
      'database unavailable'
    )
  })
})
