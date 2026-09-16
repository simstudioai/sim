/** @vitest-environment node */
import { member } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  config: vi.fn(),
  index: vi.fn(),
  createServer: vi.fn(),
  handle: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  requireSearch: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest = mocks.handle
  },
}))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mocks.authenticate,
  V2ApiKeyUnauthenticatedError: class extends Error {},
}))
vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100 }),
  RateLimiter: class {
    checkRateLimitDirect = async () => ({ allowed: true, remaining: 99, resetAt: new Date() })
    checkRateLimitDirectOrThrow = async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(),
    })
  },
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'http://localhost' }))
vi.mock('@/lib/knowledge/mcp/server', () => ({ createKnowledgeMcpServer: mocks.createServer }))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOwnerContext: (owner: { organizationId: string }) => ({
    organizationId: owner.organizationId,
    workspaceId: undefined,
  }),
}))
vi.mock('@/lib/knowledge/application/billing', () => ({
  resolveKnowledgeAttributedUserId: (principal: { userId: string }) => principal.userId,
}))
vi.mock('@/lib/knowledge/search/search-index', () => ({ findSearchIndex: mocks.index }))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: mocks.config,
}))
vi.mock('@/lib/credential-groups/service', () => ({ ensureWorkspaceAccountsGroup: vi.fn() }))
vi.mock('@/lib/knowledge/service', () => ({ createAuthorizedKnowledgeBase: vi.fn() }))
vi.mock('@/lib/knowledge/embeddings', () => ({ getConfiguredKbEmbedding: vi.fn() }))
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  createKnowledgeBase: { execute: vi.fn() },
}))
vi.mock('@/lib/knowledge/application/connectors', () => ({
  createKnowledgeConnector: { execute: vi.fn() },
}))
vi.mock('@/lib/knowledge/application/connector-access', () => ({
  startKnowledgeConnectorMemberEnrollment: { execute: vi.fn() },
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireKnowledgeMemberAccessAvailable: vi.fn(),
  requireSourceMirroredAccessAvailable: vi.fn(),
  requireOrganizationSearchAvailable: mocks.requireSearch,
}))
vi.mock('@/connectors/registry', () => ({ CONNECTOR_META_REGISTRY: {} }))
vi.mock('@/lib/sim-search/connectors', () => ({
  SIM_SEARCH_KNOWLEDGE_BASE_NAME: 'Sim Search',
  canConnectPersonally: vi.fn(),
  missingSetupFields: vi.fn(),
}))

import { V2ApiKeyUnauthenticatedError } from '@/lib/api/server/routes/v2-api-key-auth'
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@/lib/auth/oauth-provider'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createKnowledgeMcpHandlers } from '@/lib/knowledge/mcp/route-handler'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

const resource = 'http://localhost/api/mcp/search/organizations/org-1'
const handlers = createKnowledgeMcpHandlers()
const principal = { kind: 'personal_api_key' as const, userId: 'person-1', keyId: 'key-1' }
const auth = {
  principal,
  keyType: 'personal' as const,
  keyExpiresAt: null,
  rateLimitSubjectIds: ['person-1'] as const,
  rateLimitSubscription: null,
}
function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/mcp/search/organizations/org-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      'x-api-key': 'personal-key',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
}
function post(req = request()) {
  return handlers.POST(req, { params: Promise.resolve({ organizationId: 'org-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.authenticate.mockResolvedValue(auth)
  mocks.config.mockResolvedValue(null)
  mocks.requireSearch.mockResolvedValue(undefined)
  mocks.index.mockResolvedValue({ id: 'index-1' })
  mocks.createServer.mockReturnValue({ connect: mocks.connect, close: mocks.close })
  mocks.handle.mockImplementation(
    async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        headers: { 'Content-Type': 'application/json' },
      })
  )
  queueTableRows(member, [{ role: 'member' }])
})

describe('organization MCP request admission', () => {
  it.each(['GET', 'POST', 'DELETE'] as const)(
    'advertises OAuth discovery on an unauthenticated %s',
    async (method) => {
      mocks.authenticate.mockRejectedValue(new V2ApiKeyUnauthenticatedError())
      const response = await handlers[method](request(), {
        params: Promise.resolve({ organizationId: 'org-1' }),
      })
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBe(
        'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp/search/organizations/org-1", scope="search:read offline_access"'
      )
      expect(mocks.index).not.toHaveBeenCalled()
    }
  )

  it('requests Search scope without exposing the index for insufficient OAuth grants', async () => {
    mocks.authenticate.mockResolvedValue({
      ...auth,
      principal: {
        kind: 'oauth_access_token',
        userId: 'person-1',
        clientId: 'client',
        tokenId: 'token',
        scopes: ['offline_access'],
        expiresAt: new Date('2099-01-01'),
      },
    })
    const response = await post()
    expect(response.status).toBe(403)
    expect(response.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"')
    expect(response.headers.get('WWW-Authenticate')).toContain('scope="search:read offline_access"')
    expect(mocks.index).not.toHaveBeenCalled()
  })

  it('admits a current personal-key member and binds the canonical organization index', async () => {
    const result = await post()
    expect(result.status).toBe(200)
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.index).toHaveBeenCalledWith({ kind: 'organization', organizationId: 'org-1' })
    expect(mocks.requireSearch).toHaveBeenCalledExactlyOnceWith('org-1')
    expect(mocks.createServer).toHaveBeenCalledWith(
      expect.objectContaining({ auth, organizationId: 'org-1', searchIndexId: 'index-1' })
    )
    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.authenticate).toHaveBeenCalledWith(
      { apiKey: 'personal-key', bearer: null },
      { resource, allowUnboundApiTokens: true }
    )
  })
  it('preserves API keys supplied in the MCP bearer header', async () => {
    const req = request({ authorization: 'Bearer personal-key' })
    req.headers.delete('x-api-key')
    expect((await post(req)).status).toBe(200)
    expect(mocks.authenticate).toHaveBeenCalledWith(
      { apiKey: 'personal-key', bearer: null },
      { resource, allowUnboundApiTokens: true }
    )
  })
  it('authenticates OAuth bearer tokens and checks organization membership', async () => {
    const token = `${OAUTH_ACCESS_TOKEN_PREFIX}test-access-token`
    const req = request({ authorization: `Bearer ${token}` })
    req.headers.delete('x-api-key')
    mocks.authenticate.mockResolvedValue({
      ...auth,
      principal: {
        kind: 'oauth_access_token',
        userId: 'person-1',
        clientId: 'client',
        tokenId: 'token',
        scopes: ['search:read'],
        expiresAt: new Date('2099-01-01'),
      },
      keyType: 'oauth',
    })
    expect((await post(req)).status).toBe(200)
    expect(mocks.authenticate).toHaveBeenCalledWith(
      { apiKey: null, bearer: token },
      { resource, allowUnboundApiTokens: true }
    )
    expect(mocks.index).toHaveBeenCalledWith({ kind: 'organization', organizationId: 'org-1' })
  })
  it('rejects workspace API keys even if the workspace ID matches the organization ID', async () => {
    mocks.authenticate.mockResolvedValue({
      ...auth,
      principal: { kind: 'workspace_api_key', workspaceId: 'org-1', keyId: 'workspace-key' },
      keyType: 'workspace',
    })
    expect((await post()).status).toBe(403)
    expect(mocks.index).not.toHaveBeenCalled()
    expect(mocks.createServer).not.toHaveBeenCalled()
  })
  it('denies a removed member before finding the index', async () => {
    dbChainMockFns.limit.mockResolvedValue([])
    expect((await post()).status).toBe(404)
    expect(mocks.index).not.toHaveBeenCalled()
    expect(mocks.requireSearch).not.toHaveBeenCalled()
  })
  it('rejects disabled organization Search before index lookup or MCP discovery', async () => {
    mocks.requireSearch.mockRejectedValue(
      new OrchestrationError('forbidden', 'Search is not enabled for this organization')
    )
    const response = await post()
    expect(response.status).toBe(403)
    expect(mocks.requireSearch).toHaveBeenCalledWith('org-1')
    expect(mocks.index).not.toHaveBeenCalled()
    expect(mocks.createServer).not.toHaveBeenCalled()
  })
  it.each(['disablePersonalApiKeys', 'hideKnowledgeBaseTab'])(
    'enforces current organization policy: %s',
    async (field) => {
      mocks.config.mockResolvedValue({ ...DEFAULT_PERMISSION_GROUP_CONFIG, [field]: true })
      expect((await post()).status).toBe(403)
      expect(mocks.index).not.toHaveBeenCalled()
      expect(mocks.createServer).not.toHaveBeenCalled()
    }
  )
  it('rejects conflicting bearer and header keys before organization lookup', async () => {
    expect((await post(request({ authorization: 'Bearer another-key' }))).status).toBe(401)
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.index).not.toHaveBeenCalled()
  })
  it('denies a foreign origin before opening a protocol transport', async () => {
    expect((await post(request({ origin: 'https://another.example' }))).status).toBe(403)
    expect(mocks.index).not.toHaveBeenCalled()
    expect(mocks.createServer).not.toHaveBeenCalled()
  })
})
