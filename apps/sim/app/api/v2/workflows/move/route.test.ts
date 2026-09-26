import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ moveWorkflowsBulk: vi.fn() }))

vi.mock('@/lib/workflows/application/move-workflows-bulk', () => ({
  moveWorkflowsBulk: { operation: { id: 'workflows.bulk.move' }, execute: mocks.moveWorkflowsBulk },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { POST } from '@/app/api/v2/workflows/move/route'

const WORKSPACE_ID = 'workspace-1'
const auth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: WORKSPACE_ID, keyId: 'ws-key-1' },
  rateLimitSubjectIds: ['api-key:ws-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

function request(body: unknown) {
  return new NextRequest('http://localhost/api/v2/workflows/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/workflows/move', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.moveWorkflowsBulk.mockResolvedValue({
      moved: ['workflow-1'],
      failed: ['workflow-2'],
      folderId: 'folder-1',
      changes: [],
    })
  })

  it('normalizes a folder path with no leading slash', async () => {
    await POST(
      request({ workspaceId: WORKSPACE_ID, workflowIds: ['workflow-1'], folderPath: 'Operations' })
    )

    expect(mocks.moveWorkflowsBulk).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ folderPath: '/Operations' }),
      })
    )
  })

  it('rejects a batch above the cap', async () => {
    const response = await POST(
      request({
        workspaceId: WORKSPACE_ID,
        workflowIds: Array.from({ length: 101 }, (_, index) => `workflow-${index}`),
        folderPath: '/Operations',
      })
    )

    expect(response.status).toBe(400)
    expect(mocks.moveWorkflowsBulk).not.toHaveBeenCalled()
  })
})
