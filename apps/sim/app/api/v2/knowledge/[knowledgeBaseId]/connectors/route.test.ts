/**
 * @vitest-environment node
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  sync: vi.fn(),
  listDocuments: vi.fn(),
  updateDocuments: vi.fn(),
  connectorAdded: vi.fn(),
  connectorRemoved: vi.fn(),
  connectorSynced: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/knowledge/api/internal-route', () => ({
  internalKnowledgeAnalytics: {
    connectorAdded: mocks.connectorAdded,
    connectorRemoved: mocks.connectorRemoved,
    connectorSynced: mocks.connectorSynced,
  },
}))
vi.mock('@/lib/knowledge/application/connectors', () => ({
  listKnowledgeConnectors: {
    operation: { id: 'knowledge.connectors.list' },
    execute: mocks.list,
  },
  createKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.create' },
    execute: mocks.create,
  },
  readKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.read' },
    execute: mocks.read,
  },
  updateKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.update' },
    execute: mocks.update,
  },
  deleteKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.delete' },
    execute: mocks.remove,
  },
  syncKnowledgeConnector: {
    operation: { id: 'knowledge.connectors.sync' },
    execute: mocks.sync,
  },
  listKnowledgeConnectorDocuments: {
    operation: { id: 'knowledge.connectors.documents.list' },
    execute: mocks.listDocuments,
  },
  updateKnowledgeConnectorDocuments: {
    operation: { id: 'knowledge.connectors.documents.update' },
    execute: mocks.updateDocuments,
  },
}))

import {
  GET as listConnectorDocuments,
  PATCH as updateConnectorDocuments,
} from '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents/route'
import {
  DELETE as deleteConnector,
  GET as getConnector,
  PATCH as updateConnector,
} from '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/route'
import { POST as syncConnector } from '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/sync/route'
import {
  POST as createConnector,
  GET as listConnectors,
} from '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/route'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'
const KNOWLEDGE_BASE_ID = 'knowledge-1'
const CONNECTOR_ID = 'connector-1'
const PRINCIPAL = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const collectionContext = { params: Promise.resolve({ knowledgeBaseId: KNOWLEDGE_BASE_ID }) }
const connectorContext = {
  params: Promise.resolve({ knowledgeBaseId: KNOWLEDGE_BASE_ID, connectorId: CONNECTOR_ID }),
}
const connector = {
  id: CONNECTOR_ID,
  knowledgeBaseId: KNOWLEDGE_BASE_ID,
  connectorType: 'notion',
  credentialId: 'credential-1',
  sourceConfig: { pageIds: ['page-1'] },
  syncMode: 'full',
  syncIntervalMinutes: 1440,
  status: 'active',
  lastSyncAt: null,
  lastSyncError: null,
  lastSyncDocCount: null,
  nextSyncAt: null,
  consecutiveFailures: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}
const document = {
  id: 'document-1',
  filename: 'Page one',
  externalId: 'page-1',
  sourceUrl: 'https://notion.so/page-1',
  enabled: true,
  userExcluded: false,
  uploadedAt: new Date('2026-01-03T00:00:00Z'),
  processingStatus: 'completed',
}

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      'x-api-key': 'key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('v2 knowledge connector routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.list.mockResolvedValue({
      connectors: [connector],
      hasMore: false,
      offset: 0,
      limit: 50,
    })
    mocks.create.mockResolvedValue({ connector, workspaceId: WORKSPACE_ID })
    mocks.read.mockResolvedValue({ connector: { ...connector, syncLogs: [] } })
    mocks.update.mockResolvedValue({ connector })
    mocks.remove.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: CONNECTOR_ID,
      connectorType: connector.connectorType,
      documentsDeleted: 0,
      documentsKept: 1,
    })
    mocks.sync.mockResolvedValue({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      workspaceId: WORKSPACE_ID,
      connectorId: CONNECTOR_ID,
      connectorType: connector.connectorType,
    })
    mocks.listDocuments.mockResolvedValue({
      documents: [document],
      counts: { active: 1, excluded: 0 },
      hasMore: false,
      offset: 0,
      limit: 50,
    })
    mocks.updateDocuments.mockResolvedValue({
      operation: 'exclude',
      count: 1,
      documentIds: [document.id],
    })
  })

  it('lists connectors without secret fields', async () => {
    const response = await listConnectors(
      request(`/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors?workspaceId=${WORKSPACE_ID}`),
      collectionContext
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data[0]).toMatchObject({ id: CONNECTOR_ID, connectorType: 'notion' })
    expect(body.data[0]).not.toHaveProperty('encryptedApiKey')
    expect(body.nextCursor).toBeNull()
  })

  it('creates a connector with principal-derived billing and write-only API keys', async () => {
    const response = await createConnector(
      request(`/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors`, 'POST', {
        workspaceId: WORKSPACE_ID,
        connectorType: 'notion',
        apiKey: 'secret-value',
        sourceConfig: { pageIds: ['page-1'] },
      }),
      collectionContext
    )

    expect(response.status).toBe(201)
    expect((await response.json()).data).not.toHaveProperty('apiKey')
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.not.objectContaining({ resolveBillingAttribution: expect.anything() }),
      })
    )
    expect(mocks.connectorAdded).toHaveBeenCalledOnce()
  })

  it('gets, updates, and deletes one connector', async () => {
    const getResponse = await getConnector(
      request(
        `/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}?workspaceId=${WORKSPACE_ID}`
      ),
      connectorContext
    )
    expect(getResponse.status).toBe(200)
    expect((await getResponse.json()).data.syncLogs).toEqual([])

    const patchResponse = await updateConnector(
      request(`/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}`, 'PATCH', {
        workspaceId: WORKSPACE_ID,
        status: 'paused',
      }),
      connectorContext
    )
    expect(patchResponse.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          assertedWorkspaceId: WORKSPACE_ID,
          updates: expect.objectContaining({ status: 'paused' }),
        }),
      })
    )

    const deleteResponse = await deleteConnector(
      request(
        `/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}?workspaceId=${WORKSPACE_ID}&deleteDocuments=false`,
        'DELETE'
      ),
      connectorContext
    )
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({
      data: {
        id: CONNECTOR_ID,
        deleted: true,
        documentsDeleted: 0,
        documentsKept: 1,
      },
    })
    expect(mocks.connectorRemoved).toHaveBeenCalledOnce()
  })

  it('serializes skipped-document counts in non-empty sync history', async () => {
    mocks.read.mockResolvedValueOnce({
      connector: {
        ...connector,
        syncLogs: [
          {
            id: 'sync-log-1',
            connectorId: CONNECTOR_ID,
            status: 'completed',
            startedAt: new Date('2026-01-03T00:00:00Z'),
            completedAt: new Date('2026-01-03T00:01:00Z'),
            docsAdded: 1,
            docsUpdated: 2,
            docsDeleted: 3,
            docsUnchanged: 4,
            docsSkipped: 5,
            docsFailed: 6,
            errorMessage: null,
          },
        ],
      },
    })

    const response = await getConnector(
      request(
        `/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}?workspaceId=${WORKSPACE_ID}`
      ),
      connectorContext
    )

    expect(response.status).toBe(200)
    expect((await response.json()).data.syncLogs[0]).toMatchObject({
      id: 'sync-log-1',
      docsSkipped: 5,
      startedAt: '2026-01-03T00:00:00.000Z',
      completedAt: '2026-01-03T00:01:00.000Z',
    })
  })

  it('passes source changes to application billing without an adapter resolver', async () => {
    const response = await updateConnector(
      request(`/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}`, 'PATCH', {
        workspaceId: WORKSPACE_ID,
        sourceConfig: { pageIds: ['page-2'] },
      }),
      connectorContext
    )

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          assertedWorkspaceId: WORKSPACE_ID,
          updates: expect.objectContaining({ sourceConfig: { pageIds: ['page-2'] } }),
        }),
      })
    )
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.not.objectContaining({ resolveBillingAttribution: expect.anything() }),
      })
    )
  })

  it('queues connector synchronization without an adapter billing resolver', async () => {
    const response = await syncConnector(
      request(`/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}/sync`, 'POST', {
        workspaceId: WORKSPACE_ID,
        rehydrate: true,
      }),
      connectorContext
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id: CONNECTOR_ID, syncTriggered: true },
    })
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.not.objectContaining({ resolveBillingAttribution: expect.anything() }),
      })
    )
    expect(mocks.connectorSynced).toHaveBeenCalledOnce()
  })

  it('lists and updates connector documents', async () => {
    const getResponse = await listConnectorDocuments(
      request(
        `/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}/documents?workspaceId=${WORKSPACE_ID}`
      ),
      connectorContext
    )
    expect(getResponse.status).toBe(200)
    expect((await getResponse.json()).data[0]).toEqual({
      id: document.id,
      filename: document.filename,
      externalId: document.externalId,
      sourceUrl: document.sourceUrl,
      enabled: true,
      userExcluded: false,
      createdAt: '2026-01-03T00:00:00.000Z',
      processingStatus: 'completed',
    })

    const patchResponse = await updateConnectorDocuments(
      request(
        `/api/v2/knowledge/${KNOWLEDGE_BASE_ID}/connectors/${CONNECTOR_ID}/documents`,
        'PATCH',
        {
          workspaceId: WORKSPACE_ID,
          operation: 'exclude',
          documentIds: [document.id],
        }
      ),
      connectorContext
    )
    expect(patchResponse.status).toBe(200)
    expect(await patchResponse.json()).toEqual({
      data: { operation: 'exclude', updatedCount: 1, documentIds: [document.id] },
    })
  })
})
