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

import { DELETE, PATCH } from '@/app/api/workflows/[id]/annotations/[annotationId]/route'

const mockGetSession = authMockFns.mockGetSession
const mockAuthorizeWorkflow = workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

const NOW = new Date('2026-07-24T00:00:00.000Z')

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ann-1',
    workflowId: 'wf-1',
    blockId: 'block-1',
    content: 'Original comment',
    createdBy: 'user-1',
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function callPatch(body: unknown, annotationId = 'ann-1', id = 'wf-1') {
  const url = `http://localhost:3000/api/workflows/${id}/annotations/${annotationId}`
  return PATCH(createMockRequest('PATCH', body, {}, url), {
    params: Promise.resolve({ id, annotationId }),
  })
}

function callDelete(annotationId = 'ann-1', id = 'wf-1') {
  const url = `http://localhost:3000/api/workflows/${id}/annotations/${annotationId}`
  return DELETE(createMockRequest('DELETE', undefined, {}, url), {
    params: Promise.resolve({ id, annotationId }),
  })
}

describe('workflow annotation detail route', () => {
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

  describe('PATCH', () => {
    it('returns 401 without a session', async () => {
      mockGetSession.mockResolvedValue(null)
      const response = await callPatch({ resolved: true })
      expect(response.status).toBe(401)
    })

    it('rejects a body with neither content nor resolved', async () => {
      const response = await callPatch({})
      expect(response.status).toBe(400)
    })

    it('returns 404 when the annotation does not exist', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [])
      const response = await callPatch({ resolved: true })
      expect(response.status).toBe(404)
    })

    it('forbids editing content of a comment authored by someone else', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow({ createdBy: 'user-2' })])
      const response = await callPatch({ content: 'hijacked' })
      expect(response.status).toBe(403)
    })

    it('lets any writer resolve a comment authored by someone else', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow({ createdBy: 'user-2' })])
      dbChainMockFns.returning.mockResolvedValueOnce([
        makeRow({ createdBy: 'user-2', resolved: true, resolvedBy: 'user-1', resolvedAt: NOW }),
      ])
      const response = await callPatch({ resolved: true })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.annotation.resolved).toBe(true)
      expect(data.annotation.resolvedBy).toBe('user-1')
      expect(mockNotifyAnnotationsUpdated).toHaveBeenCalledWith('wf-1')
    })

    it('lets the author edit content', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow()])
      dbChainMockFns.returning.mockResolvedValueOnce([makeRow({ content: 'Edited comment' })])
      const response = await callPatch({ content: 'Edited comment' })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.annotation.content).toBe('Edited comment')
    })
  })

  describe('DELETE', () => {
    it('returns 404 when the annotation does not exist', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [])
      const response = await callDelete()
      expect(response.status).toBe(404)
    })

    it("forbids deleting someone else's comment without admin", async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow({ createdBy: 'user-2' })])
      const response = await callDelete()
      expect(response.status).toBe(403)
    })

    it('lets a workspace admin delete any comment', async () => {
      mockAuthorizeWorkflow.mockResolvedValue({
        allowed: true,
        status: 200,
        workflow: { id: 'wf-1', workspaceId: 'ws-1' },
        workspacePermission: 'admin',
      })
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow({ createdBy: 'user-2' })])
      const response = await callDelete()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
      expect(mockNotifyAnnotationsUpdated).toHaveBeenCalledWith('wf-1')
    })

    it('lets the author delete their own comment', async () => {
      queueTableRows(schemaMock.workflowBlockAnnotation, [makeRow()])
      const response = await callDelete()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
    })
  })
})
