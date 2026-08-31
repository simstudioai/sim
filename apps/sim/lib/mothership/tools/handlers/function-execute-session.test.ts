/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn().mockResolvedValue({ success: true, output: {} }),
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/executor/utils/code-secret-references', () => ({
  extractCodeSecretNames: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/executor/utils/resolved-secret-trace-registry', () => ({
  ResolvedSecretTraceRegistry: class {
    getUnredactedSecretNames() {
      return []
    }
    exportProvenance() {
      return { complete: true }
    }
    exportProvenanceForValue() {
      return { complete: true }
    }
    getResolvedSecretUsage() {
      return []
    }
  },
}))
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: vi.fn() }))
vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxAccess: vi.fn().mockResolvedValue(true),
}))

import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'

const BASE_CONTEXT: ToolExecutionContext = {
  userId: 'user-1',
  workspaceId: 'ws-1',
  sandboxProfile: 'mothership',
} as ToolExecutionContext

describe('executeFunctionExecute session plumbing', () => {
  beforeEach(() => {
    mockExecuteTool.mockClear()
  })

  it('derives the session key from the chat, one per chat', async () => {
    await executeFunctionExecute(
      { code: 'print(1)', language: 'python' },
      { ...BASE_CONTEXT, chatId: 'chat-123' }
    )
    const [, params] = mockExecuteTool.mock.calls[0]
    expect(params.sandboxSessionKey).toBe('mothership-chat:chat-123')
  })

  it('never honors a model-supplied session key', async () => {
    await executeFunctionExecute(
      { code: 'print(1)', language: 'python', sandboxSessionKey: 'mothership-chat:other' },
      BASE_CONTEXT
    )
    const [, params] = mockExecuteTool.mock.calls[0]
    expect(params.sandboxSessionKey).toBeUndefined()
  })

  it('stays ephemeral for chat-less executions', async () => {
    await executeFunctionExecute({ code: 'print(1)', language: 'python' }, BASE_CONTEXT)
    const [, params] = mockExecuteTool.mock.calls[0]
    expect(params.sandboxSessionKey).toBeUndefined()
  })

  it('converts second-denominated timeouts, including string values', async () => {
    // The catalog doc promises seconds; models also send the number as a string.
    // Without the tolerant parse, "90" reached the body schema's z.coerce and
    // armed a 90ms abort.
    await executeFunctionExecute({ code: 'x', language: 'python', timeout: 90 }, BASE_CONTEXT)
    expect(mockExecuteTool.mock.calls[0][1].timeout).toBe(90_000)

    await executeFunctionExecute({ code: 'x', language: 'python', timeout: '90' }, BASE_CONTEXT)
    expect(mockExecuteTool.mock.calls[1][1].timeout).toBe(90_000)

    await executeFunctionExecute({ code: 'x', language: 'python', timeout: 45_000 }, BASE_CONTEXT)
    expect(mockExecuteTool.mock.calls[2][1].timeout).toBe(45_000)
  })
})
