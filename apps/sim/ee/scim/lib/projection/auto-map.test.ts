/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { permissionGroup, scimGroupMapping } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLeafLock } = vi.hoisted(() => ({ mockLeafLock: vi.fn() }))
vi.mock('@/lib/permission-groups/locks', () => ({ acquirePermissionGroupOrgLock: mockLeafLock }))

import {
  autoMapPermissionGroupByName,
  settleMappedPermissionGroupsExplicit,
} from '@/ee/scim/lib/projection/auto-map'

const params = { organizationId: 'org-1', scimGroupId: 'g-1', displayName: 'Engineering' }

afterAll(resetDbChainMock)

describe('autoMapPermissionGroupByName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('removes only automatic mappings to other groups before mapping the match', async () => {
    queueTableRows(permissionGroup, [{ id: 'pg-1', membershipMode: 'explicit' }])
    queueTableRows(scimGroupMapping, [])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'm-1' }])

    await expect(autoMapPermissionGroupByName(db, params)).resolves.toBe('mapped')
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(scimGroupMapping)
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'and',
        conditions: expect.arrayContaining([
          { type: 'eq', left: scimGroupMapping.source, right: 'automatic' },
          { type: 'ne', left: scimGroupMapping.permissionGroupId, right: 'pg-1' },
        ]),
      })
    )
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ permissionGroupId: 'pg-1', source: 'automatic' })
    )
  })

  it('reports unmapped when a rename drops the old automatic mapping and matches nothing', async () => {
    queueTableRows(permissionGroup, [])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'old' }])
    await expect(autoMapPermissionGroupByName(db, params)).resolves.toBe('unmapped')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('reports no-match when nothing was mapped and nothing was removed', async () => {
    queueTableRows(permissionGroup, [])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(autoMapPermissionGroupByName(db, params)).resolves.toBe('no-match')
  })

  it('never takes the permission-group leaf lock itself, since user locks follow it', async () => {
    queueTableRows(permissionGroup, [{ id: 'pg-1' }])
    queueTableRows(scimGroupMapping, [])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'm-1' }])
    await expect(autoMapPermissionGroupByName(db, params)).resolves.toBe('mapped')
    expect(mockLeafLock).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('yields to a concurrent identical mapping instead of failing', async () => {
    queueTableRows(permissionGroup, [{ id: 'pg-1', membershipMode: 'explicit' }])
    queueTableRows(scimGroupMapping, [])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.returning.mockResolvedValueOnce([])
    await expect(autoMapPermissionGroupByName(db, params)).resolves.toBe('already-mapped')
  })
})

describe('settleMappedPermissionGroupsExplicit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('takes the leaf lock before moving a still-inheriting mapped group to explicit', async () => {
    queueTableRows(scimGroupMapping, [{ id: 'pg-1' }])
    await settleMappedPermissionGroupsExplicit(db, { organizationId: 'org-1', scimGroupId: 'g-1' })
    expect(mockLeafLock).toHaveBeenCalledWith(db, 'org-1', { lockTimeoutAlreadyBounded: true })
    expect(mockLeafLock.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.update.mock.invocationCallOrder[0]
    )
  })

  it('does nothing, and takes no lock, when every mapped group is already explicit', async () => {
    queueTableRows(scimGroupMapping, [])
    await settleMappedPermissionGroupsExplicit(db, { organizationId: 'org-1', scimGroupId: 'g-1' })
    expect(mockLeafLock).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
