/** Exercises real PostgreSQL locks and constraints using only isolated, explicitly cleaned fixtures. */
import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotChats,
  credential,
  organization,
  outboxEvent,
  slackSearchInstallation,
  slackSearchTurn,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const title = vi.hoisted(() => ({ request: vi.fn() }))
const mention = vi.hoisted(() => ({ authorize: vi.fn(), open: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/authorization', () => ({
  authorizeSlackSearchInstallation: mention.authorize,
}))
vi.mock('@/lib/internal/slack/client', () => ({
  openSlackDm: mention.open,
  postSlackMessage: mention.post,
  slackString: (value: Record<string, unknown>, key: string) =>
    typeof value[key] === 'string' ? value[key] : undefined,
}))
vi.mock('@/lib/copilot/request/lifecycle/start', () => ({ requestChatTitle: title.request }))

vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: async (principal: {
    organizationId: string
    subjectUserId: string
  }) => ({ organizationId: principal.organizationId, userId: principal.subjectUserId }),
}))

import { resolveSlackSearchChat } from '@/lib/knowledge/application/slack-search/chat'
import { routeSlackSearchMentionToDm } from '@/lib/knowledge/application/slack-search/mention'
import { generateSlackSearchChatTitle } from '@/lib/knowledge/application/slack-search/title'
import {
  claimSlackSearchTurn,
  finishSlackSearchTurn,
  persistSlackSearchTurn,
  requireSlackSearchTurnLease,
  slackSearchTurnOutboxId,
} from '@/lib/knowledge/application/slack-search/turns'
import {
  slackSearchConversation,
  slackSearchConversationKey,
} from '@/lib/slack-search/conversation'
import type { SlackSearchJob } from '@/lib/slack-search/types'

describe('durable Slack Search turns in PostgreSQL', () => {
  const organizationId = generateId()
  const userId = generateId()
  const otherUserId = generateId()
  const credentialId = generateId()
  const installationId = generateId()
  const teamId = `T${generateId()}`
  const appId = `A${generateId()}`

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [userId, otherUserId].map((id) => ({
        id,
        name: 'Slack queue fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Slack queue fixture', slug: organizationId })
    await db.insert(credential).values({
      id: credentialId,
      organizationId,
      type: 'service_account',
      providerId: 'slack',
      displayName: 'Slack queue fixture',
      createdBy: userId,
      encryptedServiceAccountKey: 'fixture-only',
    })
    await db.insert(slackSearchInstallation).values({
      id: installationId,
      organizationId,
      credentialId,
      appId,
      teamId,
      teamName: 'Fixture',
      botUserId: 'UBOT',
      enabled: true,
      revision: 'revision',
      credentialVersion: 'version',
    })
  })

  afterEach(async () => {
    const turns = await db
      .select({ id: slackSearchTurn.id })
      .from(slackSearchTurn)
      .where(eq(slackSearchTurn.installationId, installationId))
    if (turns.length)
      await db.delete(outboxEvent).where(
        inArray(
          outboxEvent.id,
          turns.map(({ id }) => slackSearchTurnOutboxId(id))
        )
      )
    await db.delete(slackSearchTurn).where(eq(slackSearchTurn.installationId, installationId))
    await db.delete(copilotChats).where(eq(copilotChats.organizationId, organizationId))
    await db
      .update(slackSearchInstallation)
      .set({ enabled: true, revision: 'revision' })
      .where(eq(slackSearchInstallation.id, installationId))
  })

  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, [userId, otherUserId]))
    await db.$client.end()
  })

  function job(threadTs = '1000.000001', messageTs = '1000.000002'): SlackSearchJob {
    return {
      installationId,
      credentialId,
      revision: 'revision',
      credentialVersion: 'version',
      receivedAt: Date.now(),
      message: {
        appId,
        teamId,
        eventId: generateId(),
        userId: 'UOWNER',
        channelId: 'DFIXTURE',
        threadTs,
        messageTs,
        query: 'Find the fixture',
        queryTooLong: false,
      },
    }
  }

  it('moves a channel mention to a private DM once and reuses its history for queued follow-ups', async () => {
    const input = job()
    input.message = {
      ...input.message,
      channelId: 'CMENTION',
      threadTs: undefined,
      origin: {
        channelId: 'CMENTION',
        threadTs: '1000.000001',
        messageTs: input.message.messageTs,
      },
    }
    const turnId = await persistSlackSearchTurn(input)
    const claim = await claimSlackSearchTurn(turnId)
    if (!claim) throw new Error('Expected a mention claim')
    mention.authorize.mockResolvedValue({
      secret: { botToken: 'fixture-token' },
    })
    mention.open.mockResolvedValue('DFIXTURE')
    mention.post.mockResolvedValue({
      status: 200,
      data: { ok: true, channel: 'DFIXTURE', ts: '2000.000001' },
    })
    const authority = {
      kind: 'slack_installation' as const,
      credentialId,
      credentialVersion: 'version',
      appId,
      teamId,
      eventId: input.message.eventId,
      receivedAt: new Date(input.receivedAt),
    }
    const routed = await routeSlackSearchMentionToDm(authority, {
      job: claim.job,
      turnId,
      leaseId: claim.leaseId,
      signal: new AbortController().signal,
    })
    expect(routed.message).toMatchObject({
      channelId: 'DFIXTURE',
      threadTs: '2000.000001',
      origin: input.message.origin,
    })
    expect(mention.post).toHaveBeenCalledWith(
      'fixture-token',
      expect.objectContaining({ channel: 'DFIXTURE' }),
      expect.any(AbortSignal)
    )
    expect(await persistSlackSearchTurn(input)).toBe(turnId)
    expect(mention.post).toHaveBeenCalledOnce()
    const chat = await resolveSlackSearchChat(principal(routed), routed)
    expect(chat.externalConversationMetadata).toMatchObject({
      origin: input.message.origin,
      channelId: 'DFIXTURE',
      threadTs: '2000.000001',
    })
    const followup = job('2000.000001', '2000.000002')
    const next = await persistSlackSearchTurn(followup)
    expect(await claimSlackSearchTurn(next)).toBeNull()
    await finishSlackSearchTurn(turnId, claim.leaseId, 'completed', 'answered')
    expect(await claimSlackSearchTurn(next)).not.toBeNull()
    expect((await resolveSlackSearchChat(principal(followup), followup)).id).toBe(chat.id)
    await expect(
      persistSlackSearchTurn({ ...input, message: { ...input.message, userId: 'UOTHER' } })
    ).rejects.toThrow('identity changed')
  })

  it('does not replay a mention after an ambiguous private-message send', async () => {
    const input = job()
    input.message = {
      ...input.message,
      channelId: 'GMENTION',
      threadTs: undefined,
      origin: {
        channelId: 'GMENTION',
        threadTs: input.message.messageTs,
        messageTs: input.message.messageTs,
      },
    }
    const turnId = await persistSlackSearchTurn(input)
    const claim = await claimSlackSearchTurn(turnId)
    if (!claim) throw new Error('Expected a mention claim')
    mention.authorize.mockResolvedValue({
      secret: { botToken: 'fixture-token' },
    })
    mention.open.mockResolvedValue('DFIXTURE')
    mention.post.mockRejectedValueOnce(new Error('Connection closed after send'))
    await expect(
      routeSlackSearchMentionToDm(
        {
          kind: 'slack_installation',
          credentialId,
          credentialVersion: 'version',
          appId,
          teamId,
          eventId: input.message.eventId,
          receivedAt: new Date(input.receivedAt),
        },
        { job: claim.job, turnId, leaseId: claim.leaseId, signal: new AbortController().signal }
      )
    ).rejects.toThrow('Connection closed')
    await finishSlackSearchTurn(turnId, claim.leaseId, 'failed', 'delivery_failed')
    expect(await persistSlackSearchTurn(input)).toBe(turnId)
    expect(await claimSlackSearchTurn(turnId)).toBeNull()
  })

  function principal(
    input: SlackSearchJob,
    subjectUserId = userId
  ): Extract<OrganizationDelegatedPrincipal, { serviceId: 'slack-search' }> {
    return {
      kind: 'organization_delegated' as const,
      serviceId: 'slack-search',
      organizationId,
      subjectUserId,
      delegationId: generateId(),
      audience: 'sim:knowledge',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      resourceScope: { installationId, eventId: input.message.eventId },
    }
  }

  it('deduplicates simultaneous deliveries and commits exactly one outbox event', async () => {
    const input = job()
    const ids = await Promise.all(Array.from({ length: 8 }, () => persistSlackSearchTurn(input)))
    expect(new Set(ids).size).toBe(1)
    const events = await db
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, slackSearchTurnOutboxId(ids[0])))
    expect(events).toHaveLength(1)
  })

  it('atomically binds a browser retry to its authenticated Sim user', async () => {
    const input = job()
    await persistSlackSearchTurn(input, userId)
    const chat = await resolveSlackSearchChat(principal(input), input)
    expect(chat.userId).toBe(userId)
    await expect(persistSlackSearchTurn(job(), otherUserId)).rejects.toThrow('another Sim account')
    await expect(resolveSlackSearchChat(principal(input, otherUserId), input)).rejects.toThrow(
      'another Sim account'
    )
  })

  it('does not create private history before a sender is authorized', async () => {
    await persistSlackSearchTurn(job())
    expect(
      await db.select().from(copilotChats).where(eq(copilotChats.organizationId, organizationId))
    ).toHaveLength(0)
  })

  it('rejects a replay whose sender differs from the original event', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    await expect(
      persistSlackSearchTurn({ ...input, message: { ...input.message, userId: 'UOTHER' } })
    ).rejects.toThrow('another sender')
  })

  it('rejects reuse of an event ID for a different conversation', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    await expect(
      persistSlackSearchTurn({ ...input, message: { ...input.message, channelId: 'DOTHER' } })
    ).rejects.toThrow('event conversation changed')
  })

  it('creates one chat across concurrent resolvers and isolates matching timestamps in different channels', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    const chats = await Promise.all(
      Array.from({ length: 8 }, () => resolveSlackSearchChat(principal(input), input))
    )
    expect(new Set(chats.map(({ id }) => id)).size).toBe(1)
    const other = job()
    other.message.channelId = 'DOTHER'
    await persistSlackSearchTurn(other)
    expect((await resolveSlackSearchChat(principal(other), other)).id).not.toBe(chats[0].id)
  })

  it('rejects authority delegated for another event or installation', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    await expect(resolveSlackSearchChat(principal(job()), input)).rejects.toThrow(
      'authority is required'
    )
    await expect(
      resolveSlackSearchChat(
        {
          ...principal(input),
          resourceScope: { installationId: 'other', eventId: input.message.eventId },
        },
        input
      )
    ).rejects.toThrow('authority is required')
  })

  it('names a Slack chat from its first question through the normal title backend', async () => {
    const original = job()
    await persistSlackSearchTurn(original)
    const followUp = job()
    followUp.message.query = 'Follow-up question'
    await persistSlackSearchTurn(followUp)
    const chat = await resolveSlackSearchChat(principal(followUp), followUp)
    title.request.mockReset().mockResolvedValue('Find fixture documents')
    const beforePersist = vi.fn(async () => {})
    await generateSlackSearchChatTitle(principal(followUp), {
      job: followUp,
      signal: new AbortController().signal,
      beforePersist,
    })
    expect(title.request).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: chat.id,
        userId,
        organizationId,
        model: chat.model,
        message: original.message.query,
        signal: expect.any(AbortSignal),
      })
    )
    expect(beforePersist).toHaveBeenCalledOnce()
    expect((await resolveSlackSearchChat(principal(followUp), followUp)).title).toBe(
      'Find fixture documents (Slack)'
    )
    await generateSlackSearchChatTitle(principal(followUp), {
      job: followUp,
      signal: new AbortController().signal,
      beforePersist,
    })
    expect(title.request).toHaveBeenCalledOnce()
  })

  it('upgrades the legacy default title without duplicating the Slack suffix', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    const chat = await resolveSlackSearchChat(principal(input), input)
    await db.update(copilotChats).set({ title: 'Slack Search' }).where(eq(copilotChats.id, chat.id))
    title.request.mockReset().mockResolvedValue('Find fixture documents (Slack)')
    await generateSlackSearchChatTitle(principal(input), {
      job: input,
      signal: new AbortController().signal,
      beforePersist: async () => {},
    })
    expect((await resolveSlackSearchChat(principal(input), input)).title).toBe(
      'Find fixture documents (Slack)'
    )
  })

  it('does not overwrite a manual rename while title generation is in flight', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    const chat = await resolveSlackSearchChat(principal(input), input)
    title.request.mockReset().mockImplementationOnce(async () => {
      await db
        .update(copilotChats)
        .set({ title: 'My chosen title' })
        .where(eq(copilotChats.id, chat.id))
      return 'Generated title'
    })
    const titleInput = {
      job: input,
      signal: new AbortController().signal,
      beforePersist: async () => {},
    }
    await generateSlackSearchChatTitle(principal(input), titleInput)
    expect((await resolveSlackSearchChat(principal(input), input)).title).toBe('My chosen title')
    await generateSlackSearchChatTitle(principal(input), titleInput)
    expect(title.request).toHaveBeenCalledOnce()
  })

  it('does not save a title when access is revoked during generation', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    const chat = await resolveSlackSearchChat(principal(input), input)
    title.request.mockReset().mockResolvedValue('Generated title')
    await expect(
      generateSlackSearchChatTitle(principal(input), {
        job: input,
        signal: new AbortController().signal,
        beforePersist: async () => {
          throw new Error('membership revoked')
        },
      })
    ).rejects.toThrow('membership revoked')
    expect((await resolveSlackSearchChat(principal(input), input)).title).toBeNull()
  })

  it('claims a turn once across competing workers and processes follow-ups FIFO', async () => {
    const first = await persistSlackSearchTurn(job())
    const second = await persistSlackSearchTurn(job())
    expect(await claimSlackSearchTurn(second)).toBeNull()
    const claims = (
      await Promise.all(Array.from({ length: 8 }, () => claimSlackSearchTurn(first)))
    ).filter((value) => value !== null)
    expect(claims).toHaveLength(1)
    expect(await claimSlackSearchTurn(second)).toBeNull()
    await finishSlackSearchTurn(first, claims[0].leaseId, 'completed', 'answered')
    expect(await claimSlackSearchTurn(second)).not.toBeNull()
  })

  it('allows only two running threads across concurrent workers', async () => {
    const ids = await Promise.all(
      ['1000.1', '1000.2', '1000.3'].map((ts) => persistSlackSearchTurn(job(ts)))
    )
    const claims = await Promise.all(ids.map(claimSlackSearchTurn))
    expect(claims.filter(Boolean)).toHaveLength(2)
  })

  it('limits each thread to twenty pending questions', async () => {
    await Promise.all(Array.from({ length: 20 }, () => persistSlackSearchTurn(job())))
    await expect(persistSlackSearchTurn(job())).rejects.toThrow('twenty queued')
  })

  it('never replays an expired execution and invalidates its old lease', async () => {
    const first = await persistSlackSearchTurn(job())
    const claim = await claimSlackSearchTurn(first)
    if (!claim) throw new Error('Fixture was not claimed')
    await db
      .update(slackSearchTurn)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(slackSearchTurn.id, first))
    await expect(requireSlackSearchTurnLease(first, claim.leaseId)).rejects.toThrow(
      'no longer active'
    )
    expect(await claimSlackSearchTurn(first)).toBeNull()
    const [expired] = await db.select().from(slackSearchTurn).where(eq(slackSearchTurn.id, first))
    expect(expired).toMatchObject({ status: 'failed', outcome: 'worker_expired' })
    expect(await claimSlackSearchTurn(await persistSlackSearchTurn(job()))).not.toBeNull()
  })

  it('rejects changed installations and a different sender in the same thread', async () => {
    await persistSlackSearchTurn(job())
    const differentSender = job()
    differentSender.message.userId = 'UOTHER'
    await expect(persistSlackSearchTurn(differentSender)).rejects.toThrow('another sender')
    await db
      .update(slackSearchInstallation)
      .set({ revision: 'rotated' })
      .where(eq(slackSearchInstallation.id, installationId))
    await expect(persistSlackSearchTurn(job())).rejects.toThrow('binding changed')
  })

  it('cancels delayed pre-Stop deliveries while accepting messages sent afterward', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    const chat = await resolveSlackSearchChat(principal(input), input)
    await db
      .update(copilotChats)
      .set({
        externalConversationMetadata: {
          ...slackSearchConversation(input),
          lastStopTs: '1000.000005',
        },
      })
      .where(eq(copilotChats.id, chat.id))
    const delayed = await persistSlackSearchTurn(job('1000.000001', '1000.000004'))
    const later = await persistSlackSearchTurn(job('1000.000001', '1000.000006'))
    const turns = await db
      .select()
      .from(slackSearchTurn)
      .where(inArray(slackSearchTurn.id, [delayed, later]))
    expect(turns.find(({ id }) => id === delayed)?.status).toBe('cancelled')
    expect(turns.find(({ id }) => id === later)?.status).toBe('pending')
  })

  it('preserves the original DM timestamp and binds one private Sim conversation', async () => {
    const input = job()
    input.message.threadTs = undefined
    await persistSlackSearchTurn(input)
    const chat = await resolveSlackSearchChat(principal(input), input)
    expect(await resolveSlackSearchChat(principal(input), input)).toMatchObject({ id: chat.id })
    expect(chat).toMatchObject({ userId, organizationId, type: 'mothership', workspaceId: null })
    expect(chat.externalConversationKey).toBe(
      slackSearchConversationKey(installationId, input.message.channelId, input.message.messageTs)
    )
    expect(chat.externalConversationMetadata).toMatchObject({
      threadTs: input.message.messageTs,
      slackUserId: 'UOWNER',
    })
    await expect(resolveSlackSearchChat(principal(input, otherUserId), input)).rejects.toThrow(
      'another Sim account'
    )
  })

  it('does not reopen a deleted private chat or one whose organization changed', async () => {
    const input = job()
    await persistSlackSearchTurn(input)
    const chat = await resolveSlackSearchChat(principal(input), input)
    await db.update(copilotChats).set({ organizationId: null }).where(eq(copilotChats.id, chat.id))
    await expect(resolveSlackSearchChat(principal(input), input)).rejects.toThrow(
      'no longer available'
    )
    await db
      .update(copilotChats)
      .set({ organizationId, deletedAt: new Date() })
      .where(eq(copilotChats.id, chat.id))
    await expect(resolveSlackSearchChat(principal(input), input)).rejects.toThrow(
      'no longer available'
    )
  })
})
