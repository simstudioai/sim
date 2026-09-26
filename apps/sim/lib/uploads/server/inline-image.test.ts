import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { workspaceUploadsMock } from '@sim/testing/mocks/workspace-uploads.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'

const mockGetFileMetadataByKey = uploadsMetadataMockFns.mockGetFileMetadataByKey

describe('resolveWorkspaceInlineImage', () => {
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
