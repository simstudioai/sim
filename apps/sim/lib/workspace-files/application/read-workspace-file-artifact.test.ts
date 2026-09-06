/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  context: vi.fn(),
  render: vi.fn(),
  safe: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isOpaqueWorkspaceFileEgressSafe: mocks.safe,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE: 'File cannot be sent to a model',
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null) => actual !== null,
  resolveEffectiveWorkspacePermission: mocks.permission,
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveReferencedWorkspaceFileContext: mocks.context,
}))
vi.mock('@/lib/workspace-files/application/resolve-rendered-workspace-artifact', () => ({
  resolveRenderedWorkspaceArtifact: mocks.render,
}))

import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'

const principal: Principal = { kind: 'session', userId: 'u', sessionId: 's' }
const input = { workspaceId: 'ws', reference: 'files/report.pdf', maxBytes: 1024 }
const file = {
  id: 'file',
  name: 'report.pdf',
  workspaceId: 'ws',
  key: 'canonical-key',
  contentUpdatedAt: new Date('2026-09-01T00:00:00Z'),
}

describe('authorized artifact observations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.permission.mockResolvedValue('read')
    mocks.safe.mockResolvedValue(true)
    mocks.context.mockResolvedValue({
      workspaceId: 'ws',
      fileId: 'file',
      file,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'owner',
    })
    mocks.render.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
    })
  })

  it('passes the acting principal and byte limit into rendering after authorization', async () => {
    const result = await readWorkspaceFileArtifact.execute({ principal, input })
    expect(result.contentType).toBe('application/pdf')
    expect(mocks.render).toHaveBeenCalledWith(file, principal, { maxBytes: 1024 })
    expect(mocks.safe).toHaveBeenCalledWith('ws', {
      fileId: file.id,
      key: file.key,
      context: 'workspace',
      contentUpdatedAt: file.contentUpdatedAt,
    })
  })

  it('does not read or compile bytes when access is denied', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(readWorkspaceFileArtifact.execute({ principal, input })).rejects.toThrow()
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.safe).not.toHaveBeenCalled()
  })

  it('refuses model-unsafe bytes before reading or compiling, even when the actor can read the file', async () => {
    mocks.safe.mockResolvedValue(false)
    await expect(readWorkspaceFileArtifact.execute({ principal, input })).rejects.toThrow(
      'File cannot be sent to a model'
    )
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('propagates render failures without inventing an observation', async () => {
    mocks.render.mockRejectedValue(new Error('render failed'))
    await expect(readWorkspaceFileArtifact.execute({ principal, input })).rejects.toThrow(
      'render failed'
    )
  })
})
