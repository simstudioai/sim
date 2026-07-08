/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckStorageQuota } = vi.hoisted(() => ({
  mockCheckStorageQuota: vi.fn(),
}))

vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuota: mockCheckStorageQuota,
}))

/**
 * Minimal stand-in for the domain error so this unit test never loads the authz module's
 * billing/feature-flag import chain. Shape-compatible with the real `ForkError`.
 */
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => ({
  ForkError: class ForkError extends Error {
    statusCode: number
    constructor(message: string, statusCode = 400) {
      super(message)
      this.name = 'ForkError'
      this.statusCode = statusCode
    }
  },
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  assertForkStorageHeadroom,
  sumForkCopyBytes,
} from '@/ee/workspace-forking/lib/copy/storage-quota'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

/**
 * Fake executor resolving one aggregate row per query, in call order. Supports both sum
 * shapes: `select().from().where()` (files) and `select().from().innerJoin().where()` (KB
 * documents joined to their live KB row).
 */
function makeExecutor(totals: Array<number | string>) {
  let call = 0
  const next = () => Promise.resolve([{ total: totals[call++] ?? 0 }])
  const select = vi.fn(() => ({
    from: () => ({
      where: next,
      innerJoin: () => ({ where: next }),
    }),
  }))
  return { executor: { select } as unknown as DbOrTx, select }
}

describe('sumForkCopyBytes', () => {
  it('adds the workspace-file and KB-document byte sums', async () => {
    const { executor, select } = makeExecutor([300, 700])

    const bytes = await sumForkCopyBytes(executor, 'src-ws', {
      fileIds: ['wf-1'],
      knowledgeBaseIds: ['kb-1'],
    })

    expect(bytes).toBe(1000)
    expect(select).toHaveBeenCalledTimes(2)
  })

  it('coerces driver string aggregates (bigint sums) to numbers', async () => {
    const { executor } = makeExecutor(['1024'])

    const bytes = await sumForkCopyBytes(executor, 'src-ws', { fileKeys: ['workspace/src/k1'] })

    expect(bytes).toBe(1024)
  })

  it('runs no query for an empty selection', async () => {
    const { executor, select } = makeExecutor([])

    const bytes = await sumForkCopyBytes(executor, 'src-ws', {
      fileIds: [],
      fileKeys: [],
      knowledgeBaseIds: [],
    })

    expect(bytes).toBe(0)
    expect(select).not.toHaveBeenCalled()
  })

  it('skips the file query when only KBs are selected (and vice versa)', async () => {
    const { executor, select } = makeExecutor([555])

    const bytes = await sumForkCopyBytes(executor, 'src-ws', { knowledgeBaseIds: ['kb-1'] })

    expect(bytes).toBe(555)
    expect(select).toHaveBeenCalledTimes(1)
  })
})

describe('assertForkStorageHeadroom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never consults the quota helper for zero bytes', async () => {
    await assertForkStorageHeadroom({ userId: 'user-1', bytes: 0 })
    expect(mockCheckStorageQuota).not.toHaveBeenCalled()
  })

  it('resolves when the scope has headroom', async () => {
    mockCheckStorageQuota.mockResolvedValue({ allowed: true, currentUsage: 10, limit: 100 })

    await expect(
      assertForkStorageHeadroom({ userId: 'user-1', bytes: 50 })
    ).resolves.toBeUndefined()
    expect(mockCheckStorageQuota).toHaveBeenCalledWith('user-1', 50)
  })

  it("throws a 413 ForkError carrying the upload path's quota message when over quota", async () => {
    mockCheckStorageQuota.mockResolvedValue({
      allowed: false,
      currentUsage: 99,
      limit: 100,
      error: 'Storage limit exceeded. Used: 10.50GB, Limit: 10GB',
    })

    const rejection = expect(assertForkStorageHeadroom({ userId: 'user-1', bytes: 50 })).rejects
    await rejection.toBeInstanceOf(ForkError)
    await rejection.toMatchObject({
      statusCode: 413,
      message:
        'Not enough storage to copy the selected resources. Storage limit exceeded. Used: 10.50GB, Limit: 10GB',
    })
  })

  it('falls back to a generic storage message when the quota helper omits one', async () => {
    mockCheckStorageQuota.mockResolvedValue({ allowed: false, currentUsage: 0, limit: 0 })

    await expect(assertForkStorageHeadroom({ userId: 'user-1', bytes: 1 })).rejects.toThrow(
      'Not enough storage to copy the selected resources. Storage limit exceeded'
    )
  })
})
