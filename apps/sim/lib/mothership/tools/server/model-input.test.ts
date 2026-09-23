/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsOpaqueWorkspaceFileEgressSafe } = vi.hoisted(() => ({
  mockIsOpaqueWorkspaceFileEgressSafe: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isOpaqueWorkspaceFileEgressSafe: mockIsOpaqueWorkspaceFileEgressSafe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import { assertOpaqueWorkspaceFileModelSafe } from '@/lib/mothership/tools/server/model-input'

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'reference.png',
  key: 'workspace/workspace-1/reference.png',
  path: '/api/files/serve/reference.png',
  size: 10,
  type: 'image/png',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-08-05T00:00:00.000Z'),
  updatedAt: new Date('2026-08-05T00:00:00.000Z'),
  storageContext: 'workspace' as const,
}

describe('server tool model-input boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(true)
  })

  it('binds opaque checks to the exact workspace file before allowing model egress', async () => {
    await expect(
      assertOpaqueWorkspaceFileModelSafe({
        workspaceId: 'workspace-1',
        file,
      })
    ).resolves.toBeUndefined()
    expect(mockIsOpaqueWorkspaceFileEgressSafe).toHaveBeenCalledWith('workspace-1', {
      fileId: 'file-1',
      key: 'workspace/workspace-1/reference.png',
      context: 'workspace',
    })
  })

  it('rejects tainted or unavailable opaque provenance', async () => {
    mockIsOpaqueWorkspaceFileEgressSafe.mockResolvedValue(false)

    await expect(
      assertOpaqueWorkspaceFileModelSafe({ workspaceId: 'workspace-1', file })
    ).rejects.toThrow('File cannot be sent to a model')
  })
})
