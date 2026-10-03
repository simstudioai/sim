import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
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

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET, PUT } from '@/app/api/v2/workflows/[workflowId]/state/route'

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
  rateLimitSubjectIds: ['api-key:personal-key-1', 'user:user-1'] as const,
  rateLimitSubscription: null,
  keyType: 'personal' as const,
}

const routeContext = { params: Promise.resolve({ workflowId: WORKFLOW_ID }) }

function putRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const EMPTY_LINT = {
  sources: [],
  sinks: [],
  orphanBlocks: [],
  emptyOutgoingPorts: [],
  invalidBranchPorts: [],
  invalidConnectionTargets: [],
  fieldIssues: [],
  unresolvedReferences: [],
  tableFieldIssues: [],
  notes: [],
}

describe('/api/v2/workflows/[workflowId]/state', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(personalAuth)
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
      lint: EMPTY_LINT,
      dryRun: false,
    })
  })

  /**
   * Next aliases a missing `HEAD` export onto `GET`, so the handler runs with
   * `request.method === 'HEAD'`. The route is declared head-safe, which means
   * the probe must run the read and produce the same representation the `GET`
   * would — not the bodiless `v2HeadNoEffect` short-circuit a `headSafe: false`
   * route answers with, which would make the endpoint useless for polling.
   */
  it('answers a HEAD through the GET with the same representation', async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/v2/workflows/${WORKFLOW_ID}/state`, {
        method: 'HEAD',
      }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: GRAPH })
    expect(mocks.readWorkflowGraph).toHaveBeenCalledOnce()
  })

  it('accepts the published empty-graph example', async () => {
    const response = await PUT(putRequest({ blocks: {}, edges: [] }), routeContext)

    expect(response.status).toBe(200)
    expect(mocks.replaceWorkflowState).toHaveBeenCalledOnce()
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

  it('accepts a graph read straight back from the GET', async () => {
    const response = await PUT(putRequest(GRAPH), routeContext)

    expect(response.status).toBe(200)
  })
})
