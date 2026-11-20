/**
 * The two source reads are `headSafe: false`, so a `HEAD` runs only the use case's authorize
 * phase. These run the real use cases behind both routes with the `workflow-code` flag off, so a
 * `HEAD` answers the same 403 its `GET` does instead of a 200 that says the feature is reachable,
 * and the `GET` names the cause (`FEATURE_NOT_ENABLED`) so a client tells it from a role refusal.
 */
import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import {
  createMockWorkspaceApplicationContext,
  workspaceContextMock,
} from '@sim/testing/mocks/workspace-context.mock'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@/lib/workflows/application/principal-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workflows/application/principal-scope')>()),
  resolvePrincipalWorkflowContext: vi.fn(async () => ({
    ...createMockWorkspaceApplicationContext({ workspaceId: WORKSPACE_ID }),
    workflowId: '66666666-7777-4888-9999-000000000000',
    workflow: {},
  })),
}))

import { GET as getSource } from '@/app/api/v2/workflows/[workflowId]/source/route'
import { GET as getResources } from '@/app/api/v2/workspaces/[workspaceId]/workflows/source/resources/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const WORKFLOW_ID = '66666666-7777-4888-9999-000000000000'

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
    access: 'read' as const,
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const routes = [
  {
    name: 'GET /api/v2/workflows/{workflowId}/source',
    handler: getSource,
    url: `http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/source`,
    context: { params: Promise.resolve({ workflowId: WORKFLOW_ID }) },
  },
  {
    name: 'GET /api/v2/workspaces/{workspaceId}/workflows/source/resources',
    handler: getResources,
    url: `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/resources`,
    context: { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
  },
]

describe.each(routes)('$name while workflows as code is off', ({ handler, url, context }) => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
  })

  it.each(['GET', 'HEAD'])('answers %s with 403', async (method) => {
    const response = await handler(
      new NextRequest(url, { method, headers: { 'x-api-key': 'key' } }),
      context
    )

    expect(response.status).toBe(403)
    if (method === 'GET') {
      const body = await response.json()
      expect(body.error.details).toEqual({ code: 'FEATURE_NOT_ENABLED' })
    }
  })
})
