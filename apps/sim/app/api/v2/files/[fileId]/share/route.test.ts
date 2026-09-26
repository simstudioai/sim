import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1RateLimitContextModuleMock } from '@sim/testing/mocks/v1-route.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateShare: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

vi.mock('@/lib/api/server/rate-limit-context', () => v1RateLimitContextModuleMock)

vi.mock('@/lib/workspace-files/application/share-workspace-file', () => ({
  getWorkspaceFileShare: {
    operation: { id: 'files.share.read', minimumRole: 'read', workspaceApiKey: 'allow' },
    execute: vi.fn(),
  },
  updateWorkspaceFileShare: {
    operation: { id: 'files.share.update', minimumRole: 'write', workspaceApiKey: 'allow' },
    execute: mocks.updateShare,
  },
}))

import { PATCH } from '@/app/api/v2/files/[fileId]/share/route'

const WORKSPACE_ID = 'workspace-1'
const FILE_ID = 'wf_1'
const PRINCIPAL = createWorkspaceApiKeyPrincipal({ workspaceId: WORKSPACE_ID })
const AUTH = {
  principal: PRINCIPAL,
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}
const SHARE = {
  id: 'shr_1',
  token: 'existing-token-abcd',
  url: 'https://www.sim.ai/f/existing-token-abcd',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: FILE_ID,
  authType: 'public' as const,
  hasPassword: false,
  allowedEmails: [] as string[],
}
const context = createRouteContext({ fileId: FILE_ID })

function callPatch(body: unknown) {
  return PATCH(
    createMockRequest({
      method: 'PATCH',
      url: `http://localhost:3000/api/v2/files/${FILE_ID}/share`,
      headers: { 'x-api-key': 'key' },
      body,
    }),
    context
  )
}

describe('PATCH /api/v2/files/[fileId]/share', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(AUTH)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.updateShare.mockResolvedValue({ share: SHARE })
  })

  it('rejects a caller-supplied token at the v2 boundary', async () => {
    const response = await callPatch({
      workspaceId: WORKSPACE_ID,
      isActive: true,
      token: 'attacker-chosen-token',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.updateShare).not.toHaveBeenCalled()
  })
})
