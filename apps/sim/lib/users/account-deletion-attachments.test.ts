import {
  dbChainMockFns,
  hasMockCondition,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { billingPlanMock, billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { tableEventsMock } from '@sim/testing/mocks/table-events.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import { workspacesUtilsMock } from '@sim/testing/mocks/workspaces-utils.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  getPersonalSubscription: billingPlanMockFns.mockGetHighestPriorityPersonalSubscription,
  isSoleOwnerOfPaidOrganization: organizationMembershipMockFns.mockIsSoleOwnerOfPaidOrganization,
}
const { mockIsUsingCloudStorage } = uploadsMockFns
const { mockDeleteFiles } = storageServiceMockFns

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@/lib/billing/core/plan', () => billingPlanMock)
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/table/events', () => tableEventsMock)
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
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mocks.isSoleOwnerOfPaidOrganization.mockResolvedValue({ isBlocker: false })
    mocks.getPersonalSubscription.mockResolvedValue(null)
    mockIsUsingCloudStorage.mockReturnValue(true)
    mockDeleteFiles.mockResolvedValue({ deleted: 1, failed: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([true, false])(
    'purges image objects and ownership records after deleting an account without workspaces (cloud: %s)',
    async (cloudStorage) => {
      mockIsUsingCloudStorage.mockReturnValue(cloudStorage)
      queueTableRows(schemaMock.uploadSession, [{ id: 'upload-1', key: IMAGE_KEY }])

      const plan = await deleteUserAccount('user-1')

      expect(plan.workspacesToDelete).toEqual([])
      expect(mockDeleteFiles).toHaveBeenCalledWith([IMAGE_KEY], 'mothership')
      expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.uploadSession)
      const userDeleteIndex = dbChainMockFns.delete.mock.calls.findIndex(
        ([table]) => table === schemaMock.user
      )
      const imageDeleteIndex = dbChainMockFns.delete.mock.calls.findIndex(
        ([table]) => table === schemaMock.uploadSession
      )
      expect(dbChainMockFns.delete.mock.invocationCallOrder[userDeleteIndex]).toBeLessThan(
        mockDeleteFiles.mock.invocationCallOrder[0]
      )
      expect(mockDeleteFiles.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.delete.mock.invocationCallOrder[imageDeleteIndex]
      )
    }
  )

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
    mockDeleteFiles.mockResolvedValue({
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
        mockDeleteFiles.mockRejectedValueOnce(new Error('Storage unavailable'))
      } else {
        mockDeleteFiles.mockResolvedValueOnce({
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

    expect(mockDeleteFiles).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalledWith(schemaMock.uploadSession)
  })

  it('leaves storage untouched when deletion is blocked for an active account', async () => {
    mocks.getPersonalSubscription.mockResolvedValueOnce({ plan: 'pro' })

    await expect(deleteUserAccount('user-1')).rejects.toMatchObject({ code: 'conflict' })

    expect(dbChainMockFns.from).not.toHaveBeenCalledWith(schemaMock.uploadSession)
    expect(mockDeleteFiles).not.toHaveBeenCalled()
  })
})
