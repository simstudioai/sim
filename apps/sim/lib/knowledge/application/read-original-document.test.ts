import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  knowledgeContextsMock,
  knowledgeContextsMockFns,
} from '@sim/testing/mocks/knowledge-contexts.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  provenance: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/knowledge/secret-provenance', () => ({
  createKnowledgeDocumentSourceValue: (doc: { filename: string; fileUrl: string }) => ({
    filename: doc.filename,
    fileUrl: doc.fileUrl,
  }),
  loadKnowledgeDocumentDurableSecretProvenance: mocks.provenance,
}))

import {
  type ContentDeliveryGate,
  ContentRefusedError,
  observeContentDelivery,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KNOWLEDGE_DELEGATION_AUDIENCE } from '@/lib/knowledge/application/authorization'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'

workspaceAuthzMockFns.mockPermissionSatisfies.mockImplementation(
  (actual: string | null) => actual !== null
)

const principal = createSessionPrincipal({ userId: 'reader', sessionId: 'session' })
const document = {
  id: 'doc',
  filename: 'policy.md',
  fileUrl: 'data:text/markdown;base64,IyBQb2xpY3k=',
  storageKey: null,
  fileSize: 8,
  mimeType: 'text/markdown',
  enabled: true,
  processingStatus: 'failed',
}
const context = {
  workspaceId: 'workspace',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  knowledgeBaseId: 'kb',
  document,
}
const input = {
  knowledgeBaseId: 'kb',
  documentId: 'doc',
  assertedWorkspaceId: 'workspace',
  maxBytes: 64,
}
const run = () => readOriginalKnowledgeDocument.execute({ principal, input })

/** A gate with no registry: it admits only items with no recorded secret. */
const secretFreeGate: ContentDeliveryGate = {
  async admit(sources) {
    return sources.map(
      ({ provenance }) =>
        provenance.status === 'unrecorded' ||
        (provenance.status === 'exact' && provenance.entries.length === 0)
    )
  },
}
const runAsChat = () =>
  observeContentDelivery(secretFreeGate, () =>
    readOriginalKnowledgeDocument.execute({
      principal: createCopilotChatPrincipal(
        { userId: 'reader', workspaceId: 'workspace', chatId: 'chat' },
        KNOWLEDGE_DELEGATION_AUDIENCE
      ),
      input,
    })
  )

describe('original knowledge document read', () => {
  beforeEach(() => {
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue(
      context
    )
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    mocks.provenance.mockResolvedValue({
      storageKey: document.storageKey,
      source: { filename: document.filename, fileUrl: document.fileUrl },
      provenance: { status: 'exact', entries: [] },
    })
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('# Policy'))
  })
  it('reports no stored source without fetching an external URL', async () => {
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue({
      ...context,
      document: {
        ...document,
        fileUrl: 'https://example.test/private',
        processingStatus: 'completed',
      },
    })
    mocks.provenance.mockResolvedValue({
      storageKey: document.storageKey,
      source: { filename: document.filename, fileUrl: 'https://example.test/private' },
      provenance: { status: 'exact', entries: [] },
    })
    expect(await run()).toMatchObject({
      indexReady: true,
      sourceAvailable: false,
      buffer: undefined,
    })
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(mocks.provenance).toHaveBeenCalledWith('doc')
  })
  it('rechecks permission before reading source or provenance', async () => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue(null)
    await expect(run()).rejects.toThrow('Insufficient workspace')
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    expect(mocks.provenance).not.toHaveBeenCalled()
  })
  it('conceals a document outside the canonical scope', async () => {
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockRejectedValue(
      new OrchestrationError('not_found', 'Document not found')
    )
    await expect(run()).rejects.toThrow('Document not found')
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
  })
  it('bounds actual inline bytes even when stored metadata understates them', async () => {
    await expect(
      readOriginalKnowledgeDocument.execute({ principal, input: { ...input, maxBytes: 1 } })
    ).rejects.toThrow('byte limit')
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext.mockResolvedValue({
      ...context,
      document: { ...document, fileSize: 1 },
    })
    await expect(
      readOriginalKnowledgeDocument.execute({ principal, input: { ...input, maxBytes: 1 } })
    ).rejects.toThrow(/limit/)
  })
  it.each([{ status: 'unknown' }, { status: 'exact', entries: [{ secret: 'private' }] }])(
    'refuses Chat an original its gate refuses, before reading it: %j',
    async (provenance) => {
      mocks.provenance.mockResolvedValue({
        storageKey: document.storageKey,
        source: { filename: document.filename, fileUrl: document.fileUrl },
        provenance,
      })
      await expect(runAsChat()).rejects.toBeInstanceOf(ContentRefusedError)
      expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
    }
  )
  it('serves Chat a secret-free original under its gate', async () => {
    expect(await runAsChat()).toMatchObject({ sourceAvailable: true, hasRecordedSecrets: false })
  })
  it('classifies a concurrent source replacement as unknown, refusing it before reading', async () => {
    mocks.provenance.mockResolvedValue({
      storageKey: document.storageKey,
      source: { filename: 'changed', fileUrl: document.fileUrl },
      provenance: { status: 'exact', entries: [] },
    })
    await expect(runAsChat()).rejects.toBeInstanceOf(ContentRefusedError)
    expect(storageServiceMockFns.mockDownloadFile).not.toHaveBeenCalled()
  })
  it('reads for a caller outside Chat without classifying, flagging recorded secrets', async () => {
    mocks.provenance.mockResolvedValue({
      storageKey: document.storageKey,
      source: { filename: document.filename, fileUrl: document.fileUrl },
      provenance: { status: 'exact', entries: [{ secret: 'private' }] },
    })
    expect(await run()).toMatchObject({ sourceAvailable: true, hasRecordedSecrets: true })
  })
})
