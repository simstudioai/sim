/** @vitest-environment node */
import { setEnv } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), mount: vi.fn() }))
vi.mock('@/lib/mothership/tools/organization-secret-mount', () => ({
  materializeOrganizationCodeSecrets: mocks.mount,
}))
vi.mock('@/tools', () => ({ executeTool: mocks.execute }))
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: vi.fn().mockResolvedValue(true),
}))

import { encryptSecret } from '@/lib/core/security/encryption'
import { sandboxSessionInputsSafe } from '@/lib/execution/remote-sandbox/execution-observer'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

beforeEach(() => {
  mocks.execute.mockReset()
  mocks.execute.mockImplementation(async () => ({
    success: true,
    output: { sessionInputsSafe: sandboxSessionInputsSafe() },
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
      expect(response.output.sessionInputsSafe).toBe(state === 'empty')
      expect(sandboxSessionInputsSafe()).toBe(false)
    }
  )
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
