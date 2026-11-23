import {
  V2_OPERATION_RATE_LIMIT_ALLOWED,
  V2_PREAUTH_RATE_LIMIT_ALLOWED,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(), authorize: vi.fn() }))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/workflows/application/read-source-resources', () => ({
  readSourceResources: {
    operation: { id: 'workflows.source.resources.read' },
    authorize: mocks.authorize,
    execute: mocks.read,
  },
}))

import { GET } from '@/app/api/v2/workspaces/[workspaceId]/workflows/source/resources/route'

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
  credentials: [{ key: 'support-slack', id: 'cred-1', name: 'Support Slack', provider: 'slack' }],
  workflows: [
    {
      key: 'assign-owner',
      id: 'wf-1',
      name: 'Assign owner',
      inputs: [{ name: 'leads', type: 'array' }],
    },
  ],
  skills: [{ key: 'triage', id: 'skl_1', name: 'Triage' }],
  customTools: [{ key: 'lookup-order', id: 'ctl_1', name: 'lookup_order' }],
  mcpServers: [{ key: 'github', id: 'mcp-1', name: 'GitHub', tools: ['create_issue'] }],
  env: ['CRM_KEY'],
  truncated: false,
}

function request(query = '') {
  return new NextRequest(
    `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/resources${query}`,
    { headers: { 'x-api-key': 'key' } }
  )
}

const context = { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }

describe('GET /api/v2/workspaces/{workspaceId}/workflows/source/resources', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue(manifest)
    mocks.authorize.mockResolvedValue(undefined)
  })

  it('answers HEAD after authorizing without reading, so a probe never allocates resource keys', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/resources`,
        {
          method: 'HEAD',
          headers: { 'x-api-key': 'key' },
        }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledTimes(1)
    expect(mocks.read).not.toHaveBeenCalled()
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
})
