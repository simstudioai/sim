/** @vitest-environment node */
import {
  MockV2ApiKeyUnauthenticatedError,
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/workflows/application/read-workflow-graph', () => ({
  readWorkflowGraph: { operation: { id: 'workflows.read' }, execute: mocks.read },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { GET } from '@/app/api/v2/workflows/[workflowId]/inspect/route'

const principal = { kind: 'personal_api_key' as const, userId: 'user-1', keyId: 'key-1' }
const context = { params: Promise.resolve({ workflowId: 'workflow-1' }) }
const request = (query = '') =>
  new NextRequest(`http://localhost/api/v2/workflows/workflow-1/inspect?${query}`)

describe('GET workflow inspection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    v2RouteMocks.authenticate.mockResolvedValue({
      principal,
      rateLimitSubjectIds: ['key-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
    })
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
    })
  })

  it('uses the authorized workflow read and returns a private diagnostic envelope', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await response.json()).data).toMatchObject({
      representation: 'diagnostic',
      blocks: [],
      edges: [],
    })
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ principal, input: { workflowId: 'workflow-1' } })
    )
  })

  it('authenticates before parsing and rejects unsupported query options', async () => {
    expect((await GET(request('includeCode=invalid'), context)).status).toBe(400)
    expect((await GET(request('raw=true'), context)).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
    v2RouteMocks.authenticate.mockRejectedValue(new MockV2ApiKeyUnauthenticatedError())
    expect((await GET(request('raw=true'), context)).status).toBe(401)
  })

  it('conceals inaccessible workflows and reports unknown blocks without exposing draft inputs', async () => {
    mocks.read.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await GET(request(), context)).status).toBe(404)
    const response = await GET(request('blockId=missing'), context)
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})
