/**
 * @vitest-environment node
 *
 * Tests for Issue #3081: Race Condition between pause persistence and resume requests
 */
import { databaseMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/logger', () => loggerMock)

import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import type { PausePoint, SerializedSnapshot } from '@/executor/types'

describe('PauseResumeManager - Race Condition Fix (#3081)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createTestSnapshot = (): SerializedSnapshot => ({
    snapshot: JSON.stringify({
      workflow: { blocks: [], connections: [] },
      state: { blockStates: {}, executedBlocks: [] },
    }),
    triggerIds: [],
  })

  const createTestPausePoints = (): PausePoint[] => [
    {
      contextId: 'test-context',
      blockId: 'pause-block-1',
      response: {},
      resumeStatus: 'paused',
      snapshotReady: true,
      registeredAt: new Date().toISOString(),
    },
  ]

  describe('persistPauseResult', () => {
    it.concurrent('should use database transaction for atomic persistence', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      })

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = { insert: mockInsert }
        return await callback(mockTx as any)
      })

      vi.mocked(databaseMock.db.transaction).mockImplementation(mockTransaction)
      vi.spyOn(PauseResumeManager, 'processQueuedResumes').mockResolvedValue(undefined)

      await PauseResumeManager.persistPauseResult({
        workflowId: 'test-workflow',
        executionId: 'test-execution',
        pausePoints: createTestPausePoints(),
        snapshotSeed: createTestSnapshot(),
        executorUserId: 'test-user',
      })

      expect(mockTransaction).toHaveBeenCalledTimes(1)
      expect(mockInsert).toHaveBeenCalled()
    })

    it.concurrent('should call processQueuedResumes after transaction', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      })

      vi.mocked(databaseMock.db.transaction).mockImplementation(async (callback) => {
        const mockTx = { insert: mockInsert }
        return await callback(mockTx as any)
      })

      const processQueuedResumesSpy = vi
        .spyOn(PauseResumeManager, 'processQueuedResumes')
        .mockResolvedValue(undefined)

      await PauseResumeManager.persistPauseResult({
        workflowId: 'test-workflow',
        executionId: 'test-execution',
        pausePoints: createTestPausePoints(),
        snapshotSeed: createTestSnapshot(),
        executorUserId: 'test-user',
      })

      expect(processQueuedResumesSpy).toHaveBeenCalledWith('test-execution')
    })
  })
})
