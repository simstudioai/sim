import type { Principal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPrincipal: vi.fn(),
  execute: vi.fn(),
  executeChat: vi.fn(),
}))

vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.createPrincipal,
}))

vi.mock('@/lib/function-execution/application/execute-function', () => ({
  executeFunction: { execute: mocks.execute },
}))

vi.mock('@/lib/function-execution/application/execute-chat-function', () => ({
  executeChatFunction: { execute: mocks.executeChat },
}))

import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { executeFunctionTool } from '@/lib/internal/function/execute'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('executeFunctionTool', () => {
  beforeEach(() => {
    mocks.executeChat.mockResolvedValue(Response.json({ success: true }))
    mocks.execute.mockResolvedValue(Response.json({ success: true }))
  })

  it('binds executor calls from the canonical origin instead of the compatibility user ID', async () => {
    const startedAt = Date.now()
    const origin = {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'system' as const,
        serviceId: 'schedule' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment' as const,
        deploymentVersionId: 'deployment-1',
      },
    }
    const principal = {
      kind: 'delegated' as const,
      serviceId: 'executor' as const,
      workspaceId: 'workspace-1',
      delegationId: 'delegation-1',
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      delegationContext: { kind: 'workflow_execution' as const, ...origin },
    }
    mocks.createPrincipal.mockResolvedValue(principal)
    const context = {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'workspace-owner',
      executorDelegationOrigin: origin,
      callerPrincipal: {
        kind: 'personal_api_key' as const,
        userId: 'other-actor',
        keyId: 'other-key',
      },
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
        userId: 'workspace-owner',
        workspaceId: 'workspace-1',
      }),
    }
    const headers = new Headers()

    await executeFunctionTool({
      body: {
        code: 'return 1',
        timeout: 60_000,
        userId: 'forged-user',
        workspaceId: 'forged-workspace',
      },
      headers,
      context,
      requestId: 'request-1',
    })

    expect(mocks.createPrincipal).toHaveBeenCalledWith({
      context,
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
      expiresAt: expect.any(Date),
      resourceScope: { executionId: 'execution-1' },
    })
    const delegatedExpiry = mocks.createPrincipal.mock.calls[0]?.[0].expiresAt as Date
    expect(delegatedExpiry.getTime()).toBeGreaterThanOrEqual(startedAt + 60_000)
    expect(delegatedExpiry.getTime()).toBeLessThanOrEqual(Date.now() + 60_000)
    expect(mocks.execute).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({
        workspaceId: 'workspace-1',
        body: expect.objectContaining({
          workspaceId: 'workspace-1',
          userId: undefined,
        }),
        headers,
        resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
      }),
    })
  })
  it.each<Principal>([
    { kind: 'session', userId: 'actor', sessionId: 'session' },
    { kind: 'personal_api_key', userId: 'actor', keyId: 'key' },
    {
      kind: 'oauth_access_token',
      userId: 'actor',
      tokenId: 'token',
      clientId: 'client',
      scopes: ['api:write'],
      expiresAt: new Date('2099-01-01'),
    },
  ])(
    'preserves the trusted direct $kind principal without an executor origin',
    async (callerPrincipal) => {
      await executeFunctionTool({
        body: {
          code: 'return {{TOKEN}}',
          secretScope: 'selected',
          mountedSecrets: ['TOKEN'],
          userId: 'forged',
          workspaceId: 'forged',
          workflowId: 'forged',
        },
        headers: new Headers(),
        context: { workflowId: '', workspaceId: 'workspace-1', userId: 'actor', callerPrincipal },
        requestId: 'direct',
      })
      expect(mocks.createPrincipal).not.toHaveBeenCalled()
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: callerPrincipal,
          input: expect.objectContaining({
            workspaceId: 'workspace-1',
            meterSandboxUsage: true,
            body: expect.objectContaining({
              userId: undefined,
              workspaceId: 'workspace-1',
              workflowId: '',
              secretScope: 'selected',
              mountedSecrets: ['TOKEN'],
            }),
          }),
        })
      )
    }
  )

  it('keeps Copilot delegation expiry and scope when adapting an authorized direct caller', async () => {
    const callerPrincipal = {
      kind: 'delegated' as const,
      serviceId: 'copilot' as const,
      subjectUserId: 'actor',
      workspaceId: 'workspace-1',
      audience: 'sim:tool-execution',
      delegationId: 'caller',
      issuedAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-01-01T00:01:00Z'),
      resourceScope: { chatId: 'chat' },
    }
    await executeFunctionTool({
      body: { code: 'return 1' },
      headers: new Headers(),
      context: { workflowId: '', workspaceId: 'workspace-1', callerPrincipal },
      requestId: 'direct',
    })
    expect(mocks.execute.mock.calls[0][0].principal).toEqual({
      ...callerPrincipal,
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
    })
    expect(mocks.createPrincipal).not.toHaveBeenCalled()
  })

  it.each(['agent', 'plan'] as const)(
    'binds workspace-free scratch to the trusted organization %s chat and strips forged owners',
    async (requestMode) => {
      await executeFunctionTool({
        body: { code: 'return 1', workspaceId: 'forged', userId: 'forged', timeout: 1000 },
        headers: new Headers(),
        requestId: 'request',
        sandboxProfile: 'mothership',
        context: {
          userId: 'actor',
          organizationId: 'org',
          chatId: 'chat',
          requestMode,
          copilotToolExecution: true,
        },
      })
      expect(mocks.executeChat).toHaveBeenCalledWith(
        expect.objectContaining({
          principal: expect.objectContaining({
            kind: 'organization_delegated',
            subjectUserId: 'actor',
            organizationId: 'org',
            resourceScope: { chatId: 'chat' },
          }),
          input: expect.objectContaining({
            organizationId: 'org',
            chatId: 'chat',
            body: expect.objectContaining({ workspaceId: undefined, userId: undefined }),
          }),
        })
      )
      expect(mocks.execute).not.toHaveBeenCalled()
      expect(mocks.createPrincipal).not.toHaveBeenCalled()
    }
  )
  it.each([
    { requestMode: 'assistant' },
    { copilotToolExecution: false },
    { chatId: undefined },
    { organizationId: undefined },
    { userId: undefined },
    { workflowId: 'workflow' },
  ])('refuses untrusted or non-Build/Plan organization scope %j', async (override) => {
    await expect(
      executeFunctionTool({
        body: { code: 'return 1' },
        headers: new Headers(),
        requestId: 'request',
        sandboxProfile: 'mothership',
        context: {
          userId: 'actor',
          organizationId: 'org',
          chatId: 'chat',
          requestMode: 'agent',
          copilotToolExecution: true,
          ...override,
        },
      })
    ).rejects.toThrow('trusted Build or Plan chat scope')
    expect(mocks.executeChat).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
