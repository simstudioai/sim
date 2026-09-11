/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSoleOwnerOfPaidOrganization: vi.fn(),
  getPersonalSubscription: vi.fn(),
  isUsingCloudStorage: vi.fn(),
  deleteFiles: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  isSoleOwnerOfPaidOrganization: mocks.isSoleOwnerOfPaidOrganization,
}))
vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPriorityPersonalSubscription: mocks.getPersonalSubscription,
}))
vi.mock('@/lib/uploads', () => ({
  isUsingCloudStorage: mocks.isUsingCloudStorage,
  StorageService: { deleteFiles: mocks.deleteFiles },
}))
vi.mock('@/lib/workspaces/utils', () => ({
  reassignBilledAccountForUser: vi.fn(async () => ({ unresolved: [] })),
  reassignOwnedWorkspacesForUser: vi.fn(async () => ({ unresolved: [] })),
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))
vi.mock('@/lib/table/rows/executions', () => ({
  cancelPendingMarkersForGovernedSubject: vi.fn(async () => []),
}))

import { deleteUserAccount } from '@/lib/users/account-deletion'

const IMAGE_KEY = 'assistant/org-1/user-1/upload-1/photo.png'
const FAILED_IMAGE_KEY = 'assistant/org-2/user-1/upload-2/photo.png'
const NOW = new Date('2026-09-11T12:00:00Z')

function imageDeletionFilter() {
  return dbChainMockFns.where.mock.calls
    .map(([condition]) => condition)
    .find((condition) =>
      hasMockCondition(
        condition,
        (node) => node.type === 'inArray' && node.column === schemaMock.uploadSession.finalKey
      )
    )
}

describe('account deletion of private organization Assistant images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mocks.isSoleOwnerOfPaidOrganization.mockResolvedValue({ isBlocker: false })
    mocks.getPersonalSubscription.mockResolvedValue(null)
    mocks.isUsingCloudStorage.mockReturnValue(true)
    mocks.deleteFiles.mockResolvedValue({ deleted: 1, failed: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([true, false])(
    'purges image objects and ownership records after deleting an account without workspaces (cloud: %s)',
    async (cloudStorage) => {
      mocks.isUsingCloudStorage.mockReturnValue(cloudStorage)
      queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1', key: IMAGE_KEY }])

      const plan = await deleteUserAccount('user-1')

      expect(plan.workspacesToDelete).toEqual([])
      expect(mocks.deleteFiles).toHaveBeenCalledWith([IMAGE_KEY], 'mothership')
      expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.uploadSession)
      const userDeleteIndex = dbChainMockFns.delete.mock.calls.findIndex(
        ([table]) => table === schemaMock.user
      )
      const imageDeleteIndex = dbChainMockFns.delete.mock.calls.findIndex(
        ([table]) => table === schemaMock.uploadSession
      )
      expect(dbChainMockFns.delete.mock.invocationCallOrder[userDeleteIndex]).toBeLessThan(
        mocks.deleteFiles.mock.invocationCallOrder[0]
      )
      expect(mocks.deleteFiles.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.delete.mock.invocationCallOrder[imageDeleteIndex]
      )
    }
  )

  it('scopes both collection and ownership deletion to this uploader’s completed organization images', async () => {
    queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1', key: IMAGE_KEY }])

    await deleteUserAccount('user-1')

    const imageFilters = dbChainMockFns.where.mock.calls
      .map(([condition]) => condition)
      .filter((condition) =>
        hasMockCondition(condition, (node) => node.left === schemaMock.uploadSession.userId)
      )
    expect(imageFilters).toHaveLength(2)
    for (const filter of imageFilters) {
      for (const [column, value] of [
        [schemaMock.uploadSession.userId, 'user-1'],
        [schemaMock.uploadSession.purpose, 'mothership_attachment'],
        [schemaMock.uploadSession.status, 'completed'],
      ]) {
        expect(
          hasMockCondition(
            filter,
            (node) => node.type === 'eq' && node.left === column && node.right === value
          )
        ).toBe(true)
      }
      expect(
        hasMockCondition(
          filter,
          (node) => node.type === 'isNull' && node.column === schemaMock.uploadSession.workspaceId
        )
      ).toBe(true)
    }
  })

  it('retains ownership while an issued upload URL could recreate a purged object', async () => {
    queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1', key: IMAGE_KEY }])

    await deleteUserAccount('user-1')

    expect(
      hasMockCondition(
        imageDeletionFilter(),
        (node) =>
          node.type === 'lte' &&
          node.left === schemaMock.uploadSession.expiresAt &&
          node.right instanceof Date &&
          node.right.getTime() === NOW.getTime()
      )
    ).toBe(true)
  })

  it('retains failed objects’ ownership records for the upload-session sweep', async () => {
    queueTableRows(schemaMock.uploadSession, [
      { id: 'upload-1', key: IMAGE_KEY },
      { id: 'upload-2', key: FAILED_IMAGE_KEY },
    ])
    mocks.deleteFiles.mockResolvedValue({
      deleted: 1,
      failed: [{ key: FAILED_IMAGE_KEY, error: 'Storage unavailable' }],
    })

    await deleteUserAccount('user-1')

    expect(
      hasMockCondition(
        imageDeletionFilter(),
        (node) =>
          node.type === 'inArray' &&
          node.column === schemaMock.uploadSession.finalKey &&
          Array.isArray(node.values) &&
          node.values.length === 1 &&
          node.values[0] === IMAGE_KEY
      )
    ).toBe(true)
  })

  it.each(['batch', 'object'])(
    'keeps ownership records when all %s deletions fail',
    async (failure) => {
      queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1', key: IMAGE_KEY }])
      if (failure === 'batch') {
        mocks.deleteFiles.mockRejectedValueOnce(new Error('Storage unavailable'))
      } else {
        mocks.deleteFiles.mockResolvedValueOnce({
          deleted: 0,
          failed: [{ key: IMAGE_KEY, error: 'Storage unavailable' }],
        })
      }

      await expect(deleteUserAccount('user-1')).resolves.toMatchObject({ blockers: [] })

      expect(dbChainMockFns.delete).not.toHaveBeenCalledWith(schemaMock.uploadSession)
    }
  )

  it('does not purge images or ownership records if account deletion rolls back', async () => {
    queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1', key: IMAGE_KEY }])
    dbChainMockFns.transaction.mockRejectedValueOnce(new Error('Transaction rolled back'))

    await expect(deleteUserAccount('user-1')).rejects.toThrow('Transaction rolled back')

    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalledWith(schemaMock.uploadSession)
  })

  it('leaves storage untouched when deletion is blocked for an active account', async () => {
    mocks.getPersonalSubscription.mockResolvedValueOnce({ plan: 'pro' })

    await expect(deleteUserAccount('user-1')).rejects.toMatchObject({ code: 'conflict' })

    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.uploadSession)
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it('collects and purges image keys in bounded pages', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `upload-${String(index).padStart(4, '0')}`,
      key: `assistant/org-1/user-1/upload-${index}/photo.png`,
    }))
    queueTableRows(schemaMock.uploadSession, firstPage)
    queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1000', key: IMAGE_KEY }])

    await deleteUserAccount('user-1')

    expect(mocks.deleteFiles.mock.calls.map(([keys]) => keys.length)).toEqual([1000, 1])
    expect(
      dbChainMockFns.where.mock.calls.some(([condition]) =>
        hasMockCondition(
          condition,
          (node) =>
            node.type === 'gt' &&
            node.left === schemaMock.uploadSession.id &&
            node.right === firstPage[999].id
        )
      )
    ).toBe(true)
  })
})
