/**
 * Fixture-backed Google Calendar API responses; real managed credential authorization,
 * member sync, storage, parsing, PostgreSQL observations and authorized reads.
 * Only provider HTTP and embedding generation are substituted. No live Google Calendar
 * account or application database is used.
 */
import { createHash } from 'node:crypto'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { grantKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

const SHARED_CALENDAR = 'team@group.calendar.google.com'
const UPDATED = '2026-09-01T12:00:00Z'

function event(id: string, summary: string, description: string) {
  const start = new Date(Date.now() + 3_600_000).toISOString()
  const end = new Date(Date.now() + 7_200_000).toISOString()
  return {
    id,
    status: 'confirmed',
    summary,
    description,
    location: 'Private meeting room',
    visibility: 'default',
    htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
    updated: UPDATED,
    created: UPDATED,
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
    organizer: { email: 'organizer@fixture.test', displayName: 'Provider Organizer' },
    attendees: [{ email: 'attendee@fixture.test', displayName: 'Provider Attendee' }],
  }
}

type CalendarEventFixture =
  | ReturnType<typeof event>
  | ReturnType<typeof redactedEvent>
  | { id: string; status: 'cancelled'; recurringEventId?: string }

/** Models only the allowed timing fields of a provider-redacted event, not live captured JSON. */
function redactedEvent(value: ReturnType<typeof event>) {
  return {
    id: value.id,
    status: value.status,
    start: value.start,
    end: value.end,
    updated: value.updated,
    created: value.created,
  }
}

describe('Google Calendar member indexing and authorization in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()
  const groupId = generateId()
  const optionId = generateId()
  const connectorId = generateId()
  const people = [ids.aliceId, ids.bobId].map((userId) => ({
    userId,
    credentialId: generateId(),
    enrollmentId: generateId(),
    accessToken: `fixture-calendar-${generateId()}`,
    refreshToken: `fixture-calendar-refresh-${generateId()}`,
  }))
  const [alice, bob] = people
  const previousClient = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
  const storageKeys = new Set<string>()
  const listing = new Map<string, Map<string, CalendarEventFixture[]>>()
  const failures = new Map<string, Map<string, 401 | 404>>()
  const refreshAttempts: string[] = []
  const requests: {
    token: string
    calendarId: string
    page: string | null
    timeMin: string | null
    timeMax: string | null
  }[] = []
  let readerRole: 'reader' | 'freeBusyReader' = 'reader'
  let privateEvent: ReturnType<typeof event>
  let planningEvent: ReturnType<typeof event>
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  const actor = (userId: string): Principal => ({
    kind: 'session',
    userId,
    sessionId: 'fixture-calendar-member',
  })
  const workspaceKey: Principal = {
    kind: 'workspace_api_key',
    workspaceId: ids.workspaceId,
    keyId: 'fixture-calendar-workspace-key',
  }

  beforeAll(async () => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: 'isolated-calendar-fixture-client',
      GOOGLE_CLIENT_SECRET: 'isolated-calendar-fixture-secret',
    })
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.href === 'https://oauth2.googleapis.com/token') {
        expect(init?.method).toBe('POST')
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('grant_type')).toBe('refresh_token')
        expect(body.get('client_id')).toBe('isolated-calendar-fixture-client')
        const person = people.find((person) => person.refreshToken === body.get('refresh_token'))
        if (!person || failures.get(person.accessToken)?.get('primary') !== 401)
          throw new Error('Unexpected Calendar fixture token refresh')
        refreshAttempts.push(person.userId)
        return Response.json(
          { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
          { status: 400 }
        )
      }
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
      const token = headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
      if (!people.some((person) => person.accessToken === token))
        throw new Error('Unexpected provider token in Calendar fixture')
      const match = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/)
      if (url.origin !== 'https://www.googleapis.com' || !match)
        throw new Error('Unexpected outbound request in Calendar fixture')
      const calendarId = decodeURIComponent(match[1])
      if (!['primary', SHARED_CALENDAR].includes(calendarId))
        throw new Error('Unexpected calendar in fixture')
      expect(init?.method).toBe('GET')
      expect(url.searchParams.get('singleEvents')).toBe('true')
      expect(url.searchParams.get('orderBy')).toBe('startTime')
      expect(url.searchParams.get('maxResults')).toBe('250')
      const page = url.searchParams.get('pageToken')
      const timeMin = url.searchParams.get('timeMin')
      const timeMax = url.searchParams.get('timeMax')
      expect(Date.parse(timeMin!)).toBeLessThan(Date.parse(timeMax!))
      requests.push({ token, calendarId, page, timeMin, timeMax })
      const failure = failures.get(token)?.get(calendarId)
      if (failure)
        return Response.json(
          {
            error: {
              code: failure,
              message: failure === 404 ? 'Not Found' : 'Invalid Credentials',
            },
          },
          { status: failure }
        )
      const visible = listing.get(token)?.get(calendarId) ?? []
      const accessRole =
        calendarId === 'primary' || token === alice.accessToken ? 'owner' : readerRole
      if (page === null && visible.length > 0)
        return Response.json({ kind: 'calendar#events', accessRole, items: [], nextPageToken: '0' })
      const offset = page === null ? 0 : Number(page)
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new Error('Unexpected Calendar fixture continuation')
      const next = offset + 1
      return Response.json({
        kind: 'calendar#events',
        accessRole,
        items: visible.slice(offset, next),
        ...(next < visible.length ? { nextPageToken: String(next) } : {}),
      })
    })
    await seedKnowledgeAclFixture(ids)
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    const policy = await getCredentialGroupProviderAdapter('google-calendar').getPolicy(undefined, {
      workspaceId: ids.workspaceId,
    })
    await db.insert(credentialGroup).values({
      id: groupId,
      workspaceId: ids.workspaceId,
      publicId: generateId(),
      name: 'Calendar fixture accounts',
      createdBy: ids.aliceId,
      options: [
        { ...policy, id: optionId, label: 'Google Calendar', required: false, status: 'active' },
      ],
    })
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    for (const person of people) {
      await db.insert(credentialGroupEnrollment).values({
        id: person.enrollmentId,
        credentialGroupId: groupId,
        email: `${person.userId}@fixture.test`,
        status: 'completed',
        invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
        invitationExpiresAt: new Date(Date.now() + 3_600_000),
        invitedAt: new Date(),
      })
      await db.insert(credential).values({
        id: person.credentialId,
        workspaceId: ids.workspaceId,
        type: 'managed_oauth',
        displayName: 'Calendar fixture',
        providerId: 'google-calendar',
        authorizationAppId: policy.authorizationAppId,
        credentialGroupEnrollmentId: person.enrollmentId,
        credentialGroupOptionId: optionId,
        managedOauthScopeVersion: policy.scopeVersion,
        providerSubjectId: person.userId,
        providerTenantId: null,
        managedOauthStatus: 'active',
        grantedScopes: policy.requiredScopes,
        encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
          accessToken: person.accessToken,
          refreshToken: person.refreshToken,
        }),
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
        grantedAt: new Date(),
        createdBy: person.userId,
      })
    }
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'google_calendar',
      sourceConfig: { calendarId: ['primary', SHARED_CALENDAR] },
      accessMode: 'members',
      credentialGroupId: groupId,
      credentialGroupOptionId: optionId,
      status: 'active',
      memberSyncStatus: 'idle',
      syncIntervalMinutes: 60,
    })
    await grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: groupId,
        credentialGroupOptionId: optionId,
        connectorId,
      },
      ids.aliceId
    )
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
  })

  beforeEach(async () => {
    failures.clear()
    requests.length = 0
    refreshAttempts.length = 0
    readerRole = 'reader'
    privateEvent = {
      ...event('collision', 'Orion confidential renewal', '<p>Confidential renewal terms</p>'),
      visibility: 'private',
    }
    planningEvent = event('planning', 'Orion planning meeting', '<p>Planning roadmap</p>')
    listing.set(
      alice.accessToken,
      new Map([
        ['primary', [event('collision', 'Orion Alice personal event', 'Alice personal notes')]],
        [SHARED_CALENDAR, [privateEvent, planningEvent]],
      ])
    )
    listing.set(
      bob.accessToken,
      new Map([
        ['primary', [event('collision', 'Orion Bob personal event', 'Bob personal notes')]],
        [SHARED_CALENDAR, [redactedEvent(privateEvent), planningEvent]],
      ])
    )
    await db
      .update(knowledgeConnector)
      .set({ sourceConfig: { calendarId: ['primary', SHARED_CALENDAR] } })
      .where(eq(knowledgeConnector.id, connectorId))
    await db
      .update(credential)
      .set({ managedOauthStatus: 'active', accessTokenExpiresAt: new Date(Date.now() + 3_600_000) })
      .where(
        inArray(
          credential.id,
          people.map((person) => person.credentialId)
        )
      )
    const result = await sync()
    expect(result.membersCompleted).toBe(2)
    expect(result.membersFailed).toBe(0)
  })

  afterAll(async () => {
    try {
      await stored()
      for (const key of storageKeys)
        await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        })
    } finally {
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(user).where(
        inArray(
          user.id,
          people.map((person) => person.userId)
        )
      )
      Object.assign(env, {
        GOOGLE_CLIENT_ID: previousClient.id,
        GOOGLE_CLIENT_SECRET: previousClient.secret,
      })
      vi.unstubAllGlobals()
      await db.$client.end()
    }
  })

  async function stored() {
    const rows = await db.select().from(document).where(eq(document.connectorId, connectorId))
    for (const row of rows) if (row.storageKey) storageKeys.add(row.storageKey)
    return rows
  }

  async function sync() {
    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.connectorId, connectorId))
    const result = await executeMemberSync(connectorId, {
      forceContentRefresh: true,
      billingAttribution: billing,
    })
    expect(result.error).toBeUndefined()
    expect(result.skipReason).toBeUndefined()
    expect(result.docsFailed).toBe(0)
    expect(result.membersRemaining).toBe(false)
    await stored()
    return result
  }

  async function member(person: (typeof people)[number]) {
    const [row] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(
        and(
          eq(knowledgeConnectorMember.connectorId, connectorId),
          eq(knowledgeConnectorMember.credentialId, person.credentialId)
        )
      )
    expect(row).toBeDefined()
    return row
  }

  async function assertAccess(person: (typeof people)[number], externalIds: string[]) {
    const identity = await member(person)
    const rows = await stored()
    const expected = rows.filter((row) =>
      externalIds.some((id) => row.externalId === `member:${identity.id}:${id}`)
    )
    expect(expected).toHaveLength(externalIds.length)
    const expectedIds = new Set(expected.map((row) => row.id))
    const search = await searchKnowledge.execute({
      principal: actor(person.userId),
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 100,
      },
    })
    expect(new Set(search.results.map((row) => row.documentId))).toEqual(expectedIds)
    for (const row of rows) {
      const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id }
      if (expectedIds.has(row.id)) {
        expect(
          (await readKnowledgeDocument.execute({ principal: actor(person.userId), input })).document
            .id
        ).toBe(row.id)
        expect(
          (await listKnowledgeChunks.execute({ principal: actor(person.userId), input })).chunks
            .length
        ).toBeGreaterThan(0)
        expect(
          (
            await downloadFileFromUrl(row.fileUrl, {
              userId: person.userId,
              knowledgeAccess: 'user',
            })
          ).length
        ).toBeGreaterThan(0)
      } else {
        await expect(
          readKnowledgeDocument.execute({ principal: actor(person.userId), input })
        ).rejects.toThrow('Document not found')
        await expect(
          listKnowledgeChunks.execute({ principal: actor(person.userId), input })
        ).rejects.toThrow('Document not found')
        await expect(
          downloadFileFromUrl(row.fileUrl, { userId: person.userId, knowledgeAccess: 'user' })
        ).rejects.toThrow('Access denied')
      }
    }
  }

  it('isolates owner and reader projections across two calendars and follows empty pages', async () => {
    const rows = await stored()
    expect(rows).toHaveLength(6)
    const expected = [
      'primary:collision',
      `${SHARED_CALENDAR}:collision`,
      `${SHARED_CALENDAR}:planning`,
    ]
    await assertAccess(alice, expected)
    await assertAccess(bob, expected)
    for (const person of people) {
      const pages = requests.filter((request) => request.token === person.accessToken)
      expect(pages.map(({ calendarId, page }) => [calendarId, page])).toEqual([
        ['primary', null],
        ['primary', '0'],
        [SHARED_CALENDAR, null],
        [SHARED_CALENDAR, '0'],
        [SHARED_CALENDAR, '1'],
      ])
      expect(new Set(pages.map(({ timeMin, timeMax }) => `${timeMin}:${timeMax}`)).size).toBe(1)
    }
    const observations = await db
      .select()
      .from(knowledgeDocumentObservation)
      .where(
        inArray(
          knowledgeDocumentObservation.documentId,
          rows.map((row) => row.id)
        )
      )
    expect(observations).toHaveLength(6)
    for (const row of rows) {
      const evidence = observations.filter((observation) => observation.documentId === row.id)
      expect(evidence).toHaveLength(1)
      expect(row.externalId).toContain(`member:${evidence[0].memberId}:`)
      expect(row.processingStatus).toBe('completed')
    }
    const own = await content(alice, `${SHARED_CALENDAR}:collision`)
    expect(own).toContain('Confidential renewal terms')
    expect(own).not.toContain('<p>')
    const reader = await content(bob, `${SHARED_CALENDAR}:collision`)
    for (const hidden of [
      'Confidential renewal',
      'confidential renewal',
      'organizer@fixture.test',
      'Provider Attendee',
      'Private meeting room',
    ])
      expect(reader).not.toContain(hidden)
    expect(reader).toContain('Date:')
    expect(await content(alice, 'primary:collision')).not.toContain('Bob personal notes')
    expect(await content(bob, 'primary:collision')).not.toContain('Alice personal notes')
    const search = await searchKnowledge.execute({
      principal: workspaceKey,
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 100,
      },
    })
    expect(search.results).toEqual([])
    for (const row of rows) {
      const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id }
      await expect(
        readKnowledgeDocument.execute({ principal: workspaceKey, input })
      ).rejects.toThrow('Document not found')
      await expect(listKnowledgeChunks.execute({ principal: workspaceKey, input })).rejects.toThrow(
        'Document not found'
      )
    }
  })

  async function rowFor(person: (typeof people)[number], externalId: string) {
    const identity = await member(person)
    const row = (await stored()).find(
      (row) => row.externalId === `member:${identity.id}:${externalId}`
    )
    expect(row).toBeDefined()
    return row!
  }

  async function content(person: (typeof people)[number], externalId: string) {
    const row = await rowFor(person, externalId)
    const chunks = await listKnowledgeChunks.execute({
      principal: actor(person.userId),
      input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id },
    })
    return chunks.chunks.map((chunk) => chunk.content).join('\n')
  }

  it('replaces a reader projection with provider-redacted free/busy data without an event update', async () => {
    const previous = await rowFor(bob, `${SHARED_CALENDAR}:planning`)
    readerRole = 'freeBusyReader'
    listing
      .get(bob.accessToken)!
      .set(SHARED_CALENDAR, [
        listing.get(bob.accessToken)!.get(SHARED_CALENDAR)![0],
        redactedEvent(planningEvent),
      ])
    await sync()
    const current = await rowFor(bob, `${SHARED_CALENDAR}:planning`)
    expect(current.id).toBe(previous.id)
    expect(current.contentHash).not.toBe(previous.contentHash)
    const redacted = await content(bob, `${SHARED_CALENDAR}:planning`)
    expect(redacted).not.toContain('Planning roadmap')
    expect(redacted).not.toContain('Provider Organizer')
    expect(redacted).not.toContain('Private meeting room')
    expect(redacted).toContain('Date:')
    expect(await content(alice, `${SHARED_CALENDAR}:planning`)).toContain('Planning roadmap')
  })

  it('updates content and removes deleted events and cancelled recurring instances', async () => {
    const cancelled: CalendarEventFixture = {
      id: 'planning',
      status: 'cancelled',
      recurringEventId: 'series',
    }
    listing.get(alice.accessToken)!.set('primary', [])
    listing.get(alice.accessToken)!.set(SHARED_CALENDAR, [
      {
        ...privateEvent,
        description: 'Updated confidential renewal',
        updated: '2026-09-02T12:00:00Z',
      },
      cancelled,
    ])
    listing
      .get(bob.accessToken)!
      .set(SHARED_CALENDAR, [listing.get(bob.accessToken)!.get(SHARED_CALENDAR)![0], cancelled])
    await sync()
    await assertAccess(alice, [`${SHARED_CALENDAR}:collision`])
    await assertAccess(bob, ['primary:collision', `${SHARED_CALENDAR}:collision`])
    expect(await content(alice, `${SHARED_CALENDAR}:collision`)).toContain(
      'Updated confidential renewal'
    )
    const rows = await stored()
    const observations = await db
      .select()
      .from(knowledgeDocumentObservation)
      .where(
        inArray(
          knowledgeDocumentObservation.documentId,
          rows.map((row) => row.id)
        )
      )
    expect(observations).toHaveLength(3)
  })

  it('withdraws a lost shared calendar while preserving the member primary calendar', async () => {
    failures.set(bob.accessToken, new Map([[SHARED_CALENDAR, 404]]))
    const result = await sync()
    expect(result.membersFailed).toBe(0)
    await assertAccess(bob, ['primary:collision'])
    await assertAccess(alice, [
      'primary:collision',
      `${SHARED_CALENDAR}:collision`,
      `${SHARED_CALENDAR}:planning`,
    ])
    const identity = await member(bob)
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, identity.id))
    ).toHaveLength(1)
  })

  it('removes organizer and attendee identifiers when the source disables them', async () => {
    await db
      .update(knowledgeConnector)
      .set({
        sourceConfig: { calendarId: ['primary', SHARED_CALENDAR], includeAttendees: 'false' },
      })
      .where(eq(knowledgeConnector.id, connectorId))
    await sync()
    const text = await content(alice, `${SHARED_CALENDAR}:collision`)
    expect(text).toContain('Attendees: 1')
    expect(text).not.toContain('organizer@fixture.test')
    expect(text).not.toContain('Provider Organizer')
    expect(text).not.toContain('Provider Attendee')
    expect(text).toContain('Confidential renewal terms')
  })

  it('marks rejected OAuth credentials for reconnect and hides only the affected member', async () => {
    failures.set(bob.accessToken, new Map([['primary', 401]]))
    const result = await sync()
    expect(result.membersFailed).toBe(1)
    expect(refreshAttempts).toEqual([bob.userId])
    const [saved] = await db.select().from(credential).where(eq(credential.id, bob.credentialId))
    expect(saved.managedOauthStatus).toBe('needs_reauth')
    await assertAccess(bob, [])
    await assertAccess(alice, [
      'primary:collision',
      `${SHARED_CALENDAR}:collision`,
      `${SHARED_CALENDAR}:planning`,
    ])
    expect(
      await db
        .select()
        .from(document)
        .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))
    ).toHaveLength(6)
  })
})
