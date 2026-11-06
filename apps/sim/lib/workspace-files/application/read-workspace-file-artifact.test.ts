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
  '@/lib/uploads/contexts/workspace/file-secret-provenance',
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

import {
  type ContentDeliveryGate,
  ContentRefusedError,
  observeContentDelivery,
} from '@/lib/core/application'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import { readWorkspaceFileArtifact } from '@/lib/workspace-files/application/read-workspace-file-artifact'

const mocks = {
  permission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  context: workspaceFileReferenceMockFns.mockResolveReferencedWorkspaceFileContext,
  ...hoisted,
  provenance: workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
}

/** Records each item it is asked about and admits only the ones with no recorded secret. */
const decided: unknown[] = []
const secretFreeGate: ContentDeliveryGate = {
  async admit(sources) {
    decided.push(...sources)
    return sources.map(
      ({ provenance }) =>
        provenance.status === 'unrecorded' ||
        (provenance.status === 'exact' && provenance.entries.length === 0)
    )
  },
}
const chatPrincipal = createCopilotChatFilePrincipal({
  userId: 'u',
  workspaceId: 'ws',
  chatId: 'chat',
})
const readAsChat = () =>
  observeContentDelivery(secretFreeGate, () =>
    readWorkspaceFileArtifact.execute({ principal: chatPrincipal, input })
  )

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
    decided.length = 0
    mocks.permission.mockResolvedValue('read')
    mocks.provenance.mockResolvedValue({ status: 'exact', entries: [] })
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
    expect(mocks.provenance).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'unknown' },
    { status: 'exact', entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'u' }] },
  ])(
    'refuses Chat model-unsafe bytes before reading or compiling, even when the actor can read the file: %j',
    async (provenance) => {
      mocks.provenance.mockResolvedValue(provenance)
      await expect(readAsChat()).rejects.toBeInstanceOf(ContentRefusedError)
      expect(mocks.render).not.toHaveBeenCalled()
    }
  )

  it('classifies the file as an opaque view bound to the bytes it renders', async () => {
    expect((await readAsChat()).buffer).toEqual(Buffer.from('%PDF-1.7'))
    expect(mocks.provenance).toHaveBeenCalledWith('ws', {
      fileId: 'file',
      key: 'canonical-key',
      context: 'workspace',
      contentUpdatedAt: file.contentUpdatedAt,
    })
    expect(decided).toEqual([expect.objectContaining({ id: 'file', view: 'opaque' })])
  })

  it('renders for a caller outside Chat without classifying', async () => {
    mocks.provenance.mockResolvedValue({ status: 'unknown' })
    expect((await readWorkspaceFileArtifact.execute({ principal, input })).buffer).toEqual(
      Buffer.from('%PDF-1.7')
    )
    expect(mocks.provenance).not.toHaveBeenCalled()
  })
})
