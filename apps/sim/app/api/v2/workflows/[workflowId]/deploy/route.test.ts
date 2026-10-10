import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { createPersonalApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { auditMock } from '@sim/testing/mocks/audit.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import {
  workflowsOrchestrationMock,
  workflowsOrchestrationMockFns,
} from '@sim/testing/mocks/workflows-orchestration.mock'
import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing/mocks/workflows-persistence-utils.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ buildWorkflowLintReport: vi.fn() }))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/orchestration', () => workflowsOrchestrationMock)
vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)
vi.mock('@/lib/workflows/editing/lint-report', () => ({
  buildWorkflowLintReport: mocks.buildWorkflowLintReport,
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { POST } from '@/app/api/v2/workflows/[workflowId]/deploy/route'

const sideEffectWarning =
  'Deployment activation completed, and post-activation notifications are queued.'

const unquotedRowJson = {
  sources: [],
  sinks: [],
  orphanBlocks: [],
  emptyOutgoingPorts: [],
  invalidBranchPorts: [],
  invalidConnectionTargets: [],
  fieldIssues: [],
  unresolvedReferences: [
    {
      blockId: 'insert',
      blockName: 'Insert Order',
      field: 'data',
      value: ['<start.order_id>'],
      kind: 'block-output' as const,
      reason: 'unquoted-json-string: quote it',
    },
  ],
  tableFieldIssues: [],
  notes: [],
}

describe('POST /api/v2/workflows/[workflowId]/deploy', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue({
      principal: createPersonalApiKeyPrincipal({ userId: 'user-1', keyId: 'personal-key-1' }),
      rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('admin')
    workflowContextMockFns.mockResolveActiveWorkflowApplicationContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
      workflowId: 'workflow-1',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1', isDeployed: true },
    })
    workflowsOrchestrationMockFns.mockPerformFullDeploy.mockResolvedValue({
      success: true,
      version: 4,
      deploymentVersionId: 'version-4',
      activeDeployment: null,
      latestDeploymentAttempt: null,
      warnings: [sideEffectWarning],
    })
    workflowsPersistenceUtilsMockFns.mockLoadWorkflowDeploymentVersionState.mockResolvedValue({
      blocks: {},
      edges: [],
    })
    mocks.buildWorkflowLintReport.mockResolvedValue(unquotedRowJson)
  })

  /**
   * Chat, the CLI, and API callers learn a deployed block cannot run from this
   * response. Mixed into `warnings`, the findings were indistinguishable from
   * failed side effects, so no surface could present them deliberately.
   */
  it('publishes the deployed version lint apart from side-effect warnings', async () => {
    const response = await POST(
      createMockRequest('POST', {}, {}, 'http://localhost/api/v2/workflows/workflow-1/deploy'),
      createRouteContext({ workflowId: 'workflow-1' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.warnings).toEqual([sideEffectWarning])
    expect(body.data.lint.unresolvedReferences).toEqual([
      {
        blockId: 'insert',
        blockName: 'Insert Order',
        blockType: null,
        field: 'data',
        value: ['<start.order_id>'],
        kind: 'block-output',
        reason: 'unquoted-json-string: quote it',
      },
    ])
  })
})
