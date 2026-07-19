/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateId } = vi.hoisted(() => ({
  mockGenerateId: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

import {
  claimExecutionId,
  hasDurableExecutionOwner,
  releaseExecutionIdClaim,
} from '@/lib/workflows/executor/execution-id-claim'

describe('execution ID claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGenerateId.mockReturnValue('claim-token')
  })

  it('atomically claims a first-use execution ID', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ key: 'workflow-execution-id:execution-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(claimExecutionId('execution-1')).resolves.toEqual({
      key: 'workflow-execution-id:execution-1',
      token: 'claim-token',
    })
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledTimes(1)
  })

  it('allows only one concurrent claim for the same execution ID', async () => {
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ key: 'workflow-execution-id:execution-1' }])
      .mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([])
    mockGenerateId.mockReturnValueOnce('claim-token-1').mockReturnValueOnce('claim-token-2')

    const claims = await Promise.all([
      claimExecutionId('execution-1'),
      claimExecutionId('execution-1'),
    ])

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1)
    expect(claims.filter((claim) => claim === null)).toHaveLength(1)
  })

  it('rejects an ID already represented by a durable execution log', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ key: 'workflow-execution-id:execution-1' }])
    dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'workflow-log-1' }])

    await expect(claimExecutionId('execution-1')).resolves.toBeNull()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('releases its transient claim on a pre-start failure', async () => {
    await releaseExecutionIdClaim({
      key: 'workflow-execution-id:execution-1',
      token: 'claim-token',
    })

    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
  })

  it.each([
    { records: [{ id: 'workflow-log-1' }], expected: true },
    { records: [], expected: false },
  ])('reports durable log ownership as $expected', async ({ records, expected }) => {
    dbChainMockFns.limit.mockResolvedValueOnce(records)

    await expect(hasDurableExecutionOwner('execution-1')).resolves.toBe(expected)
  })
})
