/**
 * @vitest-environment node
 */
import {
  authMockFns,
  createMockRequest,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockNotifyAnnotationsUpdated } = vi.hoisted(() => ({
  mockNotifyAnnotationsUpdated: vi.fn(),
}))

vi.mock('@/lib/workflows/annotations', () => ({
  serializeWorkflowAnnotation: (row: Record<string, unknown>) => ({
    id: row.id,
    workflowId: row.workflowId,
    blockId: row.blockId,
    content: row.content,
    createdBy: row.createdBy,
    resolved: row.resolved,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? (row.resolvedAt as Date).toISOString() : null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  }),
  notifyAnnotationsUpdated: mockNotifyAnnotationsUpdated,
}))

import { GET, POST } from '@/app/api/workflows/[id]/annotations/route'

const mockGetSession = authMockFns.mockGetSession
const mockAuthorizeWorkflow = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

const NOW = new Date('2026-07-24T00:00:00.000Z')

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ann-1',
    workflowId: 'wf-1',
    blockId: 'block-1',
    content: 'Watch the rate limit here',
    createdBy: 'user-1',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function callGet(id = 'wf-1') {
  const url = `http://localhost:3000/api/workflows/${id}/annotations`
  return GET(createMockRequest('GET', undefined, {}, url), { params: Promise.resolve({ id }) })
}

function callPost(body: unknown, id = 'wf-1') {
  const url = `http://localhost:3000/api/workflows/${id}/annotations`
  return POST(createMockRequest('POST', body, {}, url), { params: Promise.resolve({ id }) })
}

describe('workflow annotations collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeWorkflow.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'write',
    })
  })

  describe('GET', () => {
    it('returns 401 without a session', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await callGet()
      expect(response.status).toBe(401)
    })

    it('returns 403 when the user cannot read the workflow', async () => {
      mockAuthorizeWorkflow.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Access denied',
        workflow: null,
        workspacePermission: null,
      })
      const response = await callGet()
      expect(response.status).toBe(403)
      expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        userId: 'user-1',
        action: 'read',
      })
    })

    it('returns serialized annotations for the workflow', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow()])
      const response = await callGet()
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.annotations).toHaveLength(1)
      expect(data.annotations[0]).toMatchObject({
        id: 'ann-1',
        blockId: 'block-1',
        content: 'Watch the rate limit here',
        createdAt: NOW.toISOString(),
      })
    })
  })

  describe('POST', () => {
    it('returns 401 without a session', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await callPost({ blockId: 'block-1', content: 'hi' })
      expect(response.status).toBe(401)
    })

    it('requires write permission', async () => {
      mockAuthorizeWorkflow.mockResolvedValue({
        allowed: false,
        status: 403,
        message: 'Access denied',
        workflow: null,
        workspacePermission: 'read',
      })
      const response = await callPost({ blockId: 'block-1', content: 'hi' })
      expect(response.status).toBe(403)
      expect(mockAuthorizeWorkflow).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        userId: 'user-1',
        action: 'write',
      })
    })

    it('rejects an empty comment', async () => {
      const response = await callPost({ blockId: 'block-1', content: '' })
      expect(response.status).toBe(400)
    })

    it('creates the annotation and notifies collaborators', async () => {
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow()])
      const response = await callPost({ blockId: 'block-1', content: 'Watch the rate limit here' })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.annotation).toMatchObject({
        id: 'ann-1',
        blockId: 'block-1',
        createdBy: 'user-1',
      })
      expect(mockNotifyAnnotationsUpdated).toHaveBeenCalledWith('wf-1')
    })
  })
})
