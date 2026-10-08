import { db } from '@sim/db'
import {
  account,
  auditLog,
  member,
  organization,
  session,
  ssoProvider,
  user,
  verification,
} from '@sim/db/schema'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { generateId } from '@sim/utils/id'
import { APIError } from 'better-auth/api'
import { hashPassword } from 'better-auth/crypto'
import { count, eq, inArray, or } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordAuthenticationAudit } from '@/lib/auth/lifecycle-audit'

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

describe('authentication audit history in PostgreSQL', () => {
  let auth: typeof import('@/lib/auth/auth').auth
  let resetPassword: typeof import('@/app/api/auth/forget-password/route').POST
  let userId: string
  let organizationId: string
  let email: string
  let passwordHash: string
  let additionalUserIds: string[]
  const fixturePassword = 'Audit-fixture-password-only-36!'

  beforeAll(async () => {
    ;({ auth } = await import('@/lib/auth/auth'))
    ;({ POST: resetPassword } = await import('@/app/api/auth/forget-password/route'))
    passwordHash = await hashPassword(fixturePassword)
  }, 90_000)

  beforeEach(async () => {
    userId = generateId()
    organizationId = generateId()
    email = `${userId}@authentication-audit.test`
    additionalUserIds = []
    const now = new Date()
    emailMailerMockFns.mockSendEmail.mockResolvedValue({ success: true })
    await db.insert(user).values({
      id: userId,
      name: 'Authentication audit fixture',
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(organization).values({
      id: organizationId,
      name: 'Authentication audit fixture',
      slug: organizationId,
      createdAt: now,
    })
    await db.insert(member).values({ id: generateId(), userId, organizationId, role: 'member' })
    await db.insert(account).values({
      id: generateId(),
      accountId: userId,
      userId,
      providerId: 'credential',
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterEach(async () => {
    await db.delete(auditLog).where(inArray(auditLog.resourceId, [userId, ...additionalUserIds]))
    await db
      .delete(verification)
      .where(
        or(eq(verification.value, userId), eq(verification.identifier, `sign-in-otp-${email}`))
      )
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, [userId, ...additionalUserIds]))
  })

  function request(path: string, body: object, cookie?: string) {
    return new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'user-agent': 'Authentication audit fixture',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  async function history() {
    return db.select().from(auditLog).where(eq(auditLog.resourceId, userId))
  }

  async function expectEvent(action: string, actorId: string | null) {
    await expect
      .poll(async () => (await history()).filter((entry) => entry.action === action).length)
      .toBe(1)
    const entry = (await history()).find((row) => row.action === action)
    expect(entry).toMatchObject({
      actorId,
      resourceId: userId,
      metadata: { organizationId },
      userAgent: 'Authentication audit fixture',
    })
    expect(JSON.stringify(entry)).not.toContain(fixturePassword)
    expect(JSON.stringify(entry)).not.toContain(passwordHash)
    return entry
  }

  function cookieHeader(response: Response, previous = '') {
    const cookies = new Map<string, string>()
    for (const value of [...previous.split('; '), ...response.headers.getSetCookie()]) {
      const pair = value.split(';')[0]
      const separator = pair.indexOf('=')
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  async function login(loginEmail = email) {
    const response = await auth.handler(
      request('/sign-in/email', { email: loginEmail, password: fixturePassword })
    )
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { token: string }
    return { cookie: cookieHeader(response), token: payload.token }
  }

  async function createAdministrator() {
    const id = generateId()
    additionalUserIds.push(id)
    const administratorEmail = `${id}@authentication-audit.test`
    const now = new Date()
    await db.insert(user).values({
      id,
      name: 'Authentication audit administrator',
      email: administratorEmail,
      emailVerified: true,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(account).values({
      id: generateId(),
      accountId: id,
      userId: id,
      providerId: 'credential',
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    return { id, ...(await login(administratorEmail)) }
  }

  async function sessionCount() {
    const [row] = await db
      .select({ total: count() })
      .from(session)
      .where(eq(session.userId, userId))
    return row.total
  }

  it('records accepted login and logout without storing a session bearer token', async () => {
    const login = await auth.handler(
      request('/sign-in/email', { email, password: fixturePassword })
    )
    expect(login.status).toBe(200)
    const payload = (await login.json()) as { token: string }
    await expectEvent('auth.login_succeeded', userId)
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const logout = await auth.handler(request('/sign-out', {}, cookie))
    expect(logout.status).toBe(200)
    await expectEvent('auth.logout', userId)
    expect(JSON.stringify(await history())).not.toContain(payload.token)
  })

  it('records an invalid password as an unauthenticated attempt against the account', async () => {
    const response = await auth.handler(request('/sign-in/email', { email, password: 'incorrect' }))
    expect(response.status).toBe(401)
    await expectEvent('auth.login_failed', null)
    expect((await history()).some((entry) => entry.action === 'auth.login_succeeded')).toBe(false)
  })

  it('records suspended-account denial without claiming a successful login', async () => {
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, userId))
    const response = await auth.handler(
      request('/sign-in/email', { email, password: fixturePassword })
    )
    expect(response.status).toBe(403)
    await expectEvent('auth.login_failed', null)
    expect((await history()).some((entry) => entry.action === 'auth.login_succeeded')).toBe(false)
  })

  it('records an accepted email OTP login without retaining the OTP or session token', async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } })
    const response = await auth.handler(request('/sign-in/email-otp', { email, otp }))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as { token: string }
    const entry = await expectEvent('auth.login_succeeded', userId)
    expect(entry?.metadata).toMatchObject({ authenticationMethod: 'email_otp' })
    expect(JSON.stringify(entry)).not.toContain(otp)
    expect(JSON.stringify(entry)).not.toContain(payload.token)
  })

  it('records a rejected email OTP as an anonymous attempt against the account', async () => {
    await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } })
    const response = await auth.handler(request('/sign-in/email-otp', { email, otp: 'incorrect' }))
    expect(response.status).toBe(400)
    const entry = await expectEvent('auth.login_failed', null)
    expect(entry?.metadata).toMatchObject({ authenticationMethod: 'email_otp' })
    expect((await history()).some((event) => event.action === 'auth.login_succeeded')).toBe(false)
  })

  it.each([
    { path: '/sign-in/email', action: 'auth.login_failed' },
    { path: '/request-password-reset', action: 'password.reset_requested' },
  ])('omits ambiguous legacy email provenance for $action', async ({ path, action }) => {
    const collisionId = generateId()
    additionalUserIds.push(collisionId)
    await db.insert(user).values({
      id: collisionId,
      name: 'Legacy authentication fixture',
      email: email.toUpperCase(),
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db
      .insert(member)
      .values({ id: generateId(), userId: collisionId, organizationId, role: 'member' })
    const agent = `Authentication collision fixture ${generateId()}`
    const attempt = request(path, {
      email,
      password: 'incorrect-fixture-password',
      redirectTo: 'http://localhost:3000/reset-password',
    })
    attempt.headers.set('user-agent', agent)
    try {
      const response = await auth.handler(attempt)
      expect(response.status).toBe(path === '/sign-in/email' ? 401 : 200)
      const events = () => db.select().from(auditLog).where(eq(auditLog.userAgent, agent))
      await expect
        .poll(async () => (await events()).filter((event) => event.action === action).length)
        .toBe(1)
      const event = (await events()).find((event) => event.action === action)
      if (!event) throw new Error('Authentication audit event missing')
      expect(event.actorId).toBeNull()
      expect(event.resourceId).toBeNull()
      expect(event.metadata).not.toHaveProperty('targetUserId')
      expect(event.metadata).not.toHaveProperty('organizationId')
    } finally {
      await db.delete(auditLog).where(eq(auditLog.userAgent, agent))
    }
  })

  it('attributes a password-reset request to its unauthenticated requester and the target organization', async () => {
    const response = await resetPassword(
      createMockRequest({
        method: 'POST',
        url: 'http://localhost:3000/api/auth/forget-password',
        body: { email, redirectTo: 'http://localhost:3000/reset-password' },
        headers: { 'user-agent': 'Authentication audit fixture' },
      }),
      {}
    )
    expect(response.status).toBe(200)
    await expectEvent('password.reset_requested', null)
  })

  it('records a reset delegated directly to the auth handler with the same anonymous actor and organization', async () => {
    const response = await auth.handler(
      request('/request-password-reset', {
        email,
        redirectTo: 'http://localhost:3000/reset-password',
      })
    )
    expect(response.status).toBe(200)
    await expectEvent('password.reset_requested', null)
  })

  it('does not report a rejected direct reset request as a successful reset request', async () => {
    const response = await auth.handler(
      request('/request-password-reset', {
        email,
        redirectTo: 123,
      })
    )
    expect(response.status).toBe(400)
    const login = await auth.handler(
      request('/sign-in/email', { email, password: fixturePassword })
    )
    expect(login.status).toBe(200)
    await expectEvent('auth.login_succeeded', userId)
    expect(
      (await history()).filter((entry) => entry.action === 'password.reset_requested')
    ).toHaveLength(0)
  })

  it('scopes an SSO admission refusal to the configured provider organization when the account belongs elsewhere', async () => {
    const providerOrganizationId = generateId()
    const providerId = generateId()
    await db.insert(organization).values({
      id: providerOrganizationId,
      name: 'SSO authentication audit fixture',
      slug: providerOrganizationId,
      createdAt: new Date(),
    })
    await db.insert(ssoProvider).values({
      id: generateId(),
      issuer: 'https://sso.authentication-audit.test',
      domain: 'authentication-audit.test',
      userId,
      providerId,
      organizationId: providerOrganizationId,
    })
    try {
      await recordAuthenticationAudit({
        path: '/sso/callback/:providerId',
        userId,
        providerId,
        failureReason: 'sso_admission_denied',
        returned: new APIError('FORBIDDEN', { message: fixturePassword }),
        request: request('/sso/callback', {}),
      })
      await expect.poll(async () => (await history()).length).toBe(1)
      const [entry] = await history()
      expect(entry).toMatchObject({
        action: 'auth.login_failed',
        actorId: null,
        resourceId: userId,
        metadata: {
          organizationId: providerOrganizationId,
          providerId,
          failureReason: 'sso_admission_denied',
        },
      })
      expect(JSON.stringify(entry)).not.toContain(fixturePassword)
    } finally {
      await db.delete(organization).where(eq(organization.id, providerOrganizationId))
    }
  })
  it.each(['started', 'ended'] as const)(
    'records impersonation %s against the target organization with the administrator as actor',
    async (outcome) => {
      const administrator = await createAdministrator()
      const started = await auth.handler(
        request('/admin/impersonate-user', { userId }, administrator.cookie)
      )
      expect(started.status).toBe(200)
      const payload = (await started.json()) as { session: { token: string } }
      const ended = await auth.handler(
        request('/admin/stop-impersonating', {}, cookieHeader(started, administrator.cookie))
      )
      expect(ended.status).toBe(200)
      await expectEvent(`auth.impersonation_${outcome}`, administrator.id)
      const entries = JSON.stringify(await history())
      expect(entries).not.toContain(administrator.token)
      expect(entries).not.toContain(payload.session.token)
    }
  )

  it.each([
    { path: '/revoke-session', mode: 'single', matched: 1, remaining: 1 },
    { path: '/revoke-sessions', mode: 'all', matched: 2, remaining: 0 },
    { path: '/revoke-other-sessions', mode: 'other', matched: 1, remaining: 1 },
  ] as const)(
    'records $mode self session revocation without retaining the session bearer tokens',
    async ({ path, mode, matched, remaining }) => {
      const previous = await login()
      const current = await login()
      const response = await auth.handler(
        request(path, mode === 'single' ? { token: previous.token } : {}, current.cookie)
      )
      expect(response.status).toBe(200)
      expect(await sessionCount()).toBe(remaining)
      const entry = await expectEvent('auth.sessions_revoked', userId)
      expect(entry?.metadata).toMatchObject({
        revocationMode: mode,
        sessionsMatchedBefore: matched,
      })
      const entries = JSON.stringify(await history())
      expect(entries).not.toContain(previous.token)
      expect(entries).not.toContain(current.token)
    }
  )

  it.each([
    { path: '/admin/revoke-user-session', mode: 'single', matched: 1, remaining: 1 },
    { path: '/admin/revoke-user-sessions', mode: 'all', matched: 2, remaining: 0 },
  ] as const)(
    'records $mode administrative session revocation in the target organization with the real operator',
    async ({ path, mode, matched, remaining }) => {
      const previous = await login()
      const current = await login()
      const administrator = await createAdministrator()
      const response = await auth.handler(
        request(
          path,
          mode === 'single' ? { sessionToken: previous.token } : { userId },
          administrator.cookie
        )
      )
      expect(response.status).toBe(200)
      expect(await sessionCount()).toBe(remaining)
      const entry = await expectEvent('auth.sessions_revoked', administrator.id)
      expect(entry?.metadata).toMatchObject({
        revocationMode: mode,
        sessionsMatchedBefore: matched,
      })
      const entries = JSON.stringify(await history())
      expect(entries).not.toContain(previous.token)
      expect(entries).not.toContain(current.token)
      expect(entries).not.toContain(administrator.token)
    }
  )
})
