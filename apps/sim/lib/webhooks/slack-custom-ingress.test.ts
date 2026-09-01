/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  getCredential: vi.fn(),
  listSessions: vi.fn(),
  unregister: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('@/lib/execution/cancel-workflow-execution', () => ({
  cancelWorkflowExecution: mocks.cancel,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  getSlackBotCredential: mocks.getCredential,
}))
vi.mock('@/lib/webhooks/slack-agent-api', () => ({
  setSlackAgentSessionStatus: mocks.setStatus,
}))
vi.mock('@/lib/webhooks/slack-stream-sessions', () => ({
  resolveStoppedSlackSession: (body: Record<string, unknown>) =>
    body.kind === 'stop' ? { channel: 'D1', threadTs: '100.1' } : null,
  listSlackStreamSessions: mocks.listSessions,
  unregisterSlackStreamSession: mocks.unregister,
}))

import {
  getLegacySlackCustomBotCredentialId,
  handleSlackAgentSessionStopped,
} from '@/lib/webhooks/slack-custom-ingress'

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    provider: 'slack',
    routingKey: 'credential-1',
    providerConfig: {
      triggerId: 'slack_webhook',
      credentialId: 'credential-1',
      ingressMode: 'legacy_custom_bot',
    },
    ...overrides,
  }
}

describe('getLegacySlackCustomBotCredentialId', () => {
  it('returns the credential for a fully marked legacy webhook', () => {
    expect(getLegacySlackCustomBotCredentialId(webhook())).toBe('credential-1')
  })

  it('ignores ordinary path webhooks', () => {
    expect(
      getLegacySlackCustomBotCredentialId(
        webhook({ providerConfig: { triggerId: 'slack_webhook' }, routingKey: null })
      )
    ).toBeNull()
  })

  it('fails fast on a partial marker', () => {
    expect(() =>
      getLegacySlackCustomBotCredentialId(webhook({ routingKey: 'credential-2' }))
    ).toThrow(/routing key does not match/)
  })
})

describe('handleSlackAgentSessionStopped', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listSessions.mockResolvedValue([])
    mocks.getCredential.mockResolvedValue({ botToken: 'xoxb-test' })
  })

  it('cancels every active execution and returns the session to active', async () => {
    mocks.listSessions.mockResolvedValue([
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        executionId: 'execution-2',
        workflowId: 'workflow-2',
        userId: 'user-2',
        workspaceId: 'workspace-1',
      },
    ])

    await handleSlackAgentSessionStopped('credential-1', { kind: 'stop' })

    expect(mocks.cancel).toHaveBeenCalledTimes(2)
    expect(mocks.unregister).toHaveBeenCalledTimes(2)
    expect(mocks.setStatus).toHaveBeenCalledWith(
      'xoxb-test',
      { channel: 'D1', threadTs: '100.1' },
      'active'
    )
  })

  it('keeps the session mapping when cancellation fails so Slack can retry', async () => {
    mocks.listSessions.mockResolvedValue([
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    ])
    mocks.cancel.mockRejectedValue(new Error('cancel failed'))

    await expect(handleSlackAgentSessionStopped('credential-1', { kind: 'stop' })).rejects.toThrow(
      'cancel failed'
    )
    expect(mocks.unregister).not.toHaveBeenCalled()
    expect(mocks.setStatus).not.toHaveBeenCalled()
  })
})
