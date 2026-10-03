import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  redirect: vi.fn(),
  persist: vi.fn(),
  dispatch: vi.fn(),
  assistant: vi.fn(),
  route: vi.fn(),
  lease: vi.fn(),
  post: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  requireSlackInstallationPrincipal: vi.fn(),
  authorizeSlackSearchInstallation: mocks.authorize,
  authorizeSlackSearchRedirect: mocks.redirect,
}))
vi.mock('@/lib/knowledge/application/slack-search/assistant', () => ({
  runSlackSearchAssistant: mocks.assistant,
}))
vi.mock('@/lib/knowledge/application/slack-search/turns', () => ({
  persistSlackSearchTurn: mocks.persist,
  requireSlackSearchTurnLease: mocks.lease,
}))
vi.mock('@/lib/knowledge/application/slack-search/mention', () => ({
  routeSlackSearchMentionToDm: mocks.route,
}))
vi.mock('@/lib/internal/slack/client', () => ({ postSlackMessage: mocks.post }))
vi.mock('@/lib/knowledge/application/slack-search/outbox', () => ({
  dispatchSlackSearchTurn: mocks.dispatch,
}))

import {
  receiveSlackSearchMessage,
  respondToSlackSearchMessage,
} from '@/lib/knowledge/application/slack-search/process-message'
import type { SlackSearchJob } from '@/lib/slack-search/types'

const principal = {
  kind: 'slack_installation',
  credentialId: 'c1',
  credentialVersion: 'v1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
} as const
const message = {
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  channelId: 'D1',
  userId: 'U1',
  messageTs: '1800000000.000001',
  query: 'release notes',
  queryTooLong: false,
}
beforeEach(() => {
  mocks.authorize.mockResolvedValue({
    installation: { id: 'i1', revision: 'r1', botUserId: 'UBOT' },
    secret: { botToken: 'test-token' },
  })
  mocks.persist.mockResolvedValue('turn1')
  mocks.redirect.mockResolvedValue(null)
  mocks.route.mockImplementation(async (_principal, { job }) => job)
  mocks.post.mockResolvedValue({ status: 200, data: { ok: true } })
})

describe('retired bot handoff', () => {
  const redirect = {
    installation: { id: 'i1', revision: 'r1', botUserId: 'UBOT' },
    replacement: { appId: 'ASHARED' },
    secret: { botToken: 'old-bot-token' },
  }
  const job: SlackSearchJob = {
    installationId: 'i1',
    revision: 'r1',
    credentialId: 'c1',
    credentialVersion: 'v1',
    receivedAt: principal.receivedAt.getTime(),
    redirectAppId: 'ASHARED',
    message: { ...message, query: '' },
  }
  beforeEach(() => {
    mocks.authorize.mockResolvedValue(null)
    mocks.redirect.mockResolvedValue(redirect)
  })
  const respond = (overrides: Partial<SlackSearchJob> = {}) =>
    respondToSlackSearchMessage.execute({
      principal,
      input: {
        job: { ...job, ...overrides },
        turnId: 'turn1',
        leaseId: 'lease1',
        controller: new AbortController(),
      },
    })

  it('keeps a manually disabled bot quiet without an active replacement', async () => {
    mocks.redirect.mockResolvedValue(null)
    await receiveSlackSearchMessage.execute({ principal, input: message })
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it.each([{ channelId: 'C1' }, { userId: 'UBOT' }])(
    'ignores mentions and bot messages: %j',
    async (change) => {
      await receiveSlackSearchMessage.execute({ principal, input: { ...message, ...change } })
      expect(mocks.persist).not.toHaveBeenCalled()
    }
  )

  it.each([null, { ...redirect, replacement: { appId: 'ADIFFERENT' } }])(
    'rechecks replacement availability before delivery: %j',
    async (current) => {
      mocks.redirect.mockResolvedValue(current)
      await expect(respond()).rejects.toThrow('replacement changed')
      expect(mocks.post).not.toHaveBeenCalled()
    }
  )

  it('does not deliver after losing its durable claim', async () => {
    mocks.lease.mockRejectedValueOnce(new Error('lease lost'))
    await expect(respond()).rejects.toThrow('lease lost')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('does not retry failed or ambiguous sends', async () => {
    mocks.post.mockResolvedValueOnce({ status: 200, data: { ok: false } })
    await expect(respond()).rejects.toThrow('handoff')
    mocks.post.mockRejectedValueOnce(new Error('response lost'))
    await expect(respond()).rejects.toThrow('response lost')
    expect(mocks.post).toHaveBeenCalledTimes(2)
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
})

describe('Slack Search question validation', () => {
  function respond(overrides: Partial<SlackSearchJob['message']> = {}) {
    return respondToSlackSearchMessage.execute({
      principal,
      input: {
        job: {
          installationId: 'i1',
          revision: 'r1',
          credentialId: 'c1',
          credentialVersion: 'v1',
          receivedAt: principal.receivedAt.getTime(),
          message: { ...message, query: '', queryTooLong: true, ...overrides },
        },
        turnId: 'turn1',
        leaseId: 'lease1',
        controller: new AbortController(),
      },
    })
  }
  it('does not deliver after the installation is disabled', async () => {
    mocks.authorize.mockResolvedValueOnce(null)
    await expect(respond()).rejects.toThrow('binding changed')
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('does not deliver after losing the durable turn lease', async () => {
    mocks.lease.mockRejectedValueOnce(new Error('lease lost'))
    await expect(respond()).rejects.toThrow('lease lost')
    expect(mocks.post).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous notice delivery', async () => {
    mocks.post.mockRejectedValueOnce(new Error('response lost'))
    await expect(respond()).rejects.toThrow('response lost')
    expect(mocks.post).toHaveBeenCalledOnce()
    expect(mocks.assistant).not.toHaveBeenCalled()
  })
})
describe('Slack Search intake', () => {
  it('rejects a different authenticated app before persistence', async () => {
    await expect(
      receiveSlackSearchMessage.execute({ principal, input: { ...message, appId: 'A2' } })
    ).rejects.toThrow('authenticated context')
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('does not dispatch a turn that failed to commit', async () => {
    mocks.persist.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(receiveSlackSearchMessage.execute({ principal, input: message })).rejects.toThrow(
      'database unavailable'
    )
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
