/**
 * Tests for MCP serve route auth propagation.
 */

import { createRouteContext } from '@sim/testing/helpers/http'
import { authInternalMock } from '@sim/testing/mocks/auth-internal.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import { hybridAuthMockFns } from '@sim/testing/mocks/hybrid-auth.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteWorkflowService,
  mockVerifyOAuthAccessToken,
  MockInvalidOAuthAccessTokenError,
  fetchMock,
} = vi.hoisted(() => ({
  mockExecuteWorkflowService: vi.fn(),
  mockVerifyOAuthAccessToken: vi.fn(),
  MockInvalidOAuthAccessTokenError: class extends Error {
    constructor(readonly reason: string) {
      super('Invalid access token')
    }
  },
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

const {
  mockAssertBillingAttributionSnapshot,
  mockResolveBillingAttribution,
  mockSerializeBillingAttributionHeader,
} = billingAttributionMockFns
const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions
const MCP_BYTE_LIMIT = 10 * 1024 * 1024
const MCP_TOOLS_LIST_LIMIT = 100

function createBillingAttribution(actorUserId: string, workspaceId: string) {
  return {
    actorUserId,
    workspaceId,
    organizationId: null,
    billedAccountUserId: 'payer-1',
    billingEntity: { type: 'user' as const, id: 'payer-1' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
  }
}

function createResolvedSecretTraceProvenance(userId: string, workspaceId = 'ws-1') {
  return {
    version: 1 as const,
    complete: true,
    entries: [],
    scope: { userId, workspaceId },
  }
}

const PERSONAL_API_KEY_PRINCIPAL = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'personal-key-1',
} as const

const OAUTH_WRITE_PRINCIPAL = {
  kind: 'oauth_access_token',
  userId: 'user-1',
  clientId: 'client-1',
  tokenId: 'token-1',
  scopes: ['api:write', 'offline_access'],
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
} as const

const PRIVATE_SERVER = {
  id: 'server-1',
  name: 'Private Server',
  workspaceId: 'ws-1',
  isPublic: false,
  createdBy: 'owner-1',
  workspaceAllowsPersonalApiKeys: true,
}

const SERVER_RESOURCE = 'http://localhost:3000/api/mcp/serve/server-1'
const SERVER_RESOURCE_METADATA =
  'http://localhost:3000/.well-known/oauth-protected-resource/api/mcp/serve/server-1'

function toolCallRequest(headers: Record<string, string>) {
  return new NextRequest(SERVER_RESOURCE, {
    method: 'POST',
    headers: { Accept: 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'tool_a', arguments: { q: 'test' } },
    }),
  })
}

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/auth/internal', () => authInternalMock)

vi.mock('@/lib/auth/oauth-access-token', () => ({
  InvalidOAuthAccessTokenError: MockInvalidOAuthAccessTokenError,
  parseBearerToken: (headers: Headers) =>
    headers.get('authorization')?.replace(/^Bearer +/i, '') || null,
  verifyOAuthAccessToken: mockVerifyOAuthAccessToken,
}))

vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)

vi.mock('@/lib/workflows/executor/execute-service', () => ({
  executeWorkflowService: mockExecuteWorkflowService,
}))

import { PERSONAL_KEY_DENIED } from '@/lib/api-key/policy-messages'
import { DELETE, GET, POST } from '@/app/api/mcp/serve/[serverId]/route'

executionLimitsMockFns.mockGetMaxExecutionTimeout.mockReturnValue(60_000)

describe('MCP Serve Route', () => {
  afterAll(() => {
    resetEnvMock()
  })

  beforeEach(() => {
    resetDbChainMock()
    setEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })
    vi.stubGlobal('fetch', fetchMock)
    mockResolveBillingAttribution.mockImplementation(
      ({ actorUserId, workspaceId }: { actorUserId: string; workspaceId: string }) =>
        Promise.resolve(createBillingAttribution(actorUserId, workspaceId))
    )
    mockAssertBillingAttributionSnapshot.mockImplementation((value: unknown) => value)
    mockSerializeBillingAttributionHeader.mockReturnValue('serialized-attribution')
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: `decrypted:${encryptedValue}`,
    }))
  })

  it('returns 401 for private server when auth fails', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    expect(response.status).toBe(401)
  })

  describe('OAuth access tokens', () => {
    it('challenges an unauthenticated request with the server protected-resource metadata', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([PRIVATE_SERVER])
      hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
        success: false,
        error: 'Unauthorized',
      })

      const response = await POST(toolCallRequest({}), createRouteContext({ serverId: 'server-1' }))

      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toBe(
        `Bearer resource_metadata="${SERVER_RESOURCE_METADATA}", scope="api:read api:write"`
      )
    })

    it('executes as the token user when the token is bound to this server', async () => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([PRIVATE_SERVER])
        .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
        .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
      mockVerifyOAuthAccessToken.mockResolvedValueOnce(OAUTH_WRITE_PRINCIPAL)
      mockGetUserEntityPermissions.mockResolvedValueOnce('write')
      mockExecuteWorkflowService.mockResolvedValueOnce({
        ok: true,
        executionId: 'exec-1',
        workflowId: 'wf-1',
        status: 'completed',
        aborted: null,
        output: { ok: true },
        error: null,
        hasResponseBlock: false,
        resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('user-1'),
      })

      const response = await POST(
        toolCallRequest({ Authorization: 'Bearer sim_oat_valid' }),
        createRouteContext({ serverId: 'server-1' })
      )

      expect(response.status).toBe(200)
      expect(mockVerifyOAuthAccessToken).toHaveBeenCalledWith('sim_oat_valid', {
        resource: SERVER_RESOURCE,
      })
      expect(hybridAuthMockFns.mockCheckHybridAuth).not.toHaveBeenCalled()
      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith('user-1', 'workspace', 'ws-1')
      expect(mockExecuteWorkflowService).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          principal: OAUTH_WRITE_PRINCIPAL,
          useAuthenticatedUserAsActor: true,
        })
      )
    })

    it('answers a token bound elsewhere with invalid_token so the client re-authorizes', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([PRIVATE_SERVER])
      mockVerifyOAuthAccessToken.mockRejectedValueOnce(
        new MockInvalidOAuthAccessTokenError('wrong_resource')
      )

      const response = await POST(
        toolCallRequest({ Authorization: 'Bearer sim_oat_other' }),
        createRouteContext({ serverId: 'server-1' })
      )

      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toBe(
        `Bearer error="invalid_token", resource_metadata="${SERVER_RESOURCE_METADATA}", scope="api:read api:write"`
      )
      expect(mockExecuteWorkflowService).not.toHaveBeenCalled()
    })

    it('asks a read-only token to step up to api:write before calling a tool', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([PRIVATE_SERVER])
      mockVerifyOAuthAccessToken.mockResolvedValueOnce({
        ...OAUTH_WRITE_PRINCIPAL,
        scopes: ['api:read'],
      })
      mockGetUserEntityPermissions.mockResolvedValueOnce('write')

      const response = await POST(
        toolCallRequest({ Authorization: 'Bearer sim_oat_read' }),
        createRouteContext({ serverId: 'server-1' })
      )

      expect(response.status).toBe(403)
      expect(response.headers.get('www-authenticate')).toBe(
        `Bearer error="insufficient_scope", resource_metadata="${SERVER_RESOURCE_METADATA}", scope="api:write"`
      )
      expect(mockExecuteWorkflowService).not.toHaveBeenCalled()
    })

    it('refuses a token without api:read before serving tool metadata', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([PRIVATE_SERVER])
      mockVerifyOAuthAccessToken.mockResolvedValueOnce({
        ...OAUTH_WRITE_PRINCIPAL,
        scopes: ['offline_access'],
      })

      const response = await POST(
        new NextRequest(SERVER_RESOURCE, {
          method: 'POST',
          headers: { Authorization: 'Bearer sim_oat_offline' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        }),
        createRouteContext({ serverId: 'server-1' })
      )

      expect(response.status).toBe(403)
      expect(response.headers.get('www-authenticate')).toBe(
        `Bearer error="insufficient_scope", resource_metadata="${SERVER_RESOURCE_METADATA}", scope="api:read"`
      )
      expect(mockGetUserEntityPermissions).not.toHaveBeenCalled()
    })

    it('refuses a token user who is no longer a workspace member', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([PRIVATE_SERVER])
      mockVerifyOAuthAccessToken.mockResolvedValueOnce(OAUTH_WRITE_PRINCIPAL)
      mockGetUserEntityPermissions.mockResolvedValueOnce(null)

      const response = await POST(
        toolCallRequest({ Authorization: 'Bearer sim_oat_valid' }),
        createRouteContext({ serverId: 'server-1' })
      )

      expect(response.status).toBe(403)
      expect(mockExecuteWorkflowService).not.toHaveBeenCalled()
    })

    it('applies the workspace personal-key policy to OAuth tokens', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        { ...PRIVATE_SERVER, workspaceAllowsPersonalApiKeys: false },
      ])
      mockVerifyOAuthAccessToken.mockResolvedValueOnce(OAUTH_WRITE_PRINCIPAL)
      mockGetUserEntityPermissions.mockResolvedValueOnce('write')

      const response = await POST(
        toolCallRequest({ Authorization: 'Bearer sim_oat_valid' }),
        createRouteContext({ serverId: 'server-1' })
      )
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBe(PERSONAL_KEY_DENIED)
      expect(mockExecuteWorkflowService).not.toHaveBeenCalled()
    })

    it('prefers an API key over a bearer token when both are sent', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([PRIVATE_SERVER])
      hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
        success: false,
        error: 'Invalid API key',
      })

      const response = await POST(
        toolCallRequest({ Authorization: 'Bearer sim_oat_valid', 'X-API-Key': 'bad-key' }),
        createRouteContext({ serverId: 'server-1' })
      )

      expect(response.status).toBe(401)
      expect(mockVerifyOAuthAccessToken).not.toHaveBeenCalled()
    })
  })

  it('allows unauthenticated GET metadata for public servers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1')
    const response = await GET(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.name).toBe('Public Server')
    expect(hybridAuthMockFns.mockCheckHybridAuth).not.toHaveBeenCalled()
  })

  it('authenticates private SSE-style GET before returning unsupported transport', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      headers: { accept: 'text/event-stream' },
    })

    const response = await GET(req, createRouteContext({ serverId: 'server-1' }))

    expect(response.status).toBe(401)
  })

  it('requires authentication for DELETE even on public servers', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: false,
      error: 'Unauthorized',
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'DELETE',
    })
    const response = await DELETE(req, createRouteContext({ serverId: 'server-1' }))

    expect(response.status).toBe(401)
  })

  it('executes in-process with the personal-key actor override for private server api_key auth', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Private Server',
          workspaceId: 'ws-1',
          isPublic: false,
          createdBy: 'owner-1',
          workspaceAllowsPersonalApiKeys: true,
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
      principal: PERSONAL_API_KEY_PRINCIPAL,
    })
    mockGetUserEntityPermissions.mockResolvedValueOnce('write')
    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: { ok: true },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('user-1'),
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: {
        'X-API-Key': 'pk_test_123',
        Accept: 'application/json, text/event-stream;q=0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(mockExecuteWorkflowService).toHaveBeenCalledTimes(1)
    expect(mockExecuteWorkflowService).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        userId: 'user-1',
        triggerType: 'mcp',
        principal: PERSONAL_API_KEY_PRINCIPAL,
        useAuthenticatedUserAsActor: true,
        deploymentVersionId: 'deployment-1',
        includeFileBase64: false,
        rejectLargeInlineOutput: true,
      })
    )
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
    })
  })

  it('keeps a Streamable HTTP tool call active and ends with its JSON-RPC response', async () => {
    vi.useFakeTimers()
    try {
      dbChainMockFns.limit
        .mockResolvedValueOnce([
          {
            id: 'server-1',
            name: 'Public Server',
            workspaceId: 'ws-1',
            isPublic: true,
            createdBy: 'owner-1',
          },
        ])
        .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
        .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

      let finishExecution!: (result: unknown) => void
      mockExecuteWorkflowService.mockReturnValueOnce(
        new Promise((resolve) => {
          finishExecution = resolve
        })
      )

      const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
        method: 'POST',
        headers: { accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'tool_a', arguments: { q: 'test' } },
        }),
      })
      const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      if (!response.body) throw new Error('Expected MCP event stream')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n')
      await vi.advanceTimersByTimeAsync(15_000)
      expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n')

      finishExecution({
        ok: true,
        executionId: 'exec-1',
        workflowId: 'wf-1',
        status: 'completed',
        aborted: null,
        output: { ok: true },
        error: null,
        hasResponseBlock: false,
        resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('owner-1'),
      })

      const event = decoder.decode((await reader.read()).value)
      expect(JSON.parse(event.replace(/^data: /, '').trim())).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { content: [{ type: 'text' }], isError: false },
      })
      expect((await reader.read()).done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the workflow when an MCP event-stream consumer disconnects', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    let executionSignal: AbortSignal | undefined
    mockExecuteWorkflowService.mockImplementationOnce(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((resolve) => {
          executionSignal = abortSignal
          const finish = () =>
            resolve({
              ok: true,
              executionId: 'exec-1',
              workflowId: 'wf-1',
              status: 'cancelled',
              aborted: 'client',
              output: undefined,
              error: { message: 'Client cancelled request', code: 'CANCELLED' },
              hasResponseBlock: false,
            })
          if (abortSignal.aborted) finish()
          else abortSignal.addEventListener('abort', finish, { once: true })
        })
    )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    if (!response.body) throw new Error('Expected MCP event stream')
    const reader = response.body.getReader()
    await reader.read()
    await vi.waitFor(() => expect(executionSignal).toBeDefined())

    await reader.cancel('client disconnected')

    expect(executionSignal?.aborted).toBe(true)
  })

  it('rejects a personal api key when the workspace disallows personal api keys', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Private Server',
        workspaceId: 'ws-1',
        isPublic: false,
        createdBy: 'owner-1',
        workspaceAllowsPersonalApiKeys: false,
      },
    ])
    hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-1',
      authType: 'api_key',
      apiKeyType: 'personal',
      principal: PERSONAL_API_KEY_PRINCIPAL,
    })
    mockGetUserEntityPermissions.mockResolvedValueOnce('write')

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: { 'X-API-Key': 'pk_test_123' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe(PERSONAL_KEY_DENIED)
    expect(mockExecuteWorkflowService).not.toHaveBeenCalled()
  })

  it('replaces caller-supplied attribution for public workflow tools', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: { ok: true },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('owner-1'),
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: { 'x-sim-billing-attribution': 'caller-controlled-attribution' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a' },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    expect(response.status).toBe(200)
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      workspaceId: 'ws-1',
    })
    const attribution = createBillingAttribution('owner-1', 'ws-1')
    expect(mockAssertBillingAttributionSnapshot).toHaveBeenCalledWith(attribution)
    expect(mockExecuteWorkflowService).toHaveBeenCalledWith(
      expect.objectContaining({ upstreamBillingAttribution: attribution, userId: 'owner-1' })
    )
  })

  it.each([null, 'ws-other'])(
    'fails closed when a workflow tool has invalid workspace scope: %s',
    async (workflowWorkspaceId) => {
      dbChainMockFns.limit
        .mockResolvedValueOnce([
          {
            id: 'server-1',
            name: 'Public Server',
            workspaceId: 'ws-1',
            isPublic: true,
            createdBy: 'owner-1',
          },
        ])
        .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
        .mockResolvedValueOnce([
          { workspaceId: workflowWorkspaceId, deploymentVersionId: 'deployment-1' },
        ])

      const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'tool_a' },
        }),
      })
      const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

      expect(response.status).toBe(403)
      expect(mockResolveBillingAttribution).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('fails closed when resolved attribution does not match the bridge scope', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
    mockResolveBillingAttribution.mockResolvedValueOnce(
      createBillingAttribution('different-actor', 'ws-1')
    )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a' },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    expect(response.status).toBe(500)
    expect(mockSerializeBillingAttributionHeader).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized MCP request bodies before parsing JSON', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      headers: { 'content-length': String(MCP_BYTE_LIMIT + 1) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })

    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP request body exceeds maximum size')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects streamed MCP request bodies that exceed the cap without content-length', async () => {
    const cancelSpy = vi.fn()
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MCP_BYTE_LIMIT))
        controller.enqueue(new Uint8Array(1))
      },
      cancel: cancelSpy,
    })
    const request = new Request('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const req = new NextRequest(request)

    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP request body')
    expect(cancelSpy).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized tools/call arguments before internal fetch', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'server-1',
        name: 'Public Server',
        workspaceId: 'ws-1',
        isPublic: true,
        createdBy: 'owner-1',
      },
    ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { payload: 'x'.repeat(MCP_BYTE_LIMIT) } },
      }),
    })

    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('MCP request body')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps oversized workflow outputs to the response-direction 413', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: false,
      failure: {
        kind: 'output_too_large',
        statusCode: 413,
        message: 'Workflow execution response exceeds maximum size',
        code: 'workflow_response_too_large',
        executionId: 'exec-1',
      },
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.data.httpStatus).toBe(413)
    // Response-direction 413 keeps the workflow_response_too_large code so
    // clients can distinguish it from a request-side payload rejection.
    expect(body.error.data.code).toBe('workflow_response_too_large')
    expect(body.error.data.executionId).toBe('exec-1')
  })

  it('surfaces rate-limit failures with Retry-After and the retryable flag', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: false,
      failure: {
        kind: 'precheck',
        statusCode: 429,
        message: 'Rate limit exceeded. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterMs: 9_000,
      },
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    const body = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('9')
    expect(body.error.data.retryable).toBe(true)
    expect(body.error.data.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('maps the sync timeout onto the retryable 408 shape', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'failed',
      aborted: 'timeout',
      output: undefined,
      error: { message: 'Execution timed out after 60000ms', code: 'TIMEOUT' },
      hasResponseBlock: false,
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    const body = await response.json()

    expect(response.status).toBe(408)
    expect(body.error.data.httpStatus).toBe(408)
    expect(body.error.data.retryable).toBe(true)
    expect(body.error.data.code).toBe('TIMEOUT')
  })

  it('preserves falsy workflow outputs in MCP tool results', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: false,
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('owner-1'),
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.content[0].text).toBe('false')
    expect(body.result.isError).toBe(false)
  })

  it('reports a human-in-the-loop pause as a successful tool result', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-paused',
      workflowId: 'wf-1',
      status: 'paused',
      aborted: null,
      output: { approvalRequired: true },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('owner-1'),
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.isError).toBe(false)
    expect(body.result.content[0].text).toContain('approvalRequired')
  })

  it('serializes failed runs with the structured error and child executionId', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-9',
      workflowId: 'wf-1',
      status: 'failed',
      aborted: null,
      output: { partial: true },
      error: {
        message: 'Invalid credentials',
        code: 'BLOCK_EXECUTION_FAILED',
        blockId: 'b-1',
        blockName: 'Send Email',
        blockType: 'gmail',
      },
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('owner-1'),
    })
    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.isError).toBe(true)
    const text = body.result.content[0].text
    expect(text).toContain('"executionId": "exec-9"')
    expect(text).toContain('"code": "BLOCK_EXECUTION_FAILED"')
    expect(text).toContain('"blockName": "Send Email"')
  })

  it('serves a public tool whose workflow was authored by someone other than the actor', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: { ok: true },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('author-2'),
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(JSON.parse(body.result.content[0].text)).toEqual({ ok: true })
  })

  it('anonymizes an author-scoped secret label when the actor is not the author', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: { leaked: 'decrypted:author-ciphertext' },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: {
        ...createResolvedSecretTraceProvenance('author-2'),
        entries: [{ name: 'AUTHOR_TOKEN', encryptedValue: 'author-ciphertext' }],
      },
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(JSON.parse(body.result.content[0].text)).toEqual({ leaked: '[REDACTED_SECRET]' })
    expect(body.result.content[0].text).not.toContain('AUTHOR_TOKEN')
  })

  it('keeps the author-scoped secret label when the actor is the author', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: { leaked: 'decrypted:owner-ciphertext' },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: {
        ...createResolvedSecretTraceProvenance('owner-1'),
        entries: [{ name: 'OWNER_TOKEN', encryptedValue: 'owner-ciphertext' }],
      },
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(JSON.parse(body.result.content[0].text)).toEqual({ leaked: '{{OWNER_TOKEN}}' })
  })

  it('refuses a tool result whose provenance was stamped for another workspace', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])
    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'completed',
      aborted: null,
      output: { ok: true },
      error: null,
      hasResponseBlock: false,
      resolvedSecretTraceProvenance: createResolvedSecretTraceProvenance('owner-1', 'ws-other'),
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.code).toBe(-32603)
  })

  it('rejects duplicate tool names instead of choosing an arbitrary workflow', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([
        { toolName: 'tool_a', workflowId: 'wf-1' },
        { toolName: 'tool_a', workflowId: 'wf-2' },
      ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })

    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.data.code).toBe('duplicate_tool_name')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a client-aborted run onto ConnectionClosed', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([{ toolName: 'tool_a', workflowId: 'wf-1' }])
      .mockResolvedValueOnce([{ workspaceId: 'ws-1', deploymentVersionId: 'deployment-1' }])

    mockExecuteWorkflowService.mockResolvedValueOnce({
      ok: true,
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'cancelled',
      aborted: 'client',
      output: undefined,
      error: { message: 'Client cancelled request', code: 'CANCELLED' },
      hasResponseBlock: false,
    })

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'tool_a', arguments: { q: 'test' } },
      }),
    })
    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))

    const body = await response.json()

    expect(response.status).toBe(499)
    expect(body.error.data.httpStatus).toBe(499)
    expect(body.error.data.executionId).toBe('exec-1')
  })

  it('paginates tools/list by tool count', async () => {
    const pageRows = Array.from({ length: MCP_TOOLS_LIST_LIMIT + 1 }, (_, index) => ({
      id: `tool-id-${String(index).padStart(3, '0')}`,
      toolNameBytes: 10 + index,
      toolDescriptionBytes: 0,
      parameterSchemaBytes: 32,
    }))
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(pageRows)
      .mockResolvedValueOnce(
        pageRows.map((row, index) => ({
          id: row.id,
          toolName: `tool_${index}`,
          toolDescription: null,
          parameterSchema: { type: 'object', properties: {} },
        }))
      )

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.tools).toHaveLength(MCP_TOOLS_LIST_LIMIT)
    expect(body.result.nextCursor).toBe('tool-id-099')
  })

  it('bounds tools/list by final serialized response size', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'tool-id-1',
          toolNameBytes: 6,
          toolDescriptionBytes: 1,
          parameterSchemaBytes: 32,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'tool-id-1',
          toolName: 'tool_a',
          toolDescription: 'x'.repeat(MCP_BYTE_LIMIT),
          parameterSchema: { type: 'object', properties: {} },
        },
      ])

    const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })

    const response = await POST(req, createRouteContext({ serverId: 'server-1' }))
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error.message).toContain('tools/list response is too large')
  })

  describe('initialize protocol version negotiation', () => {
    async function callInitialize(protocolVersion?: string) {
      dbChainMockFns.limit.mockResolvedValueOnce([
        {
          id: 'server-1',
          name: 'Public Server',
          workspaceId: 'ws-1',
          isPublic: true,
          createdBy: 'owner-1',
        },
      ])
      const params: Record<string, unknown> = {
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      }
      if (protocolVersion !== undefined) params.protocolVersion = protocolVersion
      const req = new NextRequest('http://localhost:3000/api/mcp/serve/server-1', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params }),
      })
      const res = await POST(req, createRouteContext({ serverId: 'server-1' }))
      return res.json() as Promise<{ result: { protocolVersion: string } }>
    }

    it('echoes a supported client protocolVersion (2025-06-18)', async () => {
      const body = await callInitialize('2025-06-18')
      expect(body.result.protocolVersion).toBe('2025-06-18')
    })

    it('falls back to SDK latest when client requests unknown version', async () => {
      const { LATEST_PROTOCOL_VERSION } = await import('@modelcontextprotocol/sdk/types.js')
      const body = await callInitialize('2099-01-01')
      expect(body.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    })
  })
})
