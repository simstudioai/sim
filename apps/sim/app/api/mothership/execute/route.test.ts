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
import {
  buildExecuteResponsePayload,
  CALLER_VISIBLE_SERVER_TOOLS,
  POST,
} from '@/app/api/mothership/execute/route'

type Payload = Parameters<typeof buildExecuteResponsePayload>[0]

function resultWithToolCalls(names: string[]): Payload {
  return { content: '', toolCalls: names.map((name) => ({ name })) } as unknown as Payload
}

describe('buildExecuteResponsePayload', () => {
  // The scheduled-task runner branches on whether the agent called
  // complete_scheduled_task (background/schedule-execution.ts reads
  // responseBody.toolCalls). This filter used to admit only integration tools
  // and mcp-*, so that check was permanently false: a job completed itself, the
  // signal was dropped here, and the runner's post-run bookkeeping wrote
  // status='active' with a fresh nextRunAt straight back over the completion —
  // the job then reran forever, each time telling the model it was done.
  it('keeps complete_scheduled_task so the schedule runner can see it', () => {
    const payload = buildExecuteResponsePayload(
      resultWithToolCalls(['complete_scheduled_task']),
      'chat-1',
      []
    )

    expect(payload.toolCalls.map((tc: { name: string }) => tc.name)).toContain(
      'complete_scheduled_task'
    )
  })

  it('still admits integration and mcp tool calls, and still drops other server tools', () => {
    const payload = buildExecuteResponsePayload(
      resultWithToolCalls(['gmail_send', 'mcp-notion-create', 'read', 'edit_workflow']),
      'chat-1',
      [{ name: 'gmail_send' }]
    )

    const names = payload.toolCalls.map((tc: { name: string }) => tc.name)
    expect(names).toEqual(['gmail_send', 'mcp-notion-create'])
  })

  // Guards the cross-file contract: the literal the runner greps for must be in
  // the allowlist above. These live in different files and nothing else ties
  // them together.
  it('exposes the exact tool name the schedule runner looks for', () => {
    expect(CALLER_VISIBLE_SERVER_TOOLS.has('complete_scheduled_task')).toBe(true)
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
    options.resolvedSecretTraceRegistry?.recordResolved('API_KEY', 'secret-value')
  }

  it('does not expose private provenance unless the internal caller requests it', async () => {
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
    expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ resolvedSecretTraceRegistry: undefined })
    )
  })

  it('keeps execution functional and fails trace provenance closed when catalog setup fails', async () => {
    mockGetPersonalAndWorkspaceEnv.mockRejectedValueOnce(new Error('catalog unavailable'))
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        expect(options.resolvedSecretTraceRegistry?.isComplete()).toBe(false)
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

    expect(response.status).toBe(200)
    expect(body.content).toBe('secret-value')
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('fails provenance closed without changing a runtime value that rotated after catalog load', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        expect(
          options.resolvedSecretTraceRegistry?.recordResolved('API_KEY', 'rotated-secret-value')
        ).toBe(false)
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

  it('returns encrypted provenance on a marker-gated successful request', async () => {
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
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
    expect(JSON.stringify(body.__resolvedSecretTraceProvenance)).not.toContain('secret-value')
  })

  it('imports MCP schema-discovery provenance before starting the lifecycle', async () => {
    const provenance = {
      version: 1,
      complete: true,
      entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    }
    mockBuildTaggedMcpToolSchemas.mockImplementationOnce(
      async (
        _userId: string,
        _workspaceId: string,
        _serverIds: string[],
        report: (value: unknown) => void
      ) => {
        report(provenance)
        return []
      }
    )
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        expect(options.resolvedSecretTraceRegistry?.exportProvenance()).toEqual(provenance)
        expect(JSON.stringify(payload)).not.toContain('encrypted-secret')
        expect(JSON.stringify(payload)).not.toContain('__resolvedSecretTraceProvenance')
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

    expect({ status: response.status, provenance: body.__resolvedSecretTraceProvenance }).toEqual({
      status: 200,
      provenance,
    })
  })

  it('marks the lifecycle registry incomplete for malformed MCP discovery provenance', async () => {
    mockBuildTaggedMcpToolSchemas.mockImplementationOnce(
      async (
        _userId: string,
        _workspaceId: string,
        _serverIds: string[],
        report: (value: unknown) => void
      ) => {
        report({ version: 1, complete: true, entries: 'invalid' })
        return []
      }
    )
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: Record<string, unknown>, options: CopilotLifecycleOptions) => {
        expect(options.resolvedSecretTraceRegistry?.isComplete()).toBe(false)
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

    expect(response.status).toBe(200)
    expect(body.__resolvedSecretTraceProvenance).toEqual({
      version: 1,
      complete: false,
      entries: [],
      scope: { userId: 'user-1', workspaceId: 'workspace-1' },
    })
  })

  it('returns encrypted provenance with marker-gated failures', async () => {
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
    expect(body.__resolvedSecretTraceProvenance.entries).toEqual([
      { name: 'API_KEY', encryptedValue: 'encrypted-secret' },
    ])
  })

  it('places encrypted provenance only on the terminal streamed event', async () => {
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
          entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
        },
      },
    })
  })
})
