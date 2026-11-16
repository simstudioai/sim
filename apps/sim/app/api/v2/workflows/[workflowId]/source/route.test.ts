import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/application/get-workflow-source', () => ({
  getWorkflowSource: {
    operation: { id: 'workflows.source.read' },
    execute: mocks.read,
  },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { GET } from '@/app/api/v2/workflows/[workflowId]/source/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const WORKFLOW_ID = '66666666-7777-4888-9999-000000000000'
const FINGERPRINT = `sf1:${'c'.repeat(64)}`

const auth = {
  principal: {
    kind: 'workspace_api_key' as const,
    workspaceId: WORKSPACE_ID,
    keyId: 'key-1',
    access: 'write' as const,
  },
  rateLimitSubjectIds: ['api-key:key-1', `workspace:${WORKSPACE_ID}`] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const source = {
  workflowId: WORKFLOW_ID,
  workspaceId: WORKSPACE_ID,
  files: { 'workflow.ts': "// @sim-sdk 1\nexport default workflow('W', () => {})\n" },
  lock: {
    lockVersion: 1 as const,
    blocks: { start: { id: 'b-1', parent: null, binding: 'start', order: 0 } },
    variables: {},
  },
  lockBase: { workspaceId: WORKSPACE_ID, baseFingerprint: FINGERPRINT, catalogHash: 'h' },
  fingerprint: FINGERPRINT,
  canonicalHash: 'd'.repeat(64),
  catalogVersion: 'h',
  sdkMajor: 1,
  blockTypes: ['start_trigger'],
  warnings: [],
}

function request(query = '') {
  return new NextRequest(`http://localhost:3000/api/v2/workflows/${WORKFLOW_ID}/source${query}`, {
    headers: { 'x-api-key': 'key' },
  })
}

const context = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

describe('GET /api/v2/workflows/{workflowId}/source', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue(source)
  })

  it('passes annotateIds as a boolean and functionCode through, omitting absent flags', async () => {
    await GET(request('?annotateIds=1&functionCode=inline'), context)
    await GET(request(), context)

    expect(mocks.read.mock.calls[0][0].input).toEqual({
      workflowId: WORKFLOW_ID,
      annotateIds: true,
      functionCode: 'inline',
    })
    expect(mocks.read.mock.calls[1][0].input).toEqual({ workflowId: WORKFLOW_ID })
  })

  it.each(['?functionCode=ts', '?annotate=true'])(
    'rejects %s with 400 before reading the workflow',
    async (query) => {
      const response = await GET(request(query), context)

      expect(response.status).toBe(400)
      expect(mocks.read).not.toHaveBeenCalled()
    }
  )

  it('answers 403 while code-first workflows are off', async () => {
    mocks.read.mockRejectedValue(
      new OrchestrationError('forbidden', 'Code-first workflows are not enabled')
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  it('answers 404 for a workflow the key cannot reach', async () => {
    mocks.read.mockRejectedValue(new OrchestrationError('not_found', 'Workflow not found'))

    const response = await GET(request(), context)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})
