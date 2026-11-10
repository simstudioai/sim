import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { generateId } from '@sim/utils/id'
import { makeSignature } from 'better-auth/crypto'
import { withLiveDatabase } from '@/platform/checks/live/support/database'
import { waitUntilHydrated } from '@/platform/checks/test'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use real seeded members`)
  return value
}

/** Where the run's report sits. Screenshots go beside it. */
export const reportDir = path.dirname(
  process.env.PLATFORM_LIVE_REPORT_PATH ?? 'test-results/platform-live/report.json'
)

/** The main app the suite runs against, as `playwright.config.ts` points its `baseURL`. */
const liveOrigin = () => new URL(process.env.PLATFORM_LIVE_ORIGIN ?? 'http://localhost:3000')

/** The administrator most specs act as. */
export const adminEmail = () => requireEnv('PLATFORM_LIVE_EMAIL')
export const memberEmail = () => requireEnv('PLATFORM_LIVE_MEMBER_EMAIL')
export const organizationId = () => requireEnv('PLATFORM_LIVE_ORGANIZATION_ID')
export const organizationName = () => requireEnv('PLATFORM_LIVE_ORGANIZATION_NAME')
/** The member of the seeded organization whose permission group withholds Chat. */
export const noChatMemberEmail = () => requireEnv('PLATFORM_LIVE_NO_CHAT_EMAIL')
export const noChatOrganizationId = () => `${organizationId()}-no-chat`

const LOGIN_PATH = /^\/login\/?$/
const SESSION_COOKIE = 'better-auth.session_token'

/**
 * Types the credentials into the login page `target` redirected to, as a person would, and waits
 * for the page the sign-in lands on (`target`, from the login page's callback) to load and hydrate.
 *
 * Better Auth allows three sign-ins per client address in ten seconds, and every request from this
 * runner comes from one address, so one check signs in this way and every other check opens on a
 * session of its own from {@link signIn}.
 */
export async function signInThroughForm(page: Page, email: string, target: string) {
  await page.goto(target)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        new URL(candidate.url()).pathname === '/api/auth/sign-in/email'
    ),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ])
  expect(response.status(), 'the sign-in was refused').toBe(200)
  await page.waitForURL((url) => !LOGIN_PATH.test(url.pathname), {
    timeout: 30_000,
    waitUntil: 'load',
  })
  await waitUntilHydrated(page)
}

/** A session seeded for one check: its row's token, and the signed cookie that carries it. */
export interface SeededSession {
  token: string
  cookie: { name: string; value: string; url: string; httpOnly: boolean; sameSite: 'Lax' }
}

/**
 * Writes a fresh session row for `email`, active in the organization they belong to, and signs its
 * cookie with the app's secret, as Better Auth does on a sign-in. Each check gets its own, so one
 * that signs out or fails part-way leaves no other check holding a dead session.
 */
export async function seedSession(email: string): Promise<SeededSession> {
  const token = generateId().replaceAll('-', '')
  await withLiveDatabase(async (sql) => {
    const [person] = await sql<{ id: string; organizationId: string | null }[]>`
      select u.id, (select m.organization_id from member m where m.user_id = u.id limit 1)
        as "organizationId"
      from "user" u where u.email = ${email}`
    if (!person) throw new Error(`No seeded account for ${email}`)
    await sql`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${`platform-live-session-${generateId()}`}, ${token}, ${person.id},
        ${person.organizationId}, now() + interval '1 day', now(), now())`
  })
  const signature = await makeSignature(token, requireEnv('PLATFORM_LIVE_AUTH_SECRET'))
  return {
    token,
    cookie: {
      name: SESSION_COOKIE,
      value: encodeURIComponent(`${token}.${signature}`),
      url: liveOrigin().origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  }
}

/**
 * Opens `target` as `email`, on a session seeded for this call, and returns that session. Signs out
 * first, as a person switching accounts does: Better Auth serves its cached session cookie without
 * matching it to the token, so a check signing in again would otherwise stay the earlier person.
 */
export async function signIn(page: Page, email: string, target: string): Promise<SeededSession> {
  const session = await seedSession(email)
  await page.context().clearCookies({ name: /^better-auth\./ })
  await page.context().addCookies([session.cookie])
  await page.goto(target)
  return session
}

export const signInAsAdmin = (page: Page, target: string) => signIn(page, adminEmail(), target)
