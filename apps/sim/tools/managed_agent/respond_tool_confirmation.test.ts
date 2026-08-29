/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendToolConfirmations } = vi.hoisted(() => ({
  mockSendToolConfirmations: vi.fn(),
}))

vi.mock('@/lib/managed-agents/session-client', () => ({
  sendToolConfirmations: mockSendToolConfirmations,
}))

import { executeManagedAgentRespondToolConfirmationOperation } from '@/lib/internal/managed-agent/operations/respond-tool-confirmation'

describe('Managed Agent tool confirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendToolConfirmations.mockResolvedValue(undefined)
  })

  /*
   * denyMessage was read with `params.denyMessage?.trim()` above the try block, so a
   * non-string arriving from a stored workflow threw past every `success: false` path
   * this operation otherwise returns.
   */
  it('returns a result rather than throwing when denyMessage is not text', async () => {
    const result = await executeManagedAgentRespondToolConfirmationOperation({
      accessToken: 'token',
      sessionId: 'session-1',
      toolUseIds: ['tool-use-1'],
      decision: 'deny',
      denyMessage: 42,
    } as never)
    expect(result.success).toBe(true)
    expect(mockSendToolConfirmations).toHaveBeenLastCalledWith({
      apiKey: 'token',
      sessionId: 'session-1',
      confirmations: [{ toolUseId: 'tool-use-1', result: 'deny', denyMessage: '42' }],
    })
  })

  it('returns a structured failure for a value with no safe text form', async () => {
    const hostile = { toString: 'not a function' }
    const result = await executeManagedAgentRespondToolConfirmationOperation({
      accessToken: 'token',
      sessionId: 'session-1',
      toolUseIds: ['tool-use-1'],
      decision: 'deny',
      denyMessage: hostile,
    } as never)
    expect(result.success).toBe(true)
    expect(mockSendToolConfirmations).toHaveBeenLastCalledWith({
      apiKey: 'token',
      sessionId: 'session-1',
      confirmations: [{ toolUseId: 'tool-use-1', result: 'deny' }],
    })
  })

  it('rejects a null-prototype decision instead of throwing past the result contract', async () => {
    const result = await executeManagedAgentRespondToolConfirmationOperation({
      accessToken: 'token',
      sessionId: 'session-1',
      toolUseIds: ['tool-use-1'],
      decision: Object.create(null),
    } as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Decision must be/)
  })

  it('sends a denial message only for deny decisions', async () => {
    await executeManagedAgentRespondToolConfirmationOperation({
      accessToken: 'token',
      sessionId: 'session-1',
      toolUseIds: ['tool-use-1'],
      decision: 'allow',
      denyMessage: 'must not be sent',
    })
    expect(mockSendToolConfirmations).toHaveBeenLastCalledWith({
      apiKey: 'token',
      sessionId: 'session-1',
      confirmations: [{ toolUseId: 'tool-use-1', result: 'allow' }],
    })

    await executeManagedAgentRespondToolConfirmationOperation({
      accessToken: 'token',
      sessionId: 'session-1',
      toolUseIds: ['tool-use-1'],
      decision: 'deny',
      denyMessage: 'not authorized',
    })
    expect(mockSendToolConfirmations).toHaveBeenLastCalledWith({
      apiKey: 'token',
      sessionId: 'session-1',
      confirmations: [{ toolUseId: 'tool-use-1', result: 'deny', denyMessage: 'not authorized' }],
    })
  })
})
