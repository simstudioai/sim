/**
 * Tests for the folder reorder API route.
 *
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger, mockNotifyFolder } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  },
  mockNotifyFolder: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/realtime/notify', () => ({ notifyFolderResourceChanged: mockNotifyFolder }))

import { db } from '@sim/db'
import { PUT } from '@/app/api/folders/reorder/route'

const mockDb = db as any

describe('PUT /api/folders/reorder', () => {
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockTxUpdate = vi.fn()
  const mockTxExecute = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReset()
    mockWhere.mockReset()
    mockTxUpdate.mockReset()
    mockTxExecute.mockReset()
    mockDb.transaction.mockReset()

    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')

    mockFrom.mockReturnValue({ where: mockWhere })

    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })
    mockDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        execute: mockTxExecute,
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        update: mockTxUpdate,
      })
    )
  })

  it('reorders folders when updates are valid', async () => {
    mockWhere
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])
      .mockReturnValueOnce([{ id: 'folder-1', parentId: null }])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 2, parentId: null }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ success: true, updated: 1 })
    expect(mockNotifyFolder).toHaveBeenCalledWith('workflow', 'workspace-123')
  })

  it('maps a sibling-name collision from a reparent to a 409', async () => {
    mockWhere
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])
      .mockReturnValueOnce([{ id: 'parent-1', workspaceId: 'workspace-123', archivedAt: null }])
      .mockReturnValueOnce([
        { id: 'folder-1', parentId: null },
        { id: 'parent-1', parentId: null },
      ])

    const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' })
    mockTxUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockRejectedValue(uniqueViolation) }),
    })

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      resourceType: 'knowledge_base',
      updates: [{ id: 'folder-1', sortOrder: 0, parentId: 'parent-1' }],
    })

    const response = await PUT(req)

    expect(mockTxUpdate).toHaveBeenCalled()
    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.error).toBe('A folder with this name already exists in this location')
  })

  it('rejects a parentId that belongs to another workspace', async () => {
    mockWhere
      .mockReturnValueOnce([{ id: 'folder-1', workspaceId: 'workspace-123' }])
      .mockReturnValueOnce([{ id: 'foreign', workspaceId: 'workspace-OTHER', archivedAt: null }])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [{ id: 'folder-1', sortOrder: 0, parentId: 'foreign' }],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Parent folder not found')
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })

  it('rejects a batch that would form a cycle', async () => {
    mockWhere
      .mockReturnValueOnce([
        { id: 'A', workspaceId: 'workspace-123' },
        { id: 'B', workspaceId: 'workspace-123' },
      ])
      .mockReturnValueOnce([
        { id: 'A', workspaceId: 'workspace-123', archivedAt: null },
        { id: 'B', workspaceId: 'workspace-123', archivedAt: null },
      ])
      .mockReturnValueOnce([
        { id: 'A', parentId: null },
        { id: 'B', parentId: null },
      ])

    const req = createMockRequest('PUT', {
      workspaceId: 'workspace-123',
      updates: [
        { id: 'A', sortOrder: 0, parentId: 'B' },
        { id: 'B', sortOrder: 0, parentId: 'A' },
      ],
    })

    const response = await PUT(req)

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Cannot create circular folder reference')
    expect(mockTxUpdate).not.toHaveBeenCalled()
  })
})
