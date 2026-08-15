/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertActiveWorkspaceAccess,
  mockBuildIntegrationToolSchemas,
  mockBuildSelectedMcpToolSchemas,
  mockBuildTaggedMcpToolSchemas,
  mockCheckInternalAuth,
  mockComputeWorkspaceEntitlements,
  mockDecryptSecret,
  mockGenerateWorkspaceContext,
  mockGetPersonalAndWorkspaceEnv,
  mockProcessContextsServer,
  mockRequestExplicitStreamAbort,
  mockRequireBillingAttributionHeader,
  mockRunHeadlessCopilotLifecycle,
} = vi.hoisted(() => ({
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockBuildIntegrationToolSchemas: vi.fn(),
  mockBuildSelectedMcpToolSchemas: vi.fn(),
  mockBuildTaggedMcpToolSchemas: vi.fn(),
  mockCheckInternalAuth: vi.fn(),
  mockComputeWorkspaceEntitlements: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockGenerateWorkspaceContext: vi.fn(),
  mockGetPersonalAndWorkspaceEnv: vi.fn(),
  mockProcessContextsServer: vi.fn(),
  mockRequestExplicitStreamAbort: vi.fn(),
  mockRequireBillingAttributionHeader: vi.fn(),
  mockRunHeadlessCopilotLifecycle: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkInternalAuth: mockCheckInternalAuth,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  requireBillingAttributionHeader: mockRequireBillingAttributionHeader,
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildIntegrationToolSchemas: mockBuildIntegrationToolSchemas,
}))

vi.mock('@/lib/copilot/chat/process-contents', () => ({
  processContextsServer: mockProcessContextsServer,
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: mockGenerateWorkspaceContext,
}))

vi.mock('@/lib/copilot/entitlements', () => ({
  computeWorkspaceEntitlements: mockComputeWorkspaceEntitlements,
}))

vi.mock('@/lib/copilot/mcp-tools', () => ({
  buildSelectedMcpToolSchemas: mockBuildSelectedMcpToolSchemas,
  buildTaggedMcpToolSchemas: mockBuildTaggedMcpToolSchemas,
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/copilot/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mockRequestExplicitStreamAbort,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isDocSandboxEnabled: false,
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: mockGetPersonalAndWorkspaceEnv,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError: vi.fn(() => false),
}))

import type { CopilotLifecycleOptions } from '@/lib/copilot/request/lifecycle/run'
import { buildExecuteResponsePayload, POST } from '@/app/api/mothership/execute/route'

type Payload = Parameters<typeof buildExecuteResponsePayload>[0]

function resultWithToolCalls(names: string[]): Payload {
  return { content: '', toolCalls: names.map((name) => ({ name })) } as unknown as Payload
}

describe('buildExecuteResponsePayload', () => {
  it('still admits integration and mcp tool calls, and still drops other server tools', () => {
    const payload = buildExecuteResponsePayload(
      resultWithToolCalls(['gmail_send', 'mcp-notion-create', 'read', 'edit_workflow']),
      'chat-1',
      [{ name: 'gmail_send' }]
    )

    const names = payload.toolCalls.map((tc: { name: string }) => tc.name)
    expect(names).toEqual(['gmail_send', 'mcp-notion-create'])
  })
})

describe('mothership private trace provenance transport', () => {
  const requestBody = {
    messages: [{ role: 'user', content: 'hello' }],
    workspaceId: 'workspace-1',
    userId: 'user-1',
    chatId: 'chat-1',
    messageId: 'message-1',
    requestId: 'request-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockAssertActiveWorkspaceAccess.mockResolvedValue({ permission: 'write' })
    mockRequireBillingAttributionHeader.mockReturnValue({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: { API_KEY: 'encrypted-secret' },
      workspaceEncrypted: {},
      personalDecrypted: { API_KEY: 'secret-value' },
      workspaceDecrypted: {},
      decryptionFailures: [],
    })
    mockGenerateWorkspaceContext.mockResolvedValue({})
    mockBuildIntegrationToolSchemas.mockResolvedValue([])
    mockBuildSelectedMcpToolSchemas.mockResolvedValue([])
    mockBuildTaggedMcpToolSchemas.mockResolvedValue([])
    mockComputeWorkspaceEntitlements.mockResolvedValue([])
    mockDecryptSecret.mockResolvedValue({ decrypted: 'secret-value' })
    mockProcessContextsServer.mockResolvedValue([])
    mockRequestExplicitStreamAbort.mockResolvedValue(undefined)
  })

  function successResult() {
    return {
      success: true,
      content: 'secret-value',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
    }
  }

  function activateSecret(options: CopilotLifecycleOptions): void {
    const registry =
      options.environmentContext?.resolvedSecretTraceRegistry ?? options.resolvedSecretTraceRegistry
    registry?.recordResolved('API_KEY', 'secret-value')
  }

  it('builds the model-egress catalog without exposing provenance unless requested', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        activateSecret(options)
        return successResult()
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        { Authorization: 'Bearer internal', 'x-sim-billing-attribution': 'billing' },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBeNull()
    expect(body.content).toBe('secret-value')
    expect(body).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledTimes(1)
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ environmentContext: expect.any(Object) })
    )
  })

  it('omits an absent response format from the headless lifecycle payload', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(async (payload: Record<string, unknown>) => {
      expect(payload).not.toHaveProperty('responseFormat')
      return successResult()
    })

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        { Authorization: 'Bearer internal', 'x-sim-billing-attribution': 'billing' },
        'http://localhost:3000/api/mothership/execute'
      )
    )

    expect(response.status).toBe(200)
  })

  it('keeps preprocessing inputs raw and delegates model projection to the lifecycle boundary', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(async (payload: Record<string, unknown>) => {
      expect(JSON.stringify(payload)).toContain('secret-value __var_FOREIGN')
      return successResult()
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          ...requestBody,
          messages: [{ role: 'user', content: 'secret-value __var_FOREIGN' }],
          contexts: [{ kind: 'docs', label: 'Docs' }],
        },
        { Authorization: 'Bearer internal', 'x-sim-billing-attribution': 'billing' },
        'http://localhost:3000/api/mothership/execute'
      )
    )

    expect(response.status).toBe(200)
    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      expect.any(Array),
      'user-1',
      'secret-value __var_FOREIGN',
      'workspace-1',
      'chat-1',
      expect.any(Object)
    )

    const contextRegistry = mockProcessContextsServer.mock.calls.at(-1)?.[5]
    const lifecycleOptions = mockRunHeadlessCopilotLifecycle.mock.calls.at(-1)?.[1]
    expect(contextRegistry).toBe(lifecycleOptions.environmentContext?.resolvedSecretTraceRegistry)
  })

  it('keeps context routing and display inputs raw until the lifecycle boundary', async () => {
    mockGetPersonalAndWorkspaceEnv.mockResolvedValueOnce({
      personalEncrypted: { API_KEY: 'encrypted-secret' },
      workspaceEncrypted: {},
      personalDecrypted: { API_KEY: '123' },
      workspaceDecrypted: {},
      decryptionFailures: [],
    })
    mockDecryptSecret.mockResolvedValue({ decrypted: '123' })
    mockRunHeadlessCopilotLifecycle.mockResolvedValue(successResult())

    const response = await POST(
      createMockRequest(
        'POST',
        {
          ...requestBody,
          contexts: [
            { kind: 'mcp', label: 'MCP 123', serverId: '123', path: '123' },
            {
              kind: 'file_selection',
              label: 'File 123',
              fileId: '123',
              fileName: '123.txt',
              text: 'Selected 123',
              path: '123',
            },
          ],
        },
        { Authorization: 'Bearer internal', 'x-sim-billing-attribution': 'billing' },
        'http://localhost:3000/api/mothership/execute'
      )
    )

    expect(response.status).toBe(200)
    expect(mockBuildTaggedMcpToolSchemas).toHaveBeenCalledWith('user-1', 'workspace-1', ['123'])
    expect(mockProcessContextsServer).toHaveBeenCalledWith(
      [
        {
          kind: 'file_selection',
          label: 'File 123',
          fileId: '123',
          fileName: '123.txt',
          text: 'Selected 123',
          path: '123',
        },
      ],
      'user-1',
      'hello',
      'workspace-1',
      'chat-1',
      expect.any(Object)
    )
  })

  it('keeps headless secret policy server-only', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        expect(payload).not.toHaveProperty('secretScope')
        expect(payload).not.toHaveProperty('mountedSecrets')
        expect(options).toMatchObject({
          secretActorUserId: 'user-1',
          secretMountPolicy: {
            secretScope: 'selected',
            mountedSecrets: ['API_KEY'],
          },
        })
        return successResult()
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        {
          ...requestBody,
          secretScope: 'selected',
          mountedSecrets: ['API_KEY'],
        },
        { Authorization: 'Bearer internal', 'x-sim-billing-attribution': 'billing' },
        'http://localhost:3000/api/mothership/execute'
      )
    )

    expect(response.status).toBe(200)
    expect(mockGenerateWorkspaceContext).toHaveBeenCalledWith('workspace-1', 'user-1', {
      workspaceAccess: expect.any(Object),
      secretMountPolicy: {
        secretScope: 'selected',
        mountedSecrets: ['API_KEY'],
      },
    })
  })

  it('fails model egress closed when catalog setup fails', async () => {
    mockGetPersonalAndWorkspaceEnv.mockRejectedValueOnce(new Error('catalog unavailable'))
    mockRunHeadlessCopilotLifecycle.mockResolvedValueOnce({
      success: false,
      error: 'Copilot model input could not be safely projected',
      content: '',
      contentBlocks: [],
      toolCalls: [],
      chatId: 'chat-1',
    })

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        {
          Authorization: 'Bearer internal',
          'x-sim-billing-attribution': 'billing',
          'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
        },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Copilot model input could not be safely projected')
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        environmentContext: undefined,
        resolvedSecretTraceRegistry: expect.any(Object),
      })
    )
  })

  it('fails provenance closed without changing a runtime value that rotated after catalog load', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        const registry =
          options.environmentContext?.resolvedSecretTraceRegistry ??
          options.resolvedSecretTraceRegistry
        expect(registry?.recordResolved('API_KEY', 'rotated-secret-value')).toBe(false)
        return { ...successResult(), content: 'rotated-secret-value' }
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        {
          Authorization: 'Bearer internal',
          'x-sim-billing-attribution': 'billing',
          'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
        },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.content).toBe('rotated-secret-value')
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('returns exact-empty output provenance on a marker-gated successful request', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        expect(options.environmentContext).not.toHaveProperty('decryptedEnvVars')
        expect(options.environmentContext?.resolvedSecretTraceRegistry).toBeDefined()
        expect(options.resolvedSecretTraceRegistry).toBeUndefined()
        activateSecret(options)
        return successResult()
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        {
          Authorization: 'Bearer internal',
          'x-sim-billing-attribution': 'billing',
          'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
        },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const body = await response.json()

    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(body.content).toBe('secret-value')
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: true,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(JSON.stringify(body.__resolvedSecretTraceProvenance)).not.toContain('secret-value')
    expect(mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledTimes(1)
  })

  it('keeps discovered MCP schemas raw without activating matching configured secrets', async () => {
    mockBuildTaggedMcpToolSchemas.mockResolvedValueOnce([
      { name: 'mcp-docs', description: 'Uses secret-value' },
    ])
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        const registry =
          options.environmentContext?.resolvedSecretTraceRegistry ??
          options.resolvedSecretTraceRegistry
        expect(registry?.exportProvenance()).toEqual({
          version: 1,
          complete: true,
          entries: [],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        })
        expect(payload.mothershipTools).toEqual([
          { name: 'mcp-docs', description: 'Uses secret-value' },
        ])
        return successResult()
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        {
          ...requestBody,
          contexts: [{ kind: 'mcp', label: 'Docs', serverId: 'server-1' }],
        },
        {
          Authorization: 'Bearer internal',
          'x-sim-billing-attribution': 'billing',
          'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
        },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const body = await response.json()

    expect(body.error, JSON.stringify(body)).toBeUndefined()
    expect({ status: response.status, provenance: body.__resolvedSecretTraceProvenance }).toEqual({
      status: 200,
      provenance: {
        version: 1,
        complete: true,
        entries: [],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    })
  })

  it('returns exact-empty provenance for an already projected marker-gated failure', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        activateSecret(options)
        return {
          ...successResult(),
          success: false,
          error: 'failed with secret-value',
          content: 'secret-value',
        }
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        {
          Authorization: 'Bearer internal',
          'x-sim-billing-attribution': 'billing',
          'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
        },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(body.content).toBe('secret-value')
    expect(body.__resolvedSecretTraceProvenance.entries).toEqual([])
  })

  it('places exact-empty provenance only on the terminal streamed event', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        activateSecret(options)
        return successResult()
      }
    )

    const response = await POST(
      createMockRequest(
        'POST',
        requestBody,
        {
          Authorization: 'Bearer internal',
          'x-sim-billing-attribution': 'billing',
          'x-sim-request-private-tool-metadata': 'resolved-secret-provenance-v1',
          'x-mothership-execute-stream': 'ndjson',
        },
        'http://localhost:3000/api/mothership/execute'
      )
    )
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(response.headers.get('x-sim-private-tool-metadata')).toBe(
      'resolved-secret-provenance-v1'
    )
    expect(events[0]).toMatchObject({ type: 'heartbeat' })
    expect(events[0]).not.toHaveProperty('__resolvedSecretTraceProvenance')
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      data: {
        content: 'secret-value',
        __resolvedSecretTraceProvenance: {
          entries: [],
        },
      },
    })
  })
})
