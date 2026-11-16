import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/code/resource-manifest', () => ({
  readResourceManifest: {
    operation: { id: 'workflows.code.resource_manifest.read' },
    execute: mocks.read,
  },
}))

import { GET } from '@/app/api/v2/workspaces/[workspaceId]/resource-manifest/route'

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

const manifest = {
  workspaceId: WORKSPACE_ID,
  tables: [
    {
      key: 'tickets',
      id: 'tbl-1',
      name: 'Tickets',
      columns: [
        { name: 'subject', type: 'string' },
        { name: 'status', type: 'select', options: ['open', 'closed'] },
      ],
    },
  ],
  knowledgeBases: [{ key: 'docs', id: 'kb-1', name: 'Docs' }],
  bindings: [{ key: 'support-slack', id: 'cred-1', name: 'Support Slack', service: 'slack' }],
  workflows: [
    {
      key: 'assign-owner',
      id: 'wf-1',
      name: 'Assign owner',
      inputs: [{ name: 'leads', type: 'array' }],
    },
  ],
  env: ['CRM_KEY'],
  truncated: false,
}

function request(query = '') {
  return new NextRequest(
    `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/resource-manifest${query}`,
    { headers: { 'x-api-key': 'key' } }
  )
}

const context = { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }

describe('GET /api/v2/workspaces/{workspaceId}/resource-manifest', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue(manifest)
  })

  it('returns the manifest the use case read, for the workspace in the path', async () => {
    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect((await response.json()).data).toEqual(manifest)
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ input: { workspaceId: WORKSPACE_ID } })
    )
  })

  it('rejects an unknown query parameter before reading anything', async () => {
    const response = await GET(request('?workflowId=wf-1'), context)

    expect(response.status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('answers 403 while code-first workflows are off', async () => {
    mocks.read.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Code-first workflows are not enabled')
    )

    const response = await GET(request(), context)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })
})
