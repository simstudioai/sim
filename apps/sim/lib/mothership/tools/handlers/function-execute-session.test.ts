/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool, mockMaterializeSecrets } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn().mockResolvedValue({ success: true, output: {} }),
  mockMaterializeSecrets: vi
    .fn()
    .mockResolvedValue({ envVars: { API_KEY: 'test-value' }, catalogEntries: [] }),
}))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))
vi.mock('@/lib/mothership/tools/secret-mount-materializer.server', () => ({
  materializeCopilotCodeSecrets: mockMaterializeSecrets,
  CopilotCodeSecretAccessError: class extends Error {},
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

import {
  clearHandlers,
  executeTool,
  registerHandler,
} from '@/lib/mothership/tool-executor/executor'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'
import { executeRunCode } from '@/lib/mothership/tools/handlers/run-code'

const BASE_CONTEXT: ToolExecutionContext = {
  userId: 'user-1',
  workflowId: '',
  workspaceId: 'ws-1',
  sandboxProfile: 'mothership',
}

describe('executeFunctionExecute session plumbing', () => {
  beforeEach(() => {
    mockExecuteTool.mockClear()
    mockMaterializeSecrets.mockClear()
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

  it.each([
    { language: 'python', code: 'import json\nprint(json.dumps({"apiKey": "{{EXA_API_KEY}}"}))' },
    { language: 'python', code: 'print("{{" + "EXA_API_KEY" + "}}")' },
    { language: 'javascript', code: 'return JSON.stringify({ apiKey: "{{EXA_API_KEY}}" })' },
    { language: 'shell', code: "printf '%s' '{{EXA_API_KEY}}'" },
  ])('keeps authored $language templates literal without requesting secrets', async (params) => {
    await executeFunctionExecute(params, BASE_CONTEXT)
    expect(mockMaterializeSecrets).not.toHaveBeenCalled()
    expect(mockExecuteTool.mock.calls[0][1]).toMatchObject({
      code: params.code,
      envVars: {},
      secretScope: 'selected',
      mountedSecrets: [],
    })
  })

  it('mounts only explicitly named secrets within the caller policy', async () => {
    await executeFunctionExecute(
      {
        code: "return environmentVariables['API_KEY']",
        language: 'javascript',
        secrets: [' API_KEY ', 'API_KEY'],
      },
      {
        ...BASE_CONTEXT,
        secretMountPolicy: { secretScope: 'selected', mountedSecrets: ['API_KEY'] },
      }
    )
    expect(mockMaterializeSecrets).toHaveBeenCalledExactlyOnceWith({
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      requestedNames: ['API_KEY'],
    })
    expect(mockExecuteTool.mock.calls[0][1]).toMatchObject({
      envVars: { API_KEY: 'test-value' },
      mountedSecrets: ['API_KEY'],
    })
    expect(mockExecuteTool.mock.calls[0][1]).not.toHaveProperty('secrets')
  })

  it('rejects explicit secrets outside the allowlist before materialization or execution', async () => {
    await expect(
      executeFunctionExecute(
        { code: 'return 1', secrets: ['API_KEY'] },
        { ...BASE_CONTEXT, secretMountPolicy: { secretScope: 'selected', mountedSecrets: [] } }
      )
    ).rejects.toThrow('Secret access is not allowed for: API_KEY')
    expect(mockMaterializeSecrets).not.toHaveBeenCalled()
    expect(mockExecuteTool).not.toHaveBeenCalled()
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
    expect(mockExecuteTool.mock.calls[2][1].timeout).toBe(300_000)
  })
})

describe.each([
  ['run_function', executeFunctionExecute],
  ['run_code', executeRunCode],
] as const)('%s timeout across the dispatcher and real handler', (toolId, handler) => {
  beforeEach(() => {
    mockExecuteTool.mockClear()
    clearHandlers()
    registerHandler(toolId, handler)
  })
  afterEach(clearHandlers)

  it.each([
    { timeout: undefined, expected: 60_000 },
    { timeout: 0.5, expected: 500 },
    { timeout: 7, expected: 7_000 },
    { timeout: '90', expected: 90_000 },
    { timeout: 300, expected: 300_000 },
    { timeout: 601, expected: 300_000 },
    { timeout: 45_000, expected: 300_000 },
    { timeout: 0, expected: 60_000 },
    { timeout: 'invalid', expected: 60_000 },
  ])('maps $timeout seconds to $expected milliseconds once', async ({ timeout, expected }) => {
    const params = { code: 'return 1', language: 'javascript', timeout }
    const result = await executeTool(toolId, params, {
      ...BASE_CONTEXT,
      copilotToolExecution: true,
      userPermission: 'write',
    })
    expect(result.success).toBe(true)
    expect(mockExecuteTool).toHaveBeenCalledExactlyOnceWith(
      'function_execute',
      expect.objectContaining({ timeout: expected }),
      expect.any(Object)
    )
    expect(params.timeout).toBe(timeout)
  })
})
