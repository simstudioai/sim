/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/uploads/core/storage-service')>(
    '@/lib/uploads/core/storage-service'
  )
  return { ...actual, deleteFile: mocks.deleteFile }
})

import { permanentlyDeleteWorkspaceFile } from './workspace-file-manager'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_doomed'

function archivedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    workspaceId: WORKSPACE_ID,
    originalName: 'doomed.pdf',
    key: 'workspace/workspace-1/doomed.pdf',
    size: 128,
    contentType: 'application/pdf',
    uploadedBy: 'user-1',
    folderId: null,
    context: 'workspace',
    uploadedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  }
}

afterAll(resetDbChainMock)

describe('permanentlyDeleteWorkspaceFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.deleteFile.mockResolvedValue(undefined)
    dbChainMockFns.limit.mockResolvedValue([archivedRow()])
  })

  it('destroys an archived file and reports the object as deleted', async () => {
    const result = await permanentlyDeleteWorkspaceFile(WORKSPACE_ID, FILE_ID)

    expect(result.objectDeleted).toBe(true)
    expect(result.file.id).toBe(FILE_ID)
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      key: 'workspace/workspace-1/doomed.pdf',
      context: 'workspace',
    })
  })

  /**
   * The ordering invariant. Row first, object second: a crash between them
   * leaves an orphaned object the storage sweep reclaims. The reverse would
   * leave a live row pointing at bytes that no longer exist — a file that
   * lists and opens but can never be read, with no path back.
   */
  it('deletes the row before the stored object', async () => {
    const order: string[] = []
    dbChainMockFns.delete.mockImplementationOnce((...args: unknown[]) => {
      order.push('row')
      return dbChainMockFns.delete.getMockImplementation()?.(...args)
    })
    mocks.deleteFile.mockImplementationOnce(async () => {
      order.push('object')
    })

    await permanentlyDeleteWorkspaceFile(WORKSPACE_ID, FILE_ID)

    expect(order).toEqual(['row', 'object'])
  })

  /**
   * Failure injection on the object leg: the row is already gone, so the
   * caller's request has succeeded. Reporting the orphan beats throwing an
   * error the caller would retry against a file that no longer exists.
   */
  it('reports an orphaned object rather than failing when the object delete throws', async () => {
    mocks.deleteFile.mockRejectedValueOnce(new Error('s3 unavailable'))

    const result = await permanentlyDeleteWorkspaceFile(WORKSPACE_ID, FILE_ID)

    expect(result.objectDeleted).toBe(false)
  })

  /**
   * Failure injection on the row leg: nothing was destroyed, so the object must
   * be left untouched. A deleted object beside a live row is the broken state
   * the ordering exists to prevent.
   */
  it('never deletes the object when the row delete fails', async () => {
    dbChainMockFns.delete.mockImplementationOnce(() => {
      throw new Error('deadlock detected')
    })

    await expect(permanentlyDeleteWorkspaceFile(WORKSPACE_ID, FILE_ID)).rejects.toThrow(
      'deadlock detected'
    )
    expect(mocks.deleteFile).not.toHaveBeenCalled()
  })

  it('refuses a file that is not archived and names the archive step', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([archivedRow({ deletedAt: null })])

    await expect(permanentlyDeleteWorkspaceFile(WORKSPACE_ID, FILE_ID)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining(`DELETE /api/v2/files/${FILE_ID}`),
    })
    expect(mocks.deleteFile).not.toHaveBeenCalled()
  })

  it('reports an unknown file as not found without touching storage', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(permanentlyDeleteWorkspaceFile(WORKSPACE_ID, FILE_ID)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.deleteFile).not.toHaveBeenCalled()
  })
})
