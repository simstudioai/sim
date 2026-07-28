/**
 * @vitest-environment node
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as runSessionModule from '@/lib/managed-agents/run-session'
import { managedAgentRunSessionTool } from '@/tools/managed_agent/run_session'
import type { ManagedAgentRunSessionParams } from '@/tools/managed_agent/types'

/**
 * Spy on the real module namespace instead of vi.mock: under `isolate: false`
 * the tool module may already be cached bound to the real run-session module,
 * so patching the shared namespace is the only wiring that always applies.
 */
const runManagedAgentSession = vi.spyOn(runSessionModule, 'runManagedAgentSession')

afterAll(() => {
  runManagedAgentSession.mockRestore()
})

const run = (params: Partial<ManagedAgentRunSessionParams>) =>
  managedAgentRunSessionTool.directExecution!({
    credential: 'cred_1',
    accessToken: 'sk-ant-fake',
    agent: 'agent_1',
    environment: 'env_1',
    userMessage: 'hi',
    ...params,
  } as ManagedAgentRunSessionParams)

beforeEach(() => {
  vi.clearAllMocks()
  runManagedAgentSession.mockResolvedValue({
    ok: true,
    content: 'hello',
    sessionId: 'sess_1',
    inputTokens: 12,
    outputTokens: 3,
  })
})

describe('managedAgentRunSessionTool.directExecution', () => {
  it('errors when no credential key was injected', async () => {
    const res = await run({ accessToken: undefined })
    expect(res.success).toBe(false)
    expect(runManagedAgentSession).not.toHaveBeenCalled()
  })

  it('errors when agent or environment is blank', async () => {
    const res = await run({ agent: '  ' })
    expect(res.success).toBe(false)
    expect(runManagedAgentSession).not.toHaveBeenCalled()
  })

  it('fails closed when vaults are selected without acknowledgement', async () => {
    const res = await run({ vaults: ['vlt_1'], vaultsAck: false })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Vault authorization')
    expect(runManagedAgentSession).not.toHaveBeenCalled()
  })

  it('passes vaults through once acknowledged', async () => {
    await run({ vaults: ['vlt_1'], vaultsAck: true })
    expect(runManagedAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-fake', vaultIds: ['vlt_1'] })
    )
  })

  it('maps a successful run to content + sessionId + token usage', async () => {
    const res = await run({})
    expect(res).toEqual({
      success: true,
      output: { content: 'hello', sessionId: 'sess_1', inputTokens: 12, outputTokens: 3 },
    })
  })

  it('surfaces a failed run as an error while preserving partial content', async () => {
    runManagedAgentSession.mockResolvedValue({ ok: false, content: 'partial', error: 'boom' })
    const res = await run({})
    expect(res.success).toBe(false)
    expect(res.error).toBe('boom')
    expect(res.output.content).toBe('partial')
  })
})
