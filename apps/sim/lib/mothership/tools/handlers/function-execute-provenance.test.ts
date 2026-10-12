import { setEnv } from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ mount: vi.fn() }))
vi.mock('@/lib/mothership/tools/organization-secret-mount', () => ({
  materializeOrganizationCodeSecrets: hoisted.mount,
}))
vi.mock('@/tools', () => toolsMock)
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)

import { encryptSecret } from '@/lib/core/security/encryption'
import { sandboxSessionInputProvenance } from '@/lib/execution/remote-sandbox/execution-observer'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mocks = { ...hoisted, execute: toolsMockFns.mockExecuteTool }
billingSubscriptionMockFns.mockHasWorkspaceSandboxAccess.mockResolvedValue(true)

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.execute.mockImplementation(async () => ({
    success: true,
    output: { sessionInputProvenance: sandboxSessionInputProvenance() },
  }))
})

describe('Function physical-session input certification', () => {
  it.each(['empty', 'missing', 'incomplete'] as const)(
    'certifies only complete actual empty registries: %s',
    async (state) => {
      const registry = new ResolvedSecretTraceRegistry([], {
        userId: 'user',
        workspaceId: 'workspace',
      })
      if (state === 'incomplete') registry.markIncomplete('fixture-unknown-prior-input')
      await executeFunctionExecute(
        { code: 'print(1)', language: 'python' },
        {
          userId: 'user',
          workflowId: '',
          workspaceId: 'workspace',
          chatId: 'chat',
          ...(state === 'missing' ? {} : { resolvedSecretTraceRegistry: registry }),
        }
      )
      expect(mocks.execute).toHaveBeenCalledOnce()
      const response = await mocks.execute.mock.results[0].value
      expect(response.output.sessionInputProvenance).toEqual(
        state === 'empty' ? { status: 'exact', entries: [] } : { status: 'unknown' }
      )
      expect(sandboxSessionInputProvenance()).toEqual({ status: 'unknown' })
    }
  )
})

describe('Function sandbox mounts', () => {
  it('never forwards a model-supplied sandbox mount, which would bypass input provenance', async () => {
    mocks.execute.mockImplementation(async (_tool, params) => ({
      success: true,
      output: { sandboxFiles: params._sandboxFiles ?? [] },
    }))
    const result = await executeFunctionExecute(
      {
        code: 'print(open("/tmp/sim/inputs/x").read())',
        language: 'python',
        _sandboxFiles: [{ type: 'url', path: '/tmp/sim/inputs/x', url: 'https://storage.test/x' }],
      },
      {
        userId: 'user',
        workflowId: '',
        workspaceId: 'workspace',
        chatId: 'chat',
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
          userId: 'user',
          workspaceId: 'workspace',
        }),
      }
    )
    expect(result.output).toEqual({ sandboxFiles: [] })
  })
})

describe('Generic Secrets function execution', () => {
  it('mounts the authorized environment and propagates echoed secrets into model redaction', async () => {
    setEnv({ ENCRYPTION_KEY: 'a'.repeat(64) })
    const plaintext = 'test-only-private-token'
    const { encrypted } = await encryptSecret(plaintext)
    const outerRegistry = new ResolvedSecretTraceRegistry([], { userId: 'actor' })
    mocks.mount.mockResolvedValue({
      envVars: { TOKEN: plaintext },
      catalogEntries: [{ name: 'TOKEN', plaintext, encryptedValue: encrypted }],
    })
    mocks.execute.mockImplementation(async (_tool, params, options) => {
      expect(params.envVars).toEqual({ TOKEN: plaintext })
      expect(params.secretScope).toBe('selected')
      expect(params.mountedSecrets).toEqual(['TOKEN'])
      expect(params.unredactedSecretNames).toBeUndefined()
      options.resolvedSecretTraceRegistry.recordResolved('TOKEN', plaintext)
      return { success: true, output: { stdout: `echo: ${plaintext}` } }
    })
    const context = {
      userId: 'actor',
      workflowId: '',
      organizationId: 'org',
      chatId: 'chat',
      toolCallId: 'call',
      copilotToolExecution: true,
      requestMode: 'agent',
      resolvedSecretTraceRegistry: outerRegistry,
    }
    await executeFunctionExecute(
      {
        code: 'print(token)',
        language: 'python',
        secrets: ['TOKEN'],
        envVars: { FORGED: 'not-authorized' },
      },
      context
    )
    expect(mocks.mount).toHaveBeenCalledWith(context, ['TOKEN'])
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(outerRegistry.getModelEgressSnapshot()).toMatchObject({
      complete: true,
      matches: expect.arrayContaining([expect.objectContaining({ plaintext })]),
    })
  })
})
