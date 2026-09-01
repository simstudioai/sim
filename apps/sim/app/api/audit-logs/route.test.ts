/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))

vi.mock('@/lib/audit-logs/application/list-audit-logs', () => ({
  listAuditLogs: { operation: { id: 'audit_logs.list' }, execute: mocks.execute },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/audit-logs/route'

const log = {
  id: 'audit-1',
  workspaceId: 'workspace-1',
  actorId: 'admin-1',
  actorName: 'Ada',
  actorEmail: 'ada@example.com',
  action: 'workspace.updated',
  resourceType: 'workspace',
  resourceId: 'workspace-1',
  resourceName: 'Engineering',
  description: null,
  metadata: {},
  createdAt: new Date('2026-08-01T00:00:00Z'),
}

describe('GET /api/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1' },
      session: { id: 'session-1' },
    })
    mocks.execute.mockResolvedValue({ data: [log], nextCursor: 'next-1' })
  })

  it('authenticates before parsing the organization query', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/audit-logs'))

    expect(response.status).toBe(400)
    expect(mocks.getSession).toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('keeps the internal envelope while sharing the application operation', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/audit-logs?organizationId=organization-1'
    )
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: [{ id: 'audit-1', actorId: 'admin-1' }],
      nextCursor: 'next-1',
    })
    expect(mocks.execute).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
      input: expect.objectContaining({ organizationId: 'organization-1' }),
      request,
    })
  })

  it('preserves internal typed error presentation', async () => {
    mocks.execute.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Admin required'))

    const response = await GET(
      new NextRequest('http://localhost:3000/api/audit-logs?organizationId=organization-1')
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Admin required' })
  })
})
