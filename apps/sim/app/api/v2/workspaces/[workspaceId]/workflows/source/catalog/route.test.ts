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
vi.mock('@/lib/workflows/application/read-source-catalog', () => ({
  readSourceCatalog: {
    operation: { id: 'workflows.source.catalog.read' },
    execute: mocks.read,
  },
}))

import { GET } from '@/app/api/v2/workspaces/[workspaceId]/workflows/source/catalog/route'

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555'
const HASH = 'a'.repeat(64)

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

const catalog = {
  catalogVersion: 1 as const,
  hash: HASH,
  sdkMajor: 1,
  blocks: {
    slack_v2: {
      type: 'slack_v2',
      name: 'Slack',
      category: 'tools',
      subBlocks: [
        {
          id: 'channel',
          type: 'channel-selector',
          valueKind: 'picked',
          storage: 'native',
          condition: { opaque: true },
          visibleFor: { send: true, list_users: false },
          selectorKey: 'slack.channels',
        },
      ],
      tools: { access: ['slack_message'], selector: 'operation' },
      outputs: { ts: { type: 'string' } },
      graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
    },
  },
  triggers: {},
  builders: { 'slack.sendMessage': { type: 'slack_v2', operation: 'send' } },
}

function request(query = '', headers: Record<string, string> = {}) {
  return new NextRequest(
    `http://localhost:3000/api/v2/workspaces/${WORKSPACE_ID}/workflows/source/catalog${query}`,
    { headers: { 'x-api-key': 'key', ...headers } }
  )
}

const context = { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) }

describe('GET /api/v2/workspaces/{workspaceId}/workflows/source/catalog', () => {
  beforeEach(() => {
    v2RouteMocks.authenticate.mockResolvedValue(auth)
    v2RouteMocks.preauthRate.mockResolvedValue(V2_PREAUTH_RATE_LIMIT_ALLOWED)
    v2RouteMocks.operationRate.mockResolvedValue(V2_OPERATION_RATE_LIMIT_ALLOWED)
    mocks.read.mockResolvedValue(catalog)
  })

  it('returns the catalog with its hash as a strong ETag, keeping fields the schema does not name', async () => {
    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"${HASH}"`)
    expect(response.headers.get('cache-control')).toBe('private, no-cache')
    const body = await response.json()
    expect(body.data.blocks.slack_v2.subBlocks[0].selectorKey).toBe('slack.channels')
    expect(body.data).toEqual(catalog)
  })

  it.each([`"${HASH}"`, `W/"${HASH}"`, `"stale", "${HASH}"`, '*'])(
    'answers 304 with no body when If-None-Match is %s',
    async (ifNoneMatch) => {
      const response = await GET(request('', { 'if-none-match': ifNoneMatch }), context)

      expect(response.status).toBe(304)
      expect(response.headers.get('etag')).toBe(`"${HASH}"`)
      expect(await response.text()).toBe('')
    }
  )

  it('answers 200 with the body when If-None-Match names another catalog', async () => {
    const response = await GET(request('', { 'if-none-match': `"${'b'.repeat(64)}"` }), context)

    expect(response.status).toBe(200)
    expect((await response.json()).data.hash).toBe(HASH)
  })

  it('rejects an unknown query parameter before reading the catalog', async () => {
    const response = await GET(request('?shard=docs'), context)

    expect(response.status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
