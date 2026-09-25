import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { knowledgeEmbeddingsMock } from '@sim/testing/mocks/knowledge-embeddings.mock'
import {
  knowledgeServiceMock,
  knowledgeServiceMockFns,
} from '@sim/testing/mocks/knowledge-service.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { telemetryMock } from '@sim/testing/mocks/telemetry.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/audit', () => auditMock)
vi.mock('@/lib/core/telemetry', () => telemetryMock)
vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)
vi.mock('@/lib/knowledge/service', () => knowledgeServiceMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  performCreateKnowledgeBase,
  performUpdateKnowledgeBase,
} from '@/lib/knowledge/orchestration/knowledge-bases'

const mockCreateKnowledgeBase = knowledgeServiceMockFns.mockCreateKnowledgeBase
const mockDeleteKnowledgeBase = knowledgeServiceMockFns.mockDeleteKnowledgeBase
const mockUpdateKnowledgeBase = knowledgeServiceMockFns.mockUpdateKnowledgeBase

const mockRecordAudit = auditMockFns.mockRecordAudit
const mockCaptureServerEvent = posthogServerMockFns.mockCaptureServerEvent

const CREATED = { id: 'kb-1', name: 'Docs', description: null, workspaceId: 'ws-1' }

describe('performCreateKnowledgeBase', () => {
  beforeEach(() => {
    mockCreateKnowledgeBase.mockResolvedValue(CREATED)
  })

  it('classifies a duplicate name as a conflict, not bad input', async () => {
    mockCreateKnowledgeBase.mockRejectedValue(
      new OrchestrationError('conflict', 'A knowledge base named "Docs" already exists')
    )

    const outcome = await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'ui',
      workspaceId: 'ws-1',
      name: 'Docs',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('keeps an unclassified failure internal and records nothing', async () => {
    mockCreateKnowledgeBase.mockRejectedValue(new Error('connection terminated'))

    const outcome = await performCreateKnowledgeBase({
      userId: 'user-1',
      source: 'ui',
      workspaceId: 'ws-1',
      name: 'Docs',
    })

    expect(outcome).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
    expect(mockCaptureServerEvent).not.toHaveBeenCalled()
  })
})

describe('performUpdateKnowledgeBase', () => {
  beforeEach(() => {
    mockUpdateKnowledgeBase.mockResolvedValue({ ...CREATED, name: 'Renamed' })
  })

  it('always forwards the actor, so a workspace move is authorized not rejected', async () => {
    await performUpdateKnowledgeBase({
      knowledgeBaseId: 'kb-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      source: 'api',
      updates: { workspaceId: 'ws-2' },
    })

    // The v1 and v2 routes used to omit `actorUserId`, which the service rejects
    // outright on a workspace change.
    expect(mockUpdateKnowledgeBase).toHaveBeenCalledWith(
      'kb-1',
      { workspaceId: 'ws-2' },
      expect.any(String),
      { actorUserId: 'user-1' }
    )
  })
})
