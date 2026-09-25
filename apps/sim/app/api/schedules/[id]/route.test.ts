/**
 * Tests for schedule reactivate PUT API route
 */
import {
  auditMock,
  authMockFns,
  databaseMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@sim/audit', () => auditMock)

import { PUT } from './route'

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://test/api/schedules/sched-1'), {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function createParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

const mockDbSelect = databaseMock.db.select as ReturnType<typeof vi.fn>
const mockDbUpdate = databaseMock.db.update as ReturnType<typeof vi.fn>

function mockDbChain(selectResults: unknown[][]) {
  let selectCallIndex = 0
  mockDbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => selectResults[selectCallIndex++] || [],
      }),
    }),
  }))

  mockDbUpdate.mockImplementation(() => ({
    set: () => ({
      where: vi.fn().mockResolvedValue({}),
    }),
  }))
}

describe('Schedule PUT API (Reactivate)', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'wf-1', workspaceId: 'ws-1' },
      workspacePermission: 'write',
    })
  })

  describe('Authorization', () => {
    it('returns 403 when user is not workflow owner', async () => {
      workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        workflow: { id: 'wf-1', workspaceId: null },
        workspacePermission: null,
        message:
          'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
      })
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'other-user', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Personal workflows are deprecated')
    })

    it('returns 403 for workspace member with only read permission', async () => {
      workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
        allowed: false,
        status: 403,
        workflow: { id: 'wf-1', workspaceId: 'ws-1' },
        workspacePermission: 'read',
        message: 'Unauthorized: Access denied to write this workflow',
      })
      mockDbChain([
        [{ id: 'sched-1', workflowId: 'wf-1', status: 'disabled' }],
        [{ userId: 'other-user', workspaceId: 'ws-1' }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(403)
    })
  })

  describe('Schedule State Handling', () => {
    it('returns 400 when schedule has invalid cron expression', async () => {
      mockDbChain([
        [
          {
            id: 'sched-1',
            workflowId: 'wf-1',
            status: 'disabled',
            cronExpression: 'invalid-cron',
            timezone: 'UTC',
          },
        ],
        [{ userId: 'user-1', workspaceId: null }],
      ])

      const res = await PUT(createRequest({ action: 'reactivate' }), createParams('sched-1'))

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe('Schedule has invalid cron expression')
    })
  })
})
