import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)
vi.mock('@/lib/workspace-files/application/move-workspace-file-items', () => ({
  moveWorkspaceFileItemsOperation: {
    operation: { id: 'files.move', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mockExecute,
  },
}))

import { WorkspaceFileMoveConflictError } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { POST } from '@/app/api/v2/files/move/route'

const WS = 'workspace-1'
const auth = {
  principal: createWorkspaceApiKeyPrincipal({ workspaceId: WS }),
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WS}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const callMove = (body: unknown) =>
  POST(
    createMockRequest({
      method: 'POST',
      url: 'http://localhost:3000/api/v2/files/move',
      headers: { 'x-api-key': 'key' },
      body,
    })
  )

describe('POST /api/v2/files/move', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mockExecute.mockResolvedValue({ movedItems: { files: 2, folders: 0 } })
  })

  it('maps a conflict error to 409', async () => {
    mockExecute.mockRejectedValue(new WorkspaceFileMoveConflictError('report.csv'))
    const res = await callMove({ workspaceId: WS, fileIds: ['wf_1'] })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONFLICT')
  })
})
