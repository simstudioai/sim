import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  sender: vi.fn(),
  findChat: vi.fn(),
  resolveChat: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: mocks.enqueue }))
vi.mock('@/lib/knowledge/application/slack-search/chat', () => ({
  requireSlackSearchConversationSender: mocks.sender,
  findSlackSearchChatRecord: mocks.findChat,
  resolveSlackSearchChatRecord: mocks.resolveChat,
}))

import { persistSlackSearchTurn } from '@/lib/knowledge/application/slack-search/turns'
import { slackSearchConversationKey } from '@/lib/slack-search/conversation'
import type { SlackSearchJob } from '@/lib/slack-search/types'

const installation = {
  id: 'old-installation',
  organizationId: 'org1',
  enabled: false,
  revision: 'switched',
  credentialVersion: 'version1',
}
const job: SlackSearchJob = {
  installationId: installation.id,
  revision: installation.revision,
  credentialId: 'credential1',
  credentialVersion: installation.credentialVersion,
  receivedAt: Date.now(),
  redirectAppId: 'ASHARED',
  message: {
    appId: 'ACUSTOM',
    teamId: 'T1',
    eventId: 'Ev1',
    userId: 'U1',
    channelId: 'D1',
    messageTs: '1800000000.1',
    query: '',
    queryTooLong: false,
  },
}
beforeEach(() => {
  resetDbChainMock()
  mocks.findChat.mockResolvedValue(null)
})

describe('durable retired-bot replies', () => {
  it('returns the existing turn for a duplicate Slack event without another write', async () => {
    queueTableRows(schemaMock.slackSearchInstallation, [installation])
    queueTableRows(schemaMock.slackSearchTurn, [
      {
        id: 'existing-turn',
        conversationKey: slackSearchConversationKey(installation.id, 'D1', '1800000000.1'),
        payload: job,
      },
    ])
    await expect(persistSlackSearchTurn(job)).resolves.toBe('existing-turn')
    expect(dbChainMockFns.values).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { ...installation, enabled: true },
    { ...installation, revision: 'changed' },
    { ...installation, credentialVersion: 'rotated' },
  ])('rejects removed, re-enabled, or changed old installations: %j', async (current) => {
    queueTableRows(schemaMock.slackSearchInstallation, current ? [current] : [])
    await expect(persistSlackSearchTurn(job)).rejects.toThrow('binding changed')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('still rejects regular search turns for disabled installations', async () => {
    queueTableRows(schemaMock.slackSearchInstallation, [installation])
    await expect(persistSlackSearchTurn({ ...job, redirectAppId: undefined })).rejects.toThrow(
      'binding changed'
    )
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('retains the per-thread pending limit for handoff replies', async () => {
    queueTableRows(schemaMock.slackSearchInstallation, [installation])
    queueTableRows(schemaMock.slackSearchTurn, [])
    queueTableRows(schemaMock.slackSearchTurn, [{ count: 20 }])
    await expect(persistSlackSearchTurn(job)).rejects.toThrow('twenty queued questions')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
})
