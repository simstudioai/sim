/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2GateModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readWorkflowGraph: vi.fn(),
  replaceWorkflowState: vi.fn(),
}))

vi.mock('@/lib/workflows/application/read-workflow-graph', () => ({
  readWorkflowGraph: { operation: { id: 'workflows.read' }, execute: mocks.readWorkflowGraph },
}))
vi.mock('@/lib/workflows/application/replace-workflow-state', () => ({
  replaceWorkflowState: {
    operation: { id: 'workflows.state.replace' },
    execute: mocks.replaceWorkflowState,
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/app/api/v2/lib/gate', () => v2GateModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET, PUT } from '@/app/api/v2/workflows/[id]/state/route'

const WORKFLOW_ID = 'workflow-1'
const BLOCK = {
  id: 'block-1',
  type: 'starter',
  name: 'Start',
  position: { x: 0, y: 0 },
  subBlocks: { 'sub-1': { id: 'sub-1', type: 'short-input', value: 'hello' } },
  outputs: {},
  enabled: true,
}
const GRAPH = {
  blocks: { 'block-1': BLOCK },
  edges: [],
  loops: {},
  parallels: {},
  variables: {},
}

const personalAuth = {
  principal: { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'personal-key-1' },
  rolloutUserId: 'user-1',
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}
const workspaceAuth = {
  principal: { kind: 'workspace_api_key' as const, workspaceId: 'workspace-1', keyId: 'ws-key-1' },
  rolloutUserId: 'billing-owner-1',
  rateLimitSubjectIds: ['api-key:ws-key-1'] as const,
  rateLimitSubscription: null,
  keyType: 'workspace' as const,
}

const routeContext = { params: Promise.resolve({ id: WORKFLOW_ID }) }

function putRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/v2/workflows/[id]/state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue(personalAuth)
    v2RouteMocks.gate.mockResolvedValue(null)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.readWorkflowGraph.mockResolvedValue({
      workflowId: WORKFLOW_ID,
      workspaceId: 'workspace-1',
      ...GRAPH,
    })
    mocks.replaceWorkflowState.mockResolvedValue({
      workflowId: WORKFLOW_ID,
      workflowName: 'Daily digest',
      workspaceId: 'workspace-1',
      blocksCount: 1,
      edgesCount: 0,
      warnings: ['Dropped edge "edge-9": target block does not exist'],
      needsRedeployment: true,
    })
  })

  it('returns the graph in the v2 envelope with a private, no-store cache directive', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state`),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: GRAPH })
  })

  it('answers a HEAD through the GET without a body', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state`, {
        method: 'HEAD',
      }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.readWorkflowGraph).toHaveBeenCalledOnce()
  })

  it('rejects an undeclared query param', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state?bogus=1`),
      routeContext
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('BAD_REQUEST')
    expect(mocks.readWorkflowGraph).not.toHaveBeenCalled()
  })

  it('conceals a cross-tenant read as not found, never forbidden', async () => {
    mocks.readWorkflowGraph.mockRejectedValue(new NoWorkspaceAccessError('workspace-2'))

    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state`),
      routeContext
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workflow not found' },
    })
  })

  it('authenticates before parsing the write body', async () => {
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError('No API key'))

    const response = await PUT(putRequest({ nonsense: true }), routeContext)

    expect(response.status).toBe(401)
    expect(v2RouteMocks.operationRate).not.toHaveBeenCalled()
    expect(mocks.replaceWorkflowState).not.toHaveBeenCalled()
  })

  it('replaces the graph and returns the preparation warnings', async () => {
    const response = await PUT(
      putRequest({ blocks: { 'block-1': BLOCK }, edges: [] }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        id: WORKFLOW_ID,
        warnings: ['Dropped edge "edge-9": target block does not exist'],
        needsRedeployment: true,
      },
    })
    expect(mocks.replaceWorkflowState).toHaveBeenCalledWith({
      principal: personalAuth.principal,
      input: {
        workflowId: WORKFLOW_ID,
        blocks: { 'block-1': BLOCK },
        edges: [],
        variables: undefined,
      },
      request: expect.anything(),
    })
  })

  it('accepts a workspace API key, which the operation policy allows', async () => {
    v2RouteMocks.authenticate.mockResolvedValue(workspaceAuth)

    const response = await PUT(
      putRequest({ blocks: { 'block-1': BLOCK }, edges: [] }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mocks.replaceWorkflowState).toHaveBeenCalledWith(
      expect.objectContaining({ principal: workspaceAuth.principal })
    )
  })

  it('accepts a graph read straight back from the GET', async () => {
    const response = await PUT(putRequest(GRAPH), routeContext)

    expect(response.status).toBe(200)
  })

  it('rejects an unknown top-level body member', async () => {
    const response = await PUT(putRequest({ blocks: {}, edges: [], lastSaved: 1 }), routeContext)

    expect(response.status).toBe(400)
    expect(mocks.replaceWorkflowState).not.toHaveBeenCalled()
  })

  it('rejects a block missing the fields the tables require', async () => {
    const response = await PUT(
      putRequest({ blocks: { 'block-1': { id: 'block-1', type: 'starter' } }, edges: [] }),
      routeContext
    )

    expect(response.status).toBe(400)
    expect(mocks.replaceWorkflowState).not.toHaveBeenCalled()
  })
})
