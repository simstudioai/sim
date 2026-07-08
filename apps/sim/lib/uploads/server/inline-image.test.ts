/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceFile, mockGetFileMetadataByKey } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockGetFileMetadataByKey: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({ getWorkspaceFile: mockGetWorkspaceFile }))
vi.mock('@/lib/uploads/server/metadata', () => ({ getFileMetadataByKey: mockGetFileMetadataByKey }))

import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'

describe('resolveWorkspaceInlineImage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves by fileId scoped to the workspace (getWorkspaceFile already enforces scope)', async () => {
    mockGetWorkspaceFile.mockResolvedValue({
      key: 'workspace/ws-1/x.png',
      type: 'image/png',
      name: 'x.png',
    })
    const out = await resolveWorkspaceInlineImage('ws-1', { fileId: 'wf_a' })
    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('ws-1', 'wf_a')
    expect(out).toEqual({
      key: 'workspace/ws-1/x.png',
      contentType: 'image/png',
      filename: 'x.png',
    })
  })

  it('returns null when getWorkspaceFile finds nothing (cross-workspace / deleted / non-workspace)', async () => {
    mockGetWorkspaceFile.mockResolvedValue(null)
    expect(await resolveWorkspaceInlineImage('ws-1', { fileId: 'wf_a' })).toBeNull()
  })

  it('resolves by key only when the row belongs to the workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({
      key: 'workspace/ws-1/x.png',
      workspaceId: 'ws-1',
      contentType: 'image/png',
      originalName: 'x.png',
    })
    const out = await resolveWorkspaceInlineImage('ws-1', { key: 'workspace/ws-1/x.png' })
    expect(out).toEqual({
      key: 'workspace/ws-1/x.png',
      contentType: 'image/png',
      filename: 'x.png',
    })
  })

  it('returns null when the keyed row belongs to a different workspace', async () => {
    mockGetFileMetadataByKey.mockResolvedValue({
      key: 'workspace/ws-2/x.png',
      workspaceId: 'ws-2',
      contentType: 'image/png',
      originalName: 'x.png',
    })
    expect(await resolveWorkspaceInlineImage('ws-1', { key: 'workspace/ws-2/x.png' })).toBeNull()
  })
})
