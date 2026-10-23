import { authMockFns, createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import {
  knowledgeBaseUseCasesMock,
  knowledgeBaseUseCasesMockFns,
} from '@sim/testing/mocks/knowledge-base-use-cases.mock'
import { knowledgeSearchUseCaseMock } from '@sim/testing/mocks/knowledge-search-use-case.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useCase: (id: string, execute: ReturnType<typeof vi.fn>) => ({ operation: { id }, execute }),
  listDocuments: vi.fn(),
  bulkDocuments: vi.fn(),
  readDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  listConnectors: vi.fn(),
  createConnector: vi.fn(),
  readConnector: vi.fn(),
  updateConnector: vi.fn(),
  deleteConnector: vi.fn(),
  syncConnector: vi.fn(),
  listConnectorDocuments: vi.fn(),
  updateConnectorDocuments: vi.fn(),
  createUpload: vi.fn(),
  issueParts: vi.fn(),
  completeUpload: vi.fn(),
  cancelUpload: vi.fn(),
  persistedResponse: vi.fn(),
}))

vi.mock('@/lib/knowledge/application/documents', () => ({
  listKnowledgeDocuments: mocks.useCase('knowledge.documents.list', mocks.listDocuments),
  bulkUpdateKnowledgeDocuments: mocks.useCase('knowledge.documents.bulk', mocks.bulkDocuments),
  readKnowledgeDocument: mocks.useCase('knowledge.documents.read', mocks.readDocument),
  updateKnowledgeDocument: mocks.useCase('knowledge.documents.update', mocks.updateDocument),
  deleteKnowledgeDocument: mocks.useCase('knowledge.documents.delete', mocks.deleteDocument),
}))

vi.mock('@/lib/knowledge/application/knowledge-bases', () => knowledgeBaseUseCasesMock)

vi.mock('@/lib/knowledge/application/connectors', () => ({
  listKnowledgeConnectors: mocks.useCase('knowledge.connectors.list', mocks.listConnectors),
  createKnowledgeConnector: mocks.useCase('knowledge.connectors.create', mocks.createConnector),
  readKnowledgeConnector: mocks.useCase('knowledge.connectors.read', mocks.readConnector),
  updateKnowledgeConnector: mocks.useCase('knowledge.connectors.update', mocks.updateConnector),
  deleteKnowledgeConnector: mocks.useCase('knowledge.connectors.delete', mocks.deleteConnector),
  syncKnowledgeConnector: mocks.useCase('knowledge.connectors.sync', mocks.syncConnector),
  listKnowledgeConnectorDocuments: mocks.useCase(
    'knowledge.connectors.documents.list',
    mocks.listConnectorDocuments
  ),
  updateKnowledgeConnectorDocuments: mocks.useCase(
    'knowledge.connectors.documents.update',
    mocks.updateConnectorDocuments
  ),
}))

vi.mock('@/lib/knowledge/application/search', () => knowledgeSearchUseCaseMock)

vi.mock('@/lib/knowledge/application/upload-sessions', () => ({
  KnowledgeDocumentUnsupportedMediaTypeError: class extends Error {},
  createKnowledgeDocumentUpload: mocks.useCase(
    'knowledge.documents.upload.create',
    mocks.createUpload
  ),
  issueKnowledgeDocumentUploadParts: mocks.useCase(
    'knowledge.documents.upload.parts',
    mocks.issueParts
  ),
  completeKnowledgeDocumentUpload: mocks.useCase(
    'knowledge.documents.upload.complete',
    mocks.completeUpload
  ),
  cancelKnowledgeDocumentUpload: mocks.useCase(
    'knowledge.documents.upload.cancel',
    mocks.cancelUpload
  ),
}))

vi.mock('@/lib/knowledge/api/secret-provenance', () => ({
  finalizeKnowledgePersistedResponse: mocks.persistedResponse,
}))

vi.mock('@/lib/core/telemetry', () => telemetryMock)

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PATCH as updateConnectorDocuments } from '@/app/api/knowledge/[id]/connectors/[connectorId]/documents/route'
import { POST as syncConnector } from '@/app/api/knowledge/[id]/connectors/[connectorId]/sync/route'
import { GET as readKnowledgeBase } from '@/app/api/knowledge/[id]/route'

const { mockReadInternalKnowledgeBaseExecute } = knowledgeBaseUseCasesMockFns

const session = {
  user: { id: 'user-1', email: 'user@example.com', name: 'User' },
  session: { id: 'session-1' },
}

describe('migrated internal Knowledge routes', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue(session)
    mocks.persistedResponse.mockResolvedValue({})
  })

  it('renders unknown knowledge base failures safely', async () => {
    mockReadInternalKnowledgeBaseExecute.mockRejectedValue(new Error('postgres password=secret'))
    const response = await readKnowledgeBase(
      createMockRequest('GET'),
      createRouteContext({ id: 'knowledge-1' })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch knowledge base' })
  })

  it('rejects oversized connector-document mutations at the contract boundary', async () => {
    const response = await updateConnectorDocuments(
      createMockRequest('PATCH', {
        operation: 'exclude',
        documentIds: Array.from({ length: 101 }, (_, index) => `document-${index}`),
      }),
      createRouteContext({ id: 'knowledge-1', connectorId: 'connector-1' })
    )

    expect(response.status).toBe(400)
    expect(mocks.updateConnectorDocuments).not.toHaveBeenCalled()
  })

  it('returns a cooldown conflict as 409 without recording a successful sync event', async () => {
    const message = 'Sync finished recently. Try again in 60 seconds.'
    mocks.syncConnector.mockRejectedValueOnce(new OrchestrationError('conflict', message))

    const response = await syncConnector(
      createMockRequest('POST'),
      createRouteContext({ id: 'knowledge-1', connectorId: 'connector-1' })
    )

    expect(mocks.syncConnector).toHaveBeenCalledOnce()
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: message })
    expect(posthogServerMockFns.mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})
