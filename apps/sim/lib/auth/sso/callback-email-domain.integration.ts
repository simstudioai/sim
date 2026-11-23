import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '@sim/db'
import { account, ssoProvider, user } from '@sim/db/schema'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)
vi.mock('@/components/emails', () => emailTemplatesMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const PROVIDER_DOMAIN = 'verified-tenant.test'

/**
 * Drives a real OIDC sign-in through Better Auth's SSO callback against PostgreSQL, with a local
 * IdP the tenant controls: whatever address its userinfo asserts is what the callback receives.
 */
describe('SSO callback user writes in PostgreSQL', () => {
  let auth: typeof import('@/lib/auth/auth').auth
  let idp: Server
  let idpOrigin: string
  let assertedEmail: string
  let assertedSubject: string
  let ownerId: string
  let providerId: string
  let createdEmails: string[]

  beforeAll(async () => {
    idp = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      if (request.url === '/token') {
        response.end(
          JSON.stringify({
            access_token: 'idp-access-token',
            token_type: 'Bearer',
            expires_in: 600,
          })
        )
        return
      }
      response.end(JSON.stringify({ sub: assertedSubject, email: assertedEmail, name: 'Asserted' }))
    })
    await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve))
    idpOrigin = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`
    vi.stubEnv('SSO_ENABLED', 'true')
    vi.stubEnv('TRUSTED_ORIGINS', idpOrigin)
    ;({ auth } = await import('@/lib/auth/auth'))
  }, 90_000)

  afterAll(async () => {
    vi.unstubAllEnvs()
    await new Promise((resolve) => idp.close(resolve))
  })

  beforeEach(async () => {
    ownerId = generateId()
    providerId = `tenant-idp-${generateId()}`
    assertedSubject = generateId()
    createdEmails = []
    const now = new Date()
    await db.insert(user).values({
      id: ownerId,
      name: 'Tenant administrator',
      email: `${ownerId}@${PROVIDER_DOMAIN}`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterEach(async () => {
    await db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId))
    await db.delete(user).where(eq(user.id, ownerId))
    if (createdEmails.length > 0) await db.delete(user).where(inArray(user.email, createdEmails))
  })

  async function registerProvider(options: { overrideUserInfo?: boolean } = {}) {
    await db.insert(ssoProvider).values({
      id: generateId(),
      providerId,
      userId: ownerId,
      issuer: idpOrigin,
      domain: PROVIDER_DOMAIN,
      domainVerified: true,
      oidcConfig: JSON.stringify({
        issuer: idpOrigin,
        clientId: 'tenant-client',
        clientSecret: 'tenant-client-secret',
        authorizationEndpoint: `${idpOrigin}/authorize`,
        tokenEndpoint: `${idpOrigin}/token`,
        userInfoEndpoint: `${idpOrigin}/userinfo`,
        jwksEndpoint: `${idpOrigin}/jwks`,
        pkce: false,
        overrideUserInfo: options.overrideUserInfo ?? false,
      }),
    })
  }

  /** Starts the sign-in, then returns from the IdP to the callback as the browser would. */
  async function signInAs(email: string) {
    assertedEmail = email
    createdEmails.push(email)
    const started = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/sso', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ providerId, callbackURL: '/workspace', errorCallbackURL: '/sso' }),
      })
    )
    expect(started.status).toBe(200)
    const { url } = (await started.json()) as { url: string }
    const state = new URL(url).searchParams.get('state') ?? ''
    expect(state).not.toBe('')
    const cookie = started.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const callback = new URL(`http://localhost:3000/api/auth/sso/callback/${providerId}`)
    callback.searchParams.set('code', 'authorization-code')
    callback.searchParams.set('state', state)
    return auth.handler(new Request(callback, { headers: { cookie } }))
  }

  function redirectOf(response: Response) {
    expect(response.status).toBe(302)
    return new URL(response.headers.get('location') ?? '', 'http://localhost:3000')
  }

  async function userByEmail(email: string) {
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    return row
  }

  it('creates no user or account for an asserted address outside the verified domain', async () => {
    await registerProvider()
    const victim = `ceo-${generateId()}@unverified-victim.test`

    const response = await signInAs(victim)

    expect(redirectOf(response).searchParams.get('error')).toBe('sso_provisioning_failed')
    expect(await userByEmail(victim)).toBeUndefined()
    expect(
      await db.select({ id: account.id }).from(account).where(eq(account.providerId, providerId))
    ).toHaveLength(0)
  })

  it('still creates the user for an asserted address inside the verified domain', async () => {
    await registerProvider()
    const member = `member-${generateId()}@${PROVIDER_DOMAIN}`

    const response = await signInAs(member)

    const redirect = redirectOf(response)
    expect(redirect.pathname).toBe('/workspace')
    expect(redirect.searchParams.has('error')).toBe(false)
    expect(await userByEmail(member)).toBeDefined()
  })

  it('keeps a linked user’s email when the IdP later asserts an address outside the domain', async () => {
    await registerProvider({ overrideUserInfo: true })
    const member = `member-${generateId()}@${PROVIDER_DOMAIN}`
    await signInAs(member)
    const linked = await userByEmail(member)
    expect(linked).toBeDefined()

    const victim = `ceo-${generateId()}@unverified-victim.test`
    const response = await signInAs(victim)

    expect(redirectOf(response).searchParams.get('error')).toBe('sso_provisioning_failed')
    expect(await userByEmail(member)).toEqual(linked)
    expect(await userByEmail(victim)).toBeUndefined()
  })
})
