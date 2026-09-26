import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { asyncJobsMock, asyncJobsMockFns } from '@sim/testing/mocks/async-jobs.mock'
import { knowledgeAvailabilityMock } from '@sim/testing/mocks/knowledge-availability.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ installation: vi.fn(), publish: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => asyncJobsMock)
vi.mock('@/lib/internal/slack/client', () => ({ requestSlackApi: hoisted.publish }))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: hoisted.installation,
  loadSlackSearchCredential: async () => ({ version: 'v1', botToken: 'private-bot-token' }),
}))
vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

import {
  publishSlackSearchHome,
  receiveSlackSearchHome,
} from '@/lib/knowledge/application/slack-search/home'
import { slackSearchHomeViewKey } from '@/lib/slack-search/home'

const mocks = {
  ...hoisted,
  enqueue: asyncJobsMockFns.mockJobQueue.enqueue,
}

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')

const installation = {
  id: 'i1',
  revision: 'r1',
  appId: 'A1',
  teamId: 'T1',
  credentialId: 'c1',
  credentialVersion: 'v1',
  organizationId: 'org1',
  botUserId: 'UBOT',
  enabled: true,
}
const event = { appId: 'A1', teamId: 'T1', eventId: 'Ev1', userId: 'U1', viewHash: 'h1' }
function principal() {
  return {
    kind: 'slack_installation' as const,
    credentialId: 'c1',
    credentialVersion: 'v1',
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev1',
    receivedAt: new Date(),
  }
}
function publish(signal = new AbortController().signal) {
  return publishSlackSearchHome.execute({
    principal: principal(),
    input: {
      job: {
        installationId: 'i1',
        revision: 'r1',
        credentialId: 'c1',
        credentialVersion: 'v1',
        receivedAt: Date.now(),
        event,
      },
      signal,
    },
  })
}
beforeEach(() => {
  mocks.installation.mockResolvedValue(installation)
  mocks.publish.mockResolvedValue({ status: 200, data: { ok: true } })
})

describe('static Slack Home intake', () => {
  it.each(['appId', 'teamId', 'eventId'] as const)(
    'rejects a mismatched %s before loading the installation',
    async (field) => {
      await expect(
        receiveSlackSearchHome.execute({
          principal: principal(),
          input: { ...event, [field]: 'other' },
        })
      ).rejects.toThrow('authority')
      expect(mocks.installation).not.toHaveBeenCalled()
      expect(mocks.enqueue).not.toHaveBeenCalled()
    }
  )
  it('rejects a non-Slack principal and expired intake', async () => {
    await expect(
      receiveSlackSearchHome.execute({
        principal: createSessionPrincipal({ userId: 'member1', sessionId: 's1' }),
        input: event,
      })
    ).rejects.toThrow('installation authority')
    await expect(
      receiveSlackSearchHome.execute({
        principal: { ...principal(), receivedAt: new Date(Date.now() - 301_000) },
        input: event,
      })
    ).rejects.toThrow('authority')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('does not queue disabled installations or bot users', async () => {
    mocks.installation.mockResolvedValueOnce({ ...installation, enabled: false })
    await receiveSlackSearchHome.execute({ principal: principal(), input: event })
    await receiveSlackSearchHome.execute({
      principal: principal(),
      input: { ...event, userId: 'UBOT' },
    })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
})

describe('static Home delivery', () => {
  it('publishes only the static organization link and marker to the Slack viewer', async () => {
    await publish()
    expect(mocks.publish).toHaveBeenCalledOnce()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'views.publish',
        body: expect.objectContaining({
          user_id: 'U1',
          hash: 'h1',
          view: expect.objectContaining({
            type: 'home',
            callback_id: slackSearchHomeViewKey('c1', 'v1', 'https://sim.test'),
          }),
        }),
      })
    )
    const { view } = mocks.publish.mock.calls[0][0].body
    expect(view.blocks).toHaveLength(3)
    expect(view.blocks[2].elements[0].url).toBe('https://sim.test/o/org1/integrations')
  })
  it.each([
    { enabled: false },
    { revision: 'r2' },
    { credentialVersion: 'v2' },
    { appId: 'A2' },
    { teamId: 'T2' },
  ])('invalidates queued work when its binding changes: %j', async (change) => {
    mocks.installation.mockResolvedValue({ ...installation, ...change })
    if ('enabled' in change) await publish()
    else await expect(publish()).rejects.toThrow('binding')
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous send', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('response lost'))
    await expect(publish()).rejects.toThrow('response lost')
    expect(mocks.publish).toHaveBeenCalledOnce()
  })
})
