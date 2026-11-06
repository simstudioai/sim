/**
 * Reconnecting a credential through Better Auth's real OAuth link callback onto a provider
 * identity that already backs another credential in the same workspace.
 */

import { db } from '@sim/db'
import { account, credential, pendingCredentialDraft, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { jsonResponse } from '@sim/testing/helpers/http'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { hashPassword } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = 'reconnect-conflict-integration-client'
  process.env.GOOGLE_CLIENT_SECRET = 'reconnect-conflict-integration-secret'
})

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ORIGIN = 'http://localhost:3000'
const PROVIDER_ID = 'google-drive'
const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const fixturePassword = 'Reconnect-conflict-fixture-password-36!'

const userId = generateId()
const email = `${userId}@reconnect-conflict.test`
const workspaceId = generateId()
const workCredentialId = generateId()
const personalCredentialId = generateId()
const workAccountRowId = generateId()
const personalAccountRowId = generateId()
const workSubject = `work-subject-${generateId()}`
const personalSubject = `personal-subject-${generateId()}`
const originalFetch = globalThis.fetch

/** The subject the fixture userinfo endpoint answers with on the next callback. */
let chosenSubject = personalSubject

function cookieHeader(response: Response, previous = '') {
  const cookies = new Map<string, string>()
  for (const value of [...previous.split('; '), ...response.headers.getSetCookie()]) {
    const pair = value.split(';')[0]
    const separator = pair.indexOf('=')
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

describe('reconnecting a credential onto an account another credential uses', () => {
  let auth: typeof import('@/lib/auth/auth').auth
  let sessionCookie: string

  beforeAll(async () => {
    ;({ auth } = await import('@/lib/auth/auth'))
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Reconnect conflict fixture',
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(account).values({
      id: generateId(),
      accountId: userId,
      userId,
      providerId: 'credential',
      password: await hashPassword(fixturePassword),
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Reconnect conflict fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      if (target === DISCOVERY_URL) {
        return jsonResponse({
          issuer: 'https://accounts.google.com',
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: TOKEN_URL,
          userinfo_endpoint: USERINFO_URL,
        })
      }
      if (target === TOKEN_URL) {
        return jsonResponse({
          access_token: `fresh-access-${chosenSubject}`,
          refresh_token: `fresh-refresh-${chosenSubject}`,
          expires_in: 3600,
          token_type: 'Bearer',
        })
      }
      if (target === USERINFO_URL) {
        return jsonResponse({ sub: chosenSubject, email, name: 'Reconnect conflict fixture' })
      }
      return originalFetch(input, init)
    })

    const signIn = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email, password: fixturePassword }),
      })
    )
    expect(signIn.status).toBe(200)
    sessionCookie = cookieHeader(signIn)
  }, 90_000)

  beforeEach(async () => {
    await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
    await db
      .delete(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, PROVIDER_ID)))
    const past = new Date(Date.now() - 60_000)
    await db.insert(account).values([
      {
        id: workAccountRowId,
        userId,
        providerId: PROVIDER_ID,
        accountId: `${workSubject}-${generateId()}`,
        accessToken: 'work-access',
        refreshToken: 'work-refresh',
        createdAt: past,
        updatedAt: past,
      },
      {
        id: personalAccountRowId,
        userId,
        providerId: PROVIDER_ID,
        accountId: `${personalSubject}-${generateId()}`,
        accessToken: 'personal-access',
        refreshToken: 'personal-refresh',
        createdAt: past,
        updatedAt: past,
      },
    ])
    await db.insert(credential).values([
      {
        id: workCredentialId,
        type: 'oauth',
        workspaceId,
        accountId: workAccountRowId,
        providerId: PROVIDER_ID,
        displayName: 'Work Drive',
        createdBy: userId,
        updatedAt: past,
      },
      {
        id: personalCredentialId,
        type: 'oauth',
        workspaceId,
        accountId: personalAccountRowId,
        providerId: PROVIDER_ID,
        displayName: 'Personal Drive',
        createdBy: userId,
        updatedAt: past,
      },
    ])
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    vi.unstubAllGlobals()
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  /** Starts a reconnect of the work credential and returns the provider callback's response. */
  async function reconnectWorkCredentialAs(subject: string) {
    chosenSubject = subject
    const draftId = generateId()
    await db.insert(pendingCredentialDraft).values({
      id: draftId,
      userId,
      workspaceId,
      providerId: PROVIDER_ID,
      displayName: 'Work Drive',
      credentialId: workCredentialId,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    })
    const startedFrom = `${ORIGIN}/workspace/${workspaceId}/integrations/connected/${workCredentialId}`

    const link = await auth.handler(
      new Request(`${ORIGIN}/api/auth/oauth2/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: sessionCookie },
        body: JSON.stringify({
          providerId: PROVIDER_ID,
          callbackURL: `${startedFrom}?credentialDraftId=${draftId}`,
        }),
      })
    )
    expect(link.status).toBe(200)
    const { url } = (await link.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')
    if (!state) throw new Error('OAuth link did not return a state')

    const callback = await auth.handler(
      new Request(
        `${ORIGIN}/api/auth/oauth2/callback/${PROVIDER_ID}?code=fixture-code&state=${encodeURIComponent(state)}`,
        { headers: { cookie: cookieHeader(link, sessionCookie) } }
      )
    )
    return { callback, draftId, startedFrom }
  }

  async function credentialAccount(credentialId: string) {
    const [row] = await db
      .select({ accountId: credential.accountId })
      .from(credential)
      .where(eq(credential.id, credentialId))
    return row?.accountId
  }

  async function providerAccountRows() {
    return db
      .select({ id: account.id, accessToken: account.accessToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, PROVIDER_ID)))
  }

  it('sends the user back with the reason, keeping each credential on its account', async () => {
    const { callback, draftId, startedFrom } = await reconnectWorkCredentialAs(personalSubject)

    expect(callback.status).toBe(302)
    const location = new URL(callback.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(startedFrom)
    expect(location.searchParams.get('error')).toBe('credential_account_conflict')
    expect(location.searchParams.get('error_description')).toBe(
      'That Google account is already connected in this workspace as "Personal Drive". Use that connection, or reconnect with the account that belongs to this one.'
    )
    expect(location.searchParams.has('credentialDraftId')).toBe(false)

    expect(await credentialAccount(workCredentialId)).toBe(workAccountRowId)
    expect(await credentialAccount(personalCredentialId)).toBe(personalAccountRowId)
    const rows = await providerAccountRows()
    expect(rows.map((row) => row.id).sort()).toEqual(
      [workAccountRowId, personalAccountRowId].sort()
    )
    expect(rows.find((row) => row.id === personalAccountRowId)?.accessToken).toBe(
      `fresh-access-${personalSubject}`
    )
    expect(rows.find((row) => row.id === workAccountRowId)?.accessToken).toBe('work-access')
    const drafts = await db
      .select({ id: pendingCredentialDraft.id })
      .from(pendingCredentialDraft)
      .where(eq(pendingCredentialDraft.id, draftId))
    expect(drafts).toEqual([])
  })

  it('still reconnects the credential when the user picks the identity it already had', async () => {
    const { callback, startedFrom } = await reconnectWorkCredentialAs(workSubject)

    expect(callback.status).toBe(302)
    const location = new URL(callback.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(startedFrom)
    expect(location.searchParams.has('error')).toBe(false)

    const reconnectedAccountId = await credentialAccount(workCredentialId)
    expect(reconnectedAccountId).not.toBe(workAccountRowId)
    expect(await credentialAccount(personalCredentialId)).toBe(personalAccountRowId)
    const rows = await providerAccountRows()
    expect(rows.map((row) => row.id).sort()).toEqual(
      [reconnectedAccountId, personalAccountRowId].sort()
    )
  })
})
