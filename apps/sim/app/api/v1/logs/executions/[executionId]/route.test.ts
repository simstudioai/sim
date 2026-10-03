import { createRouteContext } from '@sim/testing/helpers/http'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { v1LogsMetaMock, v1LogsMetaMockFns } from '@sim/testing/mocks/v1-logs-meta.mock'
import { v1MiddlewareMock, v1MiddlewareMockFns } from '@sim/testing/mocks/v1-middleware.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublicWorkflowLog: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => v1MiddlewareMock)

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

vi.mock('@/lib/logs/public-queries', () => ({
  getPublicWorkflowLog: mocks.getPublicWorkflowLog,
}))

vi.mock('@/app/api/v1/logs/meta', () => v1LogsMetaMock)

import { GET } from '@/app/api/v1/logs/executions/[executionId]/route'
import { getBlock } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'

const { mockCheckRateLimit, mockResolveWorkspaceAccess } = v1MiddlewareMockFns
const { mockGetUserLimits } = v1LogsMetaMockFns

/**
 * Overrides the global stub, whose empty `subBlocks` would let the sanitizer
 * no-op and make this suite pass against an unsanitized route.
 */
vi.mocked(getBlock).mockReturnValue({
  name: 'Gmail',
  subBlocks: [
    { id: 'credential', type: 'oauth-input' },
    { id: 'apiKey', type: 'short-input', password: true },
    { id: 'envApiKey', type: 'short-input', password: true },
    { id: 'subject', type: 'short-input' },
  ],
  outputs: {},
} as unknown as BlockConfig)

const rateLimit = {
  allowed: true,
  userId: 'user-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-08-11T00:00:00Z'),
}

function snapshot() {
  return {
    blocks: {
      'block-1': {
        id: 'block-1',
        type: 'gmail',
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input', value: 'credential-row-id' },
          apiKey: { id: 'apiKey', type: 'short-input', value: 'literal-secret-value' },
          envApiKey: { id: 'envApiKey', type: 'short-input', value: '{{GMAIL_API_KEY}}' },
          subject: { id: 'subject', type: 'short-input', value: 'Weekly digest' },
        },
      },
    },
    edges: [],
  }
}

function requestFor(executionId: string) {
  return {
    request: createMockRequest({ url: `/api/v1/logs/executions/${executionId}` }),
    context: createRouteContext({ executionId }),
  }
}

describe('GET /api/v1/logs/executions/[executionId]', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue(rateLimit)
    mockResolveWorkspaceAccess.mockResolvedValue(null)
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(null)
    mockGetUserLimits.mockResolvedValue({
      usage: { plan: 'free', currentPeriodCost: 12.5, limit: 50, isExceeded: false },
    })
    mocks.getPublicWorkflowLog.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      workflowState: snapshot(),
      trigger: 'api',
      startedAt: new Date('2026-08-11T00:00:00Z'),
      endedAt: new Date('2026-08-11T00:00:01Z'),
      totalDurationMs: 1000,
      costTotal: '0.01',
    })
  })

  it('redacts credentials from the snapshot while preserving env-var references', async () => {
    const { request, context } = requestFor('execution-1')
    const response = await GET(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)

    const subBlocks = body.workflowState.blocks['block-1'].subBlocks
    expect(subBlocks.credential.value).toBeNull()
    expect(subBlocks.apiKey.value).toBeNull()
    expect(subBlocks.envApiKey.value).toBe('{{GMAIL_API_KEY}}')
    expect(subBlocks.subject.value).toBe('Weekly digest')
    expect(JSON.stringify(body)).not.toContain('literal-secret-value')
    expect(JSON.stringify(body)).not.toContain('credential-row-id')
  })

  it("conceals an ordinary access failure behind the surface's not-found", async () => {
    mockResolveWorkspaceAccess.mockResolvedValueOnce({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const { request, context } = requestFor('execution-1')
    const response = await GET(request, context)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Workflow execution not found' })
  })

  /**
   * Both group keys answer only after the caller's workspace role verified, so
   * the caller is already known to be a member: the refusal names their own
   * organization's setting and conceals nothing a 404 would protect.
   */
  it('preserves the structured detail of a post-role permission-group refusal', async () => {
    mockResolveWorkspaceAccess.mockResolvedValueOnce({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Personal API keys are disabled for this workspace',
      details: { code: 'PERSONAL_API_KEYS_DISABLED' },
    })

    const { request, context } = requestFor('execution-1')
    const response = await GET(request, context)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Personal API keys are disabled for this workspace',
      details: { code: 'PERSONAL_API_KEYS_DISABLED' },
    })
  })
})
