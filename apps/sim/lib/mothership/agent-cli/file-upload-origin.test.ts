import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertAuthBinding: vi.fn(),
  completeSession: vi.fn(),
  finalizePurpose: vi.fn(),
  getOwnedSession: vi.fn(),
  getPrincipalSession: vi.fn(),
  reauthorizeWorkspacePurpose: vi.fn(),
  getWorkspaceFile: vi.fn(),
  createSession: vi.fn(),
  authorizeCreate: vi.fn(),
  attribution: vi.fn(),
  authorizeOrganizationAttachment: vi.fn(),
  authorizeOrganizationLogo: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/organization-assistant/application', () => ({
  authorizeOrganizationAttachmentControl: mocks.authorizeOrganizationAttachment,
  createOrganizationAssistantAttachment: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/organization-logo/application', () => ({
  authorizeOrganizationLogoControl: mocks.authorizeOrganizationLogo,
  createOrganizationLogoUpload: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  getWorkspaceFile: mocks.getWorkspaceFile,
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  abortUploadSession: vi.fn(),
  assertUploadSessionAuthBinding: mocks.assertAuthBinding,
  completeUploadSession: mocks.completeSession,
  createUploadPartUrls: vi.fn(),
  createUploadSession: mocks.createSession,
  getOwnedUploadSession: mocks.getOwnedSession,
  getPrincipalUploadSession: mocks.getPrincipalSession,
}))

vi.mock('@/app/api/files/uploads/finalizers', () => ({
  finalizeUploadPurpose: mocks.finalizePurpose,
  finalizeWorkspaceFileUpload: vi.fn(),
  loadCompletedUploadPurpose: vi.fn(),
  loadCompletedWorkspaceFileUpload: vi.fn(),
}))

vi.mock('@/app/api/files/uploads/purposes', () => ({
  createPurposeUploadSession: vi.fn(),
  reauthorizeUploadPurpose: vi.fn(),
  reauthorizeWorkspaceUploadPurpose: mocks.reauthorizeWorkspacePurpose,
  resolveUploadAttributionUserId: mocks.attribution,
}))

vi.mock('@/lib/workspace-files/application/workspace-operation-context', () => ({
  authorizeWorkspaceFileOperation: mocks.authorizeCreate,
}))
vi.mock('@/lib/folders/queries', () => ({
  loadActiveFolderPathIndex: async () => new Map(),
  resolveFolderPathFromIndex: () => null,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createFileUploadTransport } from '@/lib/mothership/agent-cli/file-upload-transport'

const workspaceId = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const endpoint = 'http://localhost:3400'
const cloudTransfer = { method: 'put', url: 'https://storage.test/signed-object', headers: {} }
const session = {
  id: 'upload',
  status: 'uploading',
  fileName: 'deck.pptx',
  contentType: 'application/octet-stream',
  fileSize: 4,
  expiresAt: new Date('2099-01-01'),
  error: null,
  uploadToken: 'fixture',
  transfer: cloudTransfer,
}
const fallback = vi.fn()
function upload(headers: Record<string, string> = {}) {
  const transport = createFileUploadTransport({
    endpoint,
    workspaceId,
    userId: 'reader',
    invocation: { userId: 'reader', workspaceId, chatId: 'chat' },
    fallback,
    uploadProvenance: () => ({ status: 'exact', entries: [] }),
  })
  return transport(`${endpoint}/api/v2/files/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      workspaceId,
      name: 'deck.pptx',
      contentType: 'application/octet-stream',
      size: 4,
    }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorizeCreate.mockResolvedValue(undefined)
  mocks.attribution.mockResolvedValue('reader')
  mocks.createSession.mockResolvedValue(session)
})
describe('embedded upload application request context', () => {
  it.each([
    {},
    {
      origin: 'https://untrusted.test',
      host: 'untrusted.test',
      'x-forwarded-host': 'untrusted.test',
      'x-forwarded-proto': 'https',
    },
  ])(
    'supplies the configured origin to the real authorized operation despite headers %j',
    async (headers) => {
      const response = await upload(headers)
      expect(response.status).toBe(200)
      expect(mocks.authorizeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'delegated',
          subjectUserId: 'reader',
          workspaceId,
          audience: 'sim:workspace-files',
        }),
        expect.objectContaining({ id: 'files.upload.create', minimumRole: 'write' }),
        workspaceId
      )
      expect(mocks.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ localOrigin: endpoint, workspaceId, secretProvenance: 'pending' })
      )
      expect((await response.json()).data.transfer).toEqual(cloudTransfer)
      expect(fallback).not.toHaveBeenCalled()
    }
  )
  it('still rejects canonical authorization failure before creating an upload session', async () => {
    mocks.authorizeCreate.mockRejectedValue(new OrchestrationError('forbidden', 'Access denied'))
    expect((await upload()).status).toBe(403)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
