import type { Principal } from '@sim/auth/principal'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileReferenceMock,
  workspaceFileReferenceMockFns,
} from '@sim/testing/mocks/workspace-file-reference.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  render: vi.fn(),
}))
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock(
  '@/lib/workspace-files/application/resolve-workspace-file-reference',
  () => workspaceFileReferenceMock
)
vi.mock('@/lib/workspace-files/application/resolve-rendered-workspace-artifact', () => ({
  resolveRenderedWorkspaceArtifact: hoisted.render,
}))

import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'

const mocks = {
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  context: workspaceFileReferenceMockFns.mockResolveReferencedWorkspaceFileContext,
  ...hoisted,
  safe: workspaceFileSecretProvenanceMockFns.mockIsOpaqueWorkspaceFileEgressSafe,
}

const principal: Principal = createSessionPrincipal({ userId: 'u', sessionId: 's' })
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
})
