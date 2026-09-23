/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workflowInputsCommand } from '@/lib/mothership/agent-cli/engines/workflow-inputs'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('@/lib/workflows/application/read-workflow-copilot-metadata', () => ({
  readCopilotWorkflowRunOptions: { execute: mocks.execute },
}))

const runtime: AgentCliRuntime = {
  workspaceId: 'workspace',
  userId: 'actor',
  principal: { kind: 'session', userId: 'actor' },
  client: { request: vi.fn() },
}

describe('workflow input discovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns every authorized draft entrypoint without changing its schema', async () => {
    const options = [
      { triggerBlockId: 'start', inputKind: 'fields', inputSchema: { type: 'object' } },
      { triggerBlockId: 'webhook', inputKind: 'event_payload', mockPayload: { event: 'push' } },
      { triggerBlockId: 'chat', inputKind: 'chat', mockPayload: { input: 'message' } },
    ]
    mocks.execute.mockResolvedValue({ options })
    const result = await workflowInputsCommand.execute(['workflow'], runtime, {})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ workflowId: 'workflow', version: 'draft', options })
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
      principal: runtime.principal,
      input: { workflowId: 'workflow', assertedWorkspaceId: 'workspace' },
    })
    expect(runtime.client.request).not.toHaveBeenCalled()
  })

  it('rejects missing arguments or identity before protected loading', async () => {
    expect((await workflowInputsCommand.execute([], runtime, {})).exitCode).toBe(1)
    expect(
      (await workflowInputsCommand.execute(['workflow'], { ...runtime, principal: undefined }, {}))
        .exitCode
    ).toBe(1)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('propagates authorization and storage failures to the shared CLI error boundary', async () => {
    mocks.execute.mockRejectedValue(new Error('Workspace denied'))
    await expect(workflowInputsCommand.execute(['workflow'], runtime, {})).rejects.toThrow(
      'Workspace denied'
    )
  })
})
