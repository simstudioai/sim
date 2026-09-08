/** @vitest-environment node */
import type { SlackInstallationPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  installation: vi.fn(),
  credential: vi.fn(),
  availability: vi.fn(),
  sender: vi.fn(),
  member: vi.fn(),
  search: vi.fn(),
  send: vi.fn(),
  outcome: vi.fn(),
  enqueue: vi.fn(),
  authorizeMember: vi.fn(),
}))
vi.mock('@/lib/knowledge/application/slack-search/repository', () => ({
  findSlackSearchInstallation: mocks.installation,
  loadSlackSearchCredential: mocks.credential,
  recordSlackSearchOutcome: mocks.outcome,
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: mocks.availability,
}))
vi.mock('@/lib/internal/slack/search-client', () => ({
  getSlackSearchSender: mocks.sender,
  SlackSearchProviderError: class extends Error {},
}))
vi.mock('@/lib/internal/slack/client', () => ({ postSlackMessage: mocks.send }))
vi.mock('@/lib/knowledge/application/slack-search/identity', () => ({
  resolveSlackSearchMember: mocks.member,
  SlackSearchIdentityError: class extends Error {
    constructor() {
      super('Identity required')
    }
  },
}))
vi.mock('@/lib/knowledge/application/workspace-search', () => ({
  searchScopedKnowledge: { execute: mocks.search },
}))
vi.mock('@/lib/knowledge/application/billing', () => ({
  KnowledgeUsageLimitExceededError: class extends Error {},
}))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorizeMember,
}))
vi.mock('@/lib/slack-search/queue', () => ({ enqueueSlackSearch: mocks.enqueue }))

import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import {
  receiveSlackSearchMessage,
  respondToSlackSearchMessage,
} from '@/lib/knowledge/application/slack-search/process-message'
import type { SlackSearchJob } from '@/lib/slack-search/types'

const principal: SlackInstallationPrincipal = {
  kind: 'slack_installation',
  credentialId: 'cred1',
  credentialVersion: 'version1',
  appId: 'A1',
  teamId: 'T1',
  eventId: 'Ev1',
  receivedAt: new Date(),
}
const installation = {
  id: 'install1',
  organizationId: 'org1',
  credentialId: 'cred1',
  enabled: true,
  appId: 'A1',
  teamId: 'T1',
  botUserId: 'UBOT',
  credentialVersion: 'version1',
  revision: 'revision1',
}
const job: SlackSearchJob = {
  installationId: 'install1',
  revision: 'revision1',
  credentialId: 'cred1',
  credentialVersion: 'version1',
  receivedAt: principal.receivedAt.getTime(),
  message: {
    appId: 'A1',
    teamId: 'T1',
    eventId: 'Ev1',
    channelId: 'D1',
    userId: 'UHUMAN',
    query: 'release notes',
    queryTooLong: false,
  },
}
const run = () =>
  respondToSlackSearchMessage.execute({
    principal,
    input: { job, signal: new AbortController().signal, rateLimited: false },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.installation.mockResolvedValue(installation)
  mocks.credential.mockResolvedValue({ version: 'version1', botToken: 'bot-token' })
  mocks.availability.mockResolvedValue(undefined)
  mocks.sender.mockResolvedValue({ email: 'alice@example.com' })
  mocks.member.mockResolvedValue('sim-user')
  mocks.search.mockResolvedValue({ results: [], knowledgeBases: [], query: 'release notes' })
  mocks.send.mockResolvedValue({ status: 200, data: { ok: true } })
  mocks.outcome.mockResolvedValue(undefined)
  mocks.authorizeMember.mockResolvedValue(undefined)
  mocks.enqueue.mockResolvedValue('job-id')
})

describe('Slack Search application lifecycle', () => {
  it('calls the app search as the current sender with organization scope and the same defaults', async () => {
    await run()
    expect(mocks.search).toHaveBeenCalledWith({
      principal: expect.objectContaining({
        kind: 'organization_delegated',
        serviceId: 'slack-search',
        subjectUserId: 'sim-user',
        organizationId: 'org1',
        resourceScope: { installationId: 'install1', eventId: 'Ev1' },
      }),
      input: {
        organizationId: 'org1',
        query: 'release notes',
        topK: 20,
        surface: 'slack',
        signal: expect.any(AbortSignal),
      },
    })
    expect(mocks.member).toHaveBeenCalledTimes(2)
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith(
      'bot-token',
      expect.objectContaining({ channel: 'D1', text: expect.stringContaining('No results') }),
      expect.any(AbortSignal)
    )
  })
  it('does not search or send for a disabled queued installation', async () => {
    mocks.installation.mockResolvedValue({ ...installation, enabled: false })
    await run()
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('does not send results if disabled while the search is running', async () => {
    mocks.installation
      .mockResolvedValueOnce(installation)
      .mockResolvedValueOnce({ ...installation, enabled: false })
    await run()
    expect(mocks.search).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('reauthorizes the member before sending results', async () => {
    mocks.authorizeMember.mockRejectedValueOnce(new Error('Membership revoked'))
    await expect(run()).rejects.toThrow('Membership revoked')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('sends a private identity error without executing a search', async () => {
    mocks.sender.mockResolvedValue(null)
    await run()
    expect(mocks.search).not.toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalledWith(
      'bot-token',
      expect.objectContaining({ text: 'Identity required' }),
      expect.any(AbortSignal)
    )
  })
  it('distinguishes quota failures from empty results', async () => {
    mocks.search.mockRejectedValueOnce(
      new KnowledgeUsageLimitExceededError('private billing details')
    )
    await run()
    expect(mocks.send).toHaveBeenCalledWith(
      'bot-token',
      expect.objectContaining({ text: expect.stringContaining('usage limit') }),
      expect.any(AbortSignal)
    )
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain('private billing details')
  })
  it('never retries or sends an error message after an ambiguous Slack send', async () => {
    mocks.send.mockRejectedValueOnce(new Error('socket disconnected after writing'))
    await expect(run()).rejects.toThrow('socket disconnected')
    expect(mocks.search).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.outcome).toHaveBeenCalledWith(installation, 'delivery_failed')
  })
  it('does not resolve an identity or search when rate limited', async () => {
    await respondToSlackSearchMessage.execute({
      principal,
      input: { job, signal: new AbortController().signal, rateLimited: true },
    })
    expect(mocks.sender).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })
  it('ignores the bot itself', async () => {
    await receiveSlackSearchMessage.execute({
      principal,
      input: { ...job.message, userId: 'UBOT' },
    })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('queues only bounded event context without a token or Sim user ID', async () => {
    await receiveSlackSearchMessage.execute({ principal, input: job.message })
    expect(mocks.enqueue).toHaveBeenCalledWith(job)
    expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toContain('bot-token')
    expect(mocks.search).not.toHaveBeenCalled()
  })
})
