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
