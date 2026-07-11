/**
 * Tests for the folder restore API route (/api/folders/[id]/restore)
 *
 * @vitest-environment node
 */
import { authMockFns, createMockRequest, permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPerformRestoreFolder, mockDbRef } = vi.hoisted(() => ({
  mockPerformRestoreFolder: vi.fn(),
  mockDbRef: { current: null as any },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }),
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/db', () => ({
  get db() {
    return mockDbRef.current
  },
}))
vi.mock('@/lib/folders/orchestration', () => ({
  performRestoreFolder: mockPerformRestoreFolder,
}))

import { POST } from '@/app/api/folders/[id]/restore/route'

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

function mockExistingFolder(row: unknown) {
  mockDbRef.current = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    }),
  }
}

describe('POST /api/folders/[id]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockExistingFolder({ resourceType: 'knowledge_base' })
  })

  it('returns 404 when the folder row itself is not found', async () => {
    mockExistingFolder(null)

    const req = createMockRequest('POST', { workspaceId: 'ws-1' })
    const response = await POST(req, { params: Promise.resolve({ id: 'folder-1' }) })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Folder not found')
    expect(mockPerformRestoreFolder).not.toHaveBeenCalled()
  })

  it('returns 404 (not 400) when performRestoreFolder reports not_found', async () => {
    // Regression test: the route previously hardcoded 400 for every orchestration
    // failure, so a caller/monitor couldn't distinguish "not found" from any other
    // validation failure.
    mockPerformRestoreFolder.mockResolvedValueOnce({
      success: false,
      error: 'Folder not found',
      errorCode: 'not_found',
    })

    const req = createMockRequest('POST', { workspaceId: 'ws-1' })
    const response = await POST(req, { params: Promise.resolve({ id: 'folder-1' }) })

    expect(response.status).toBe(404)
    const data = await response.json()
    expect(data.error).toBe('Folder not found')
  })

  it('returns 400 for a validation failure (e.g. folder is not archived)', async () => {
    mockPerformRestoreFolder.mockResolvedValueOnce({
      success: false,
      error: 'Folder is not archived',
      errorCode: 'validation',
    })

    const req = createMockRequest('POST', { workspaceId: 'ws-1' })
    const response = await POST(req, { params: Promise.resolve({ id: 'folder-1' }) })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Folder is not archived')
  })

  it('returns 200 on success', async () => {
    mockPerformRestoreFolder.mockResolvedValueOnce({
      success: true,
      restoredItems: { folders: 1, knowledgeBases: 0 },
    })

    const req = createMockRequest('POST', { workspaceId: 'ws-1' })
    const response = await POST(req, { params: Promise.resolve({ id: 'folder-1' }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ success: true })
  })
})
