/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: mocks.execute }))
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: vi.fn().mockResolvedValue(true),
}))

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
