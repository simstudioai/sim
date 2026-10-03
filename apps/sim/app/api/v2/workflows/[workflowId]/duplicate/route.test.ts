import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ duplicateWorkflow: vi.fn() }))

vi.mock('@/lib/workflows/application/duplicate-workflow', () => ({
  duplicateWorkflow: {
    operation: { id: 'workflows.duplicate' },
    execute: mocks.duplicateWorkflow,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { POST } from '@/app/api/v2/workflows/[workflowId]/duplicate/route'

const WORKFLOW_ID = 'workflow-1'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'ws-key-1' },
  rateLimitSubjectIds: ['api-key:ws-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const routeContext = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/duplicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/workflows/[workflowId]/duplicate', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.duplicateWorkflow.mockResolvedValue({
      id: 'workflow-2',
      name: 'Daily digest (copy)',
      description: null,
      workspaceId: 'workspace-1',
      folderId: null,
      folderPath: '/Operations',
      sortOrder: 0,
      locked: false,
      blocksCount: 3,
      edgesCount: 2,
      subflowsCount: 0,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  it('conceals a cross-tenant duplicate as not found', async () => {
    mocks.duplicateWorkflow.mockRejectedValue(new NoWorkspaceAccessError('workspace-2'))

    const response = await POST(request({}), routeContext)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})
