/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaceFiles, loadActiveWorkspaceFileContext } from './workspace-file-manager'

afterAll(resetDbChainMock)

describe('listWorkspaceFiles error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    dbChainMockFns.orderBy.mockRejectedValue(new Error('database unavailable'))
  })

  it('keeps the established best-effort behavior by default', async () => {
    await expect(listWorkspaceFiles('workspace-1')).resolves.toEqual([])
  })

  it('propagates failures when a caller requires an authoritative list', async () => {
    await expect(listWorkspaceFiles('workspace-1', { throwOnError: true })).rejects.toThrow(
      'database unavailable'
    )
  })
})

describe('loadActiveWorkspaceFileContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns the canonical workspace authorization context', async () => {
    const context = {
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    }
    dbChainMockFns.limit.mockResolvedValueOnce([context])

    await expect(loadActiveWorkspaceFileContext('file-1')).resolves.toEqual(context)
  })

  it('returns null when the active file does not exist', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])

    await expect(loadActiveWorkspaceFileContext('missing-file')).resolves.toBeNull()
  })

  it('propagates database failures', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(loadActiveWorkspaceFileContext('file-1')).rejects.toThrow('database unavailable')
  })
})
