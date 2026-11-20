import {
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ plan: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workspace-source/application/apply-workspace-source', () => ({
  planWorkspaceSource: { operation: { id: 'workspaces.source.plan' }, execute: mocks.plan },
}))

import { POST } from '@/app/api/v2/workspaces/[workspaceId]/source/plan/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'

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

const WORKFLOW = "// @sim-sdk 1\nexport default workflow('W', () => {})\n"

/** Units each limiter key was charged. */
const charged = new Map<string, number>()

function plan(files: Record<string, string>) {
  return POST(
    new NextRequest(`http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/source/plan`, {
      method: 'POST',
      headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
      body: JSON.stringify({ files, kinds: ['workflow'] }),
    }),
    { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }
  )
}

describe('POST /api/v2/workspaces/{workspaceId}/source/plan', () => {
  beforeEach(() => {
    charged.clear()
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockImplementation(async (key: string, _config, cost = 1) => {
      charged.set(key, (charged.get(key) ?? 0) + cost)
      return {
        allowed: true,
        remaining: 1,
        resetAt: new Date('2026-01-01T01:00:00.000Z'),
        retryAfterMs: 0,
      }
    })
    mocks.plan.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      dryRun: true,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: { version: 1, workspaceId: WORKSPACE_ID, resources: {} },
      diagnostics: [],
    })
  })

  it('charges a plan one unit per workflow folder it evaluates, as an apply is charged', async () => {
    const response = await plan({
      'workflows/a/workflow.ts': WORKFLOW,
      'workflows/b/workflow.ts': WORKFLOW,
      'workflows/c/workflow.ts': WORKFLOW,
    })

    expect(response.status).toBe(200)
    expect(Math.max(...charged.values())).toBe(3)
  })

  it('answers a plan with at most 1000 findings, however many its workflows hold', async () => {
    mocks.plan.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      dryRun: true,
      plan: [],
      applied: [],
      needBlobs: [],
      files: {},
      base: { version: 1, workspaceId: WORKSPACE_ID, resources: {} },
      diagnostics: Array.from({ length: 1_200 }, (_, index) => ({
        code: 'W_CANON_UNRESOLVED_ID' as const,
        severity: 'warning' as const,
        message: `Table gone-${index} no longer exists.`,
        kind: 'workflow' as const,
        key: `w${index}`,
      })),
    })

    const response = await plan({ 'workflows/a/workflow.ts': WORKFLOW })
    const { data } = await response.json()

    expect(response.status).toBe(200)
    expect(data.diagnostics).toHaveLength(1_001)
    expect(data.diagnostics.at(-1)).toMatchObject({ code: 'I_FINDINGS_TRUNCATED' })
  })
})
