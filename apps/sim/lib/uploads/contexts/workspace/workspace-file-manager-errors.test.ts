/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorkspaceFiles } from './workspace-file-manager'

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
