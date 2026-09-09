/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  installation: vi.fn(),
  sender: vi.fn(),
  member: vi.fn(),
  list: vi.fn(),
  authorize: vi.fn(),
  publish: vi.fn(),
  enqueue: vi.fn(),
}))
vi.mock('@/lib/core/async-jobs', () => ({
  getInlineJobQueue: async () => ({ enqueue: mocks.enqueue }),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.test' }))
vi.mock('@/lib/internal/slack/client', () => ({ requestSlackApi: mocks.publish }))
vi.mock('@/lib/internal/slack/search-client', () => ({ getSlackSearchSender: mocks.sender }))
vi.mock('@/lib/knowledge/application/search-sources', () => ({
  listSearchSources: { execute: mocks.list, authorize: mocks.authorize },
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: mocks.installation,
  loadSlackSearchCredential: async () => ({ version: 'v1', botToken: 'private-bot-token' }),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: async () => undefined,
}))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: mocks.member,
  SlackSearchIdentityError: class extends Error {},
}))
vi.mock('@/connectors/registry', () => ({ getConnectorMeta: () => ({ name: 'Google Drive' }) }))

import {
  publishSlackSearchHome,
  receiveSlackSearchHome,
} from '@/lib/knowledge/application/slack-search/home'
import { SlackSearchIdentityError } from '@/lib/knowledge/application/slack-search/identity'

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
function source(id = 'source1') {
  return {
    connectorId: id,
    connectorType: 'google_drive',
    sourceDescription: 'Folder',
    enabled: true,
    approved: true,
    availability: 'available',
    connectionRequired: true,
    viewerMembership: 'connected',
    isSyncing: false,
    hasSyncError: false,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.installation.mockResolvedValue(installation)
  mocks.sender.mockResolvedValue({ email: 'viewer@example.test' })
  mocks.member.mockResolvedValue('member1')
  mocks.list.mockResolvedValue({ sources: [source()], nextCursor: null })
  mocks.authorize.mockResolvedValue(undefined)
  mocks.publish.mockResolvedValue({ status: 200, data: { ok: true } })
})

describe('Slack Home intake', () => {
  it('queues a deduplicated app-process update with no token or Sim user in the payload', async () => {
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
    expect(JSON.stringify(mocks.enqueue.mock.calls[0][1])).not.toMatch(
      /private-bot-token|member1|viewer@/
    )
    expect(mocks.sender).not.toHaveBeenCalled()
    const [, payload, options] = mocks.enqueue.mock.calls[0]
    await options.runner(payload, new AbortController().signal)
    expect(mocks.publish).toHaveBeenCalledOnce()
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
})

describe('personalized Home delivery', () => {
  it('uses the installation’s organization, the current member, and the same source use case', async () => {
    await publish()
    expect(mocks.sender).toHaveBeenCalledWith(
      'private-bot-token',
      'U1',
      'T1',
      expect.any(AbortSignal)
    )
    expect(mocks.list).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        serviceId: 'slack-search',
        organizationId: 'org1',
        subjectUserId: 'member1',
        resourceScope: { installationId: 'i1', eventId: 'Ev1' },
      }),
      input: { organizationId: 'org1', cursor: undefined },
    })
    expect(mocks.member).toHaveBeenCalledTimes(2)
    expect(mocks.authorize).toHaveBeenCalledOnce()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'views.publish',
        body: expect.objectContaining({
          user_id: 'U1',
          hash: 'h1',
          view: expect.objectContaining({ type: 'home' }),
        }),
      })
    )
    expect(JSON.stringify(mocks.publish.mock.calls[0][0].body)).toContain(
      'https://sim.test/o/org1/integrations'
    )
  })
  it.each([
    'account_required',
    'verify_email',
    'membership_required',
    'identity_conflict',
  ] as const)('shows no protected source details for %s', async (reason) => {
    mocks.member.mockRejectedValue(new SlackSearchIdentityError(reason))
    await publish()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.publish.mock.calls[0][0].body)).toContain('Sign in to Sim')
    expect(JSON.stringify(mocks.publish.mock.calls[0][0].body)).not.toContain('Google Drive')
  })
  it('propagates infrastructure failures instead of inventing an empty source list', async () => {
    mocks.list.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(publish()).rejects.toThrow('database unavailable')
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('rejects Slack users with no valid workspace email', async () => {
    mocks.sender.mockResolvedValueOnce(null)
    await expect(publish()).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
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
  it('rechecks disablement immediately before publishing', async () => {
    mocks.installation
      .mockResolvedValueOnce(installation)
      .mockResolvedValueOnce({ ...installation, enabled: false })
    await publish()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('rejects lost member authorization before delivery', async () => {
    mocks.authorize.mockRejectedValueOnce(new Error('member access removed'))
    await expect(publish()).rejects.toThrow('member access removed')
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('caps sparse pagination and avoids claiming there are no connections', async () => {
    mocks.list.mockResolvedValue({ sources: [], nextCursor: 'cursor' })
    await publish()
    expect(mocks.list).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(mocks.publish.mock.calls[0][0].body)).not.toContain(
      'No sources connected yet'
    )
  })
  it('caps rendered sources without fetching more pages', async () => {
    mocks.list.mockResolvedValue({
      sources: Array.from({ length: 25 }, (_, i) => source(`source${i}`)),
      nextCursor: 'cursor',
    })
    await publish()
    expect(mocks.list).toHaveBeenCalledOnce()
    expect(mocks.publish.mock.calls[0][0].body.view.blocks).toHaveLength(25)
  })
  it('stops work on cancellation', async () => {
    await expect(publish(AbortSignal.abort())).rejects.toThrow()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it.each([
    { status: 500, data: { ok: false } },
    { status: 200, data: { ok: false, error: 'hash_conflict' } },
  ])('records failed publishing without a fallback or replay: %j', async (response) => {
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
