/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ installation: vi.fn(), publish: vi.fn(), enqueue: vi.fn() }))
vi.mock('@/lib/core/async-jobs', () => ({
  getInlineJobQueue: async () => ({ enqueue: mocks.enqueue }),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))
vi.mock('@/lib/internal/slack/client', () => ({ requestSlackApi: mocks.publish }))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: mocks.installation,
  loadSlackSearchCredential: async () => ({ version: 'v1', botToken: 'private-bot-token' }),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: async () => undefined,
}))

import {
  publishSlackSearchHome,
  receiveSlackSearchHome,
} from '@/lib/knowledge/application/slack-search/home'
import { slackSearchHomeViewKey } from '@/lib/slack-search/home'

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
  vi.clearAllMocks()
  mocks.installation.mockResolvedValue(installation)
  mocks.publish.mockResolvedValue({ status: 200, data: { ok: true } })
})

describe('static Slack Home intake', () => {
  it('queues one deduplicated app-process publication for a first or legacy visit', async () => {
    await receiveSlackSearchHome.execute({ principal: principal(), input: event })
    expect(mocks.enqueue).toHaveBeenCalledWith(
      'slack-search',
      expect.objectContaining({ event, revision: 'r1' }),
      expect.objectContaining({
        jobId: 'slack-search-home:i1:Ev1',
        maxAttempts: 1,
        maxDurationSeconds: 30,
        concurrencyLimit: 2,
      })
    )
    expect(JSON.stringify(mocks.enqueue.mock.calls[0][1])).not.toContain('private-bot-token')
    const [, payload, options] = mocks.enqueue.mock.calls[0]
    await options.runner(payload, new AbortController().signal)
    expect(mocks.publish).toHaveBeenCalledOnce()
  })
  it('acknowledges a current view without Home lookups, queue writes, or Slack API calls', async () => {
    await receiveSlackSearchHome.execute({
      principal: principal(),
      input: { ...event, viewKey: slackSearchHomeViewKey('c1', 'v1', 'https://sim.test') },
    })
    expect(mocks.installation).not.toHaveBeenCalled()
    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it.each([
    slackSearchHomeViewKey('c1', 'old-version', 'https://sim.test'),
    slackSearchHomeViewKey('c1', 'v1', 'https://old.test'),
    slackSearchHomeViewKey('another-credential', 'v1', 'https://sim.test'),
    'old-layout',
  ])('replaces a stale or differently bound view: %s', async (viewKey) => {
    await receiveSlackSearchHome.execute({ principal: principal(), input: { ...event, viewKey } })
    expect(mocks.enqueue).toHaveBeenCalledOnce()
  })
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
        principal: { kind: 'session', userId: 'member1', sessionId: 's1' },
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
  it('propagates queue failures so Slack can retry intake', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    await expect(
      receiveSlackSearchHome.execute({ principal: principal(), input: event })
    ).rejects.toThrow('queue unavailable')
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
  it('propagates infrastructure failures instead of sending a fallback link', async () => {
    mocks.installation.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(publish()).rejects.toThrow('database unavailable')
    expect(mocks.publish).not.toHaveBeenCalled()
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
  it('stops work on cancellation', async () => {
    await expect(publish(AbortSignal.abort())).rejects.toThrow()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it.each([
    { status: 500, data: { ok: false } },
    { status: 200, data: { ok: false, error: 'hash_conflict' } },
  ])('records failed publishing without a replay: %j', async (response) => {
    mocks.publish.mockResolvedValueOnce(response)
    await expect(publish()).rejects.toThrow('Could not publish')
    expect(mocks.publish).toHaveBeenCalledOnce()
  })
  it('does not retry an ambiguous send', async () => {
    mocks.publish.mockRejectedValueOnce(new Error('response lost'))
    await expect(publish()).rejects.toThrow('response lost')
    expect(mocks.publish).toHaveBeenCalledOnce()
  })
})
