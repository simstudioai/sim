/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/documents/service', () => ({
  hardDeleteDocuments: vi.fn(),
}))

import {
  staleMemberWindowMs,
  sweepStaleMemberObservations,
} from '@/lib/knowledge/connectors/member-observations'
import { MEMBER_OBSERVATION_STALE_AFTER_HOURS } from '@/lib/knowledge/connectors/sync-limits'

const NOW = new Date('2026-09-01T12:00:00Z')
const STALE_MEMBER = { id: 'm-1', connectorId: 'c-1', syncIntervalMinutes: 60 }

describe('staleMemberWindowMs', () => {
  it('is the larger of a day and two intervals', () => {
    const day = MEMBER_OBSERVATION_STALE_AFTER_HOURS * 60 * 60 * 1000
    expect(staleMemberWindowMs(60)).toBe(day)
    expect(staleMemberWindowMs(0)).toBe(day)
    expect(staleMemberWindowMs(24 * 60)).toBe(2 * 24 * 60 * 60 * 1000)
  })
})

describe('sweepStaleMemberObservations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('sweeps a member that is still stale once its row is locked', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.knowledgeConnectorMember, [{ id: 'm-1' }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ documentId: 'd-1' }, { documentId: 'd-2' }])
      .mockResolvedValueOnce([{ id: 'd-1' }, { id: 'd-2' }])
      .mockResolvedValueOnce([{ id: 'd-2' }])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toEqual({
      members: 1,
      observationsRemoved: 2,
      documentsRematerialized: 2,
      docsTombstoned: 1,
    })

    expect(dbChainMockFns.transaction).toHaveBeenCalledOnce()
    expect(dbChainMockFns.for).toHaveBeenNthCalledWith(1, 'share')
    expect(dbChainMockFns.for).toHaveBeenNthCalledWith(2, 'update')
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.knowledgeDocumentObservation)
    expect(dbChainMockFns.set).toHaveBeenLastCalledWith({ deletedAt: NOW })
  })

  /**
   * A run that claimed the member between the selection and the lock moved
   * `lastStartedAt` forward, so the re-check under `FOR UPDATE` finds nothing
   * and the observations that run is about to write are left alone.
   */
  it('leaves a member that a run claimed after it was selected', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [{ id: 'c-1' }])
    queueTableRows(schemaMock.knowledgeConnectorMember, [])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toEqual({
      members: 0,
      observationsRemoved: 0,
      documentsRematerialized: 0,
      docsTombstoned: 0,
    })

    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  /** A connector that left members mode after the selection no longer matches the shared lock's re-check. */
  it('leaves a connector that left members mode after it was selected', async () => {
    queueTableRows(schemaMock.knowledgeConnectorMember, [STALE_MEMBER])
    queueTableRows(schemaMock.knowledgeConnector, [])

    await expect(sweepStaleMemberObservations(NOW)).resolves.toMatchObject({ members: 0 })

    expect(dbChainMockFns.for).toHaveBeenCalledWith('share')
    expect(dbChainMockFns.for).not.toHaveBeenCalledWith('update')
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
