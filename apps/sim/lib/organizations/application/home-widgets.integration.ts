/**
 * The Home widgets' real authorization and persistence boundary: only the acting member's own grant
 * ever reaches a provider, gates hold on the server, and a refused token changes stored state. Only
 * the provider's network is replaced.
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  organizationSearchIntegration,
  resourcePolicy,
  user,
} from '@sim/db/schema'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import * as providerTransport from '@/lib/core/security/input-validation.server'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import * as knowledgeAvailability from '@/lib/knowledge/access/availability'
import {
  readOrganizationHomeCalendar,
  readOrganizationHomeEmail,
} from '@/lib/organizations/application/home-widgets'
import { HOME_EMAIL_THREAD_LIMIT } from '@/lib/organizations/home/limits'
import { GET as getCalendarRoute } from '@/app/api/organizations/[id]/home/calendar/route'
import { GET as getEmailRoute } from '@/app/api/organizations/[id]/home/email/route'

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/connectors/gmail/mailbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/connectors/gmail/mailbox')>()),
  getGmailMailboxEmail: async () => 'reader@example.com',
}))

vi.hoisted(() => {
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: 'home-google-fixture-client',
    GOOGLE_CLIENT_SECRET: 'home-google-fixture-secret',
    MICROSOFT_CLIENT_ID: 'home-microsoft-fixture-client',
    MICROSOFT_CLIENT_SECRET: 'home-microsoft-fixture-secret',
  })
})

const organizationId = generateId()
const otherOrganizationId = generateId()
const memberId = generateId()
const colleagueId = generateId()
const outsiderId = generateId()
const groupId = generateId()
const memberGmail = `member-gmail-${generateId()}`
const memberCalendar = `member-calendar-${generateId()}`
const memberOutlook = `member-outlook-${generateId()}`
const colleagueGmail = `colleague-gmail-${generateId()}`

const session = (userId: string): SessionPrincipal => ({
  kind: 'session',
  userId,
  sessionId: generateId(),
})
const input = { organizationId }
const day = { organizationId, date: '2026-11-05', timeZone: 'America/Los_Angeles' }

function providerResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body)
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers() as never,
    body: null,
    text: async () => text,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  }
}

const provider = vi.spyOn(providerTransport, 'secureFetchWithValidation')

/** A Gmail, Calendar and Graph stand-in that records the token behind each request. */
function serveProviders(overrides: { status?: number } = {}) {
  const tokens: string[] = []
  provider.mockImplementation(async (url, options) => {
    tokens.push(String(options.headers?.Authorization))
    if (overrides.status) return providerResponse({ error: 'provider text' }, overrides.status)
    if (url.includes('gmail.googleapis.com') && url.includes('/threads?'))
      return providerResponse({
        threads: Array.from({ length: 40 }, (_, index) => ({ id: `thread-${index}` })),
      })
    if (url.includes('gmail.googleapis.com'))
      return providerResponse({
        id: 'thread',
        messages: [
          {
            id: 'message',
            snippet: 'Preview',
            payload: {
              headers: [
                { name: 'From', value: 'Ada <ada@example.com>' },
                { name: 'Subject', value: 'Engines' },
                { name: 'Date', value: 'Thu, 5 Nov 2026 10:00:00 +0000' },
              ],
            },
          },
        ],
      })
    if (url.includes('www.googleapis.com/calendar'))
      return providerResponse({
        items: [
          {
            id: 'event',
            status: 'confirmed',
            summary: 'Review',
            htmlLink: 'https://calendar.google.com/event?eid=1',
            start: { dateTime: '2026-11-05T17:00:00Z' },
            end: { dateTime: '2026-11-05T17:30:00Z' },
          },
        ],
      })
    if (url.includes('/me/mailFolders/inbox/messages'))
      return providerResponse({
        value: [
          {
            id: 'outlook-message',
            subject: 'Budget',
            bodyPreview: 'Preview',
            from: { emailAddress: { name: 'Grace', address: 'grace@example.com' } },
            receivedDateTime: '2026-11-05T09:00:00Z',
          },
        ],
      })
    return providerResponse({ value: [] })
  })
  return tokens
}

function setStatus(credentialId: string, managedOauthStatus: 'active' | 'needs_reauth') {
  return db.update(credential).set({ managedOauthStatus }).where(eq(credential.id, credentialId))
}

function setApproval(connectorType: string, approved: boolean) {
  return db
    .update(organizationSearchIntegration)
    .set({ approved })
    .where(
      and(
        eq(organizationSearchIntegration.organizationId, organizationId),
        eq(organizationSearchIntegration.connectorType, connectorType)
      )
    )
}

beforeAll(async () => {
  const policies = {
    gmail: await getCredentialGroupProviderAdapter('gmail').getPolicy(undefined, {}),
    'google-calendar': await getCredentialGroupProviderAdapter('google-calendar').getPolicy(
      undefined,
      {}
    ),
    outlook: await getCredentialGroupProviderAdapter('outlook').getPolicy(undefined, {}),
  }
  const people = [memberId, colleagueId, outsiderId]
  await db.insert(user).values(
    people.map((id) => ({
      id,
      email: `${id}@example.test`,
      name: 'Home fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values(
    [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: 'Home fixture',
      slug: id,
      createdAt: new Date(),
    }))
  )
  await db.insert(member).values([
    { id: generateId(), userId: memberId, organizationId, role: 'member' },
    { id: generateId(), userId: colleagueId, organizationId, role: 'member' },
    {
      id: generateId(),
      userId: outsiderId,
      organizationId: otherOrganizationId,
      role: 'member',
    },
  ])
  await db.insert(credentialGroup).values({
    id: groupId,
    organizationId,
    publicId: generateId(),
    name: 'Connected accounts',
    options: (['gmail', 'google-calendar', 'outlook'] as const).map((provider) => ({
      id: provider,
      provider,
      label: provider,
      authorizationAppId: policies[provider].authorizationAppId,
      requiredScopes: policies[provider].requiredScopes,
      scopeVersion: policies[provider].scopeVersion,
      required: false,
      status: 'active' as const,
    })),
  })
  await db.insert(resourcePolicy).values({
    id: generateId(),
    organizationId,
    resourceType: 'credential_group',
    resourceId: groupId,
    document: { version: 2, resource: { type: 'credential_group', id: groupId }, statements: [] },
  })
  await db.insert(organizationSearchIntegration).values(
    ['gmail', 'google_calendar'].map((connectorType) => ({
      organizationId,
      connectorType,
      approved: true,
    }))
  )
  const enrollments = new Map(people.map((id) => [id, generateId()]))
  await db.insert(credentialGroupEnrollment).values(
    [memberId, colleagueId].map((userId) => ({
      id: enrollments.get(userId) as string,
      userId,
      credentialGroupId: groupId,
      email: `${userId}@example.test`,
      status: 'completed' as const,
      invitationTokenHash: generateId().replaceAll('-', '').repeat(2),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: new Date(),
    }))
  )
  const grants = [
    { id: memberGmail, userId: memberId, option: 'gmail', providerId: 'google-email' },
    {
      id: memberCalendar,
      userId: memberId,
      option: 'google-calendar',
      providerId: 'google-calendar',
    },
    { id: memberOutlook, userId: memberId, option: 'outlook', providerId: 'outlook' },
    { id: colleagueGmail, userId: colleagueId, option: 'gmail', providerId: 'google-email' },
  ] as const
  for (const grant of grants) {
    const policy = policies[grant.option]
    await db.insert(credential).values({
      id: grant.id,
      createdBy: grant.userId,
      credentialGroupEnrollmentId: enrollments.get(grant.userId),
      credentialGroupOptionId: grant.option,
      organizationId,
      type: 'managed_oauth',
      displayName: `${grant.id}@example.test`,
      providerId: grant.providerId,
      managedOauthStatus: 'active',
      managedOauthScopeVersion: policy.scopeVersion,
      grantedScopes: policy.requiredScopes,
      providerSubjectId: grant.id,
      authorizationAppId: policy.authorizationAppId,
      encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
        accessToken: `token-for-${grant.id}`,
      }),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      grantedAt: new Date(),
    })
  }
})

beforeEach(async () => {
  await db
    .update(credential)
    .set({ managedOauthStatus: 'active' })
    .where(inArray(credential.id, [memberGmail, memberCalendar, memberOutlook, colleagueGmail]))
  await db
    .update(organizationSearchIntegration)
    .set({ approved: true })
    .where(eq(organizationSearchIntegration.organizationId, organizationId))
})

afterEach(() => {
  provider.mockReset()
})

afterAll(async () => {
  await db
    .delete(organization)
    .where(inArray(organization.id, [organizationId, otherOrganizationId]))
  await db.delete(user).where(inArray(user.id, [memberId, colleagueId, outsiderId]))
  provider.mockRestore()
})

describe('whose mail a widget reads', () => {
  it('sends only the acting member’s token and lists only their accounts', async () => {
    const tokens = serveProviders()
    const email = await readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    expect(email.accounts.map((account) => account.credentialId).sort()).toEqual(
      [memberGmail, memberOutlook].sort()
    )
    expect(new Set(tokens)).toEqual(
      new Set([`Bearer token-for-${memberGmail}`, `Bearer token-for-${memberOutlook}`])
    )
  })

  it('gives a colleague their own account, not the first member’s', async () => {
    const tokens = serveProviders()
    const email = await readOrganizationHomeEmail.execute({
      principal: session(colleagueId),
      input,
    })
    expect(email.accounts.map((account) => account.credentialId)).toEqual([colleagueGmail])
    expect(new Set(tokens)).toEqual(new Set([`Bearer token-for-${colleagueGmail}`]))
  })

  it('refuses someone outside the organization before any provider is asked', async () => {
    serveProviders()
    await expect(
      readOrganizationHomeEmail.execute({ principal: session(outsiderId), input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('refuses a principal that is not a session, so no key or delegated run can read mail', async () => {
    serveProviders()
    await expect(
      readOrganizationHomeEmail.execute({
        principal: { kind: 'personal_api_key', userId: memberId, keyId: generateId() },
        input,
      })
    ).rejects.toBeInstanceOf(PrincipalKindAuthorizationError)
    expect(provider).not.toHaveBeenCalled()
  })
})

describe('what a widget reports', () => {
  it('refuses a member with no integrations surface, before any provider', async () => {
    serveProviders()
    const memberScoped = vi.spyOn(knowledgeAvailability, 'isKnowledgeMemberAccessAvailable')
    memberScoped.mockResolvedValueOnce(false)
    await expect(
      readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(provider).not.toHaveBeenCalled()
    memberScoped.mockRestore()
  })

  it('settles both reads on reconnect when they race a token the provider refuses', async () => {
    provider.mockImplementation(async () => providerResponse({ error: 'provider text' }, 401))
    const [email, calendar] = await Promise.all([
      readOrganizationHomeEmail.execute({ principal: session(memberId), input }),
      readOrganizationHomeCalendar.execute({ principal: session(memberId), input: day }),
    ])
    const outlook = (accounts: { credentialId: string; state: string }[]) =>
      accounts.find((account) => account.credentialId === memberOutlook)?.state
    expect(outlook(email.accounts)).toBe('needs_reauth')
    expect(outlook(calendar.accounts)).toBe('needs_reauth')
  })

  it('reports a connection awaiting reconnection without asking its provider', async () => {
    const tokens = serveProviders()
    await setStatus(memberGmail, 'needs_reauth')
    const email = await readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    expect(email.accounts.find((a) => a.credentialId === memberGmail)?.state).toBe('needs_reauth')
    expect(tokens).not.toContain(`Bearer token-for-${memberGmail}`)
  })

  it('records a token the provider refuses, so the next read asks to reconnect', async () => {
    serveProviders({ status: 401 })
    const email = await readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    expect(email.accounts.find((a) => a.credentialId === memberGmail)?.state).toBe('needs_reauth')
    const [stored] = await db
      .select({ status: credential.managedOauthStatus })
      .from(credential)
      .where(eq(credential.id, memberGmail))
    expect(stored.status).toBe('needs_reauth')
  })

  it('reports an upstream failure as retryable and leaves the connection alone', async () => {
    serveProviders({ status: 503 })
    const email = await readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    expect(email.accounts.map((account) => account.state)).toEqual(['unavailable', 'unavailable'])
    expect(email.threads).toEqual([])
    const [stored] = await db
      .select({ status: credential.managedOauthStatus })
      .from(credential)
      .where(eq(credential.id, memberGmail))
    expect(stored.status).toBe('active')
  })

  it('stops reading a provider the organization withdrew, without asking it', async () => {
    const tokens = serveProviders()
    await setApproval('gmail', false)
    const email = await readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    expect(email.accounts.find((a) => a.credentialId === memberGmail)?.state).toBe('not_offered')
    expect(tokens).not.toContain(`Bearer token-for-${memberGmail}`)
  })

  it('bounds the list merged across accounts', async () => {
    serveProviders()
    const email = await readOrganizationHomeEmail.execute({ principal: session(memberId), input })
    expect(email.threads).toHaveLength(HOME_EMAIL_THREAD_LIMIT)
  })

  it('reads the requested day in the requested zone', async () => {
    serveProviders()
    const calendar = await readOrganizationHomeCalendar.execute({
      principal: session(memberId),
      input: day,
    })
    expect(calendar.window).toEqual({
      startAt: '2026-11-05T08:00:00.000Z',
      endAt: '2026-11-06T08:00:00.000Z',
    })
    const urls = provider.mock.calls.map(([url]) => new URL(url))
    const google = urls.find((url) => url.hostname === 'www.googleapis.com')
    const graph = urls.find((url) => url.searchParams.has('startDateTime'))
    expect(google?.searchParams.get('timeMin')).toBe(calendar.window.startAt)
    expect(graph?.searchParams.get('startDateTime')).toBe(calendar.window.startAt)
    expect(calendar.accounts.map((a) => a.credentialId).sort()).toEqual(
      [memberCalendar, memberOutlook].sort()
    )
  })
})

describe('the routes', () => {
  const emailRequest = () =>
    getEmailRoute(
      new NextRequest(`http://localhost:3000/api/organizations/${organizationId}/home/email`),
      { params: Promise.resolve({ id: organizationId }) }
    )
  const calendarRequest = (query: string) =>
    getCalendarRoute(
      new NextRequest(
        `http://localhost:3000/api/organizations/${organizationId}/home/calendar?${query}`
      ),
      { params: Promise.resolve({ id: organizationId }) }
    )
  const signInAs = (userId: string) =>
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: userId },
      session: { id: generateId() },
    })

  it('answers no session with 401 and never reaches a provider', async () => {
    serveProviders()
    authMockFns.mockGetSession.mockResolvedValue(null)
    expect((await emailRequest()).status).toBe(401)
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers a non-member with 404, concealing the organization', async () => {
    serveProviders()
    signInAs(outsiderId)
    expect((await emailRequest()).status).toBe(404)
    expect(provider).not.toHaveBeenCalled()
  })

  it('answers a member with their mail, marked uncacheable', async () => {
    serveProviders()
    signInAs(memberId)
    const response = await emailRequest()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('rejects a malformed day or zone', async () => {
    serveProviders()
    signInAs(memberId)
    expect((await calendarRequest('date=tomorrow&timeZone=UTC')).status).toBe(400)
    expect((await calendarRequest('date=2026-11-05&timeZone=Mars/Olympus')).status).toBe(400)
    expect(provider).not.toHaveBeenCalled()
  })
})
