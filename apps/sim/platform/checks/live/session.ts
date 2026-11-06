import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use real seeded members`)
  return value
}

/** Where the run's report sits. Sessions and screenshots go beside it. */
export const reportDir = path.dirname(
  process.env.PLATFORM_LIVE_REPORT_PATH ?? 'test-results/platform-live/report.json'
)

/** The administrator most specs act as. */
export const adminEmail = () => requireEnv('PLATFORM_LIVE_EMAIL')
export const memberEmail = () => requireEnv('PLATFORM_LIVE_MEMBER_EMAIL')
export const organizationId = () => requireEnv('PLATFORM_LIVE_ORGANIZATION_ID')
export const organizationName = () => requireEnv('PLATFORM_LIVE_ORGANIZATION_NAME')

type Cookies = Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>

/** On disk, because Playwright starts a new worker process after every failed test. */
const SESSIONS_FILE = path.join(reportDir, 'sessions.local.json')

function readSessions(): Record<string, Cookies> {
  try {
    return JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

/** Types the credentials into the login page `target` redirected to, as a person would. */
export async function signInThroughForm(page: Page, email: string, target: string) {
  await page.goto(target)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 })
}

/**
 * Opens `target` as `email`. The first sign-in per person goes through the form, and later ones
 * restore its session: Better Auth allows three sign-ins per address in ten seconds, far fewer than
 * a suite this size needs.
 */
export async function signIn(page: Page, email: string, target: string) {
  const known = readSessions()[email]
  if (known) {
    await page.context().addCookies(known)
    await page.goto(target)
    return
  }
  await signInThroughForm(page, email, target)
  // The login page returns to the zone root, not to the deep link it was sent from, and that
  // redirect can abort a navigation started while it is still running.
  await expect(async () => {
    await page.goto(target)
  }).toPass({ timeout: 30_000 })
  mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true })
  writeFileSync(
    SESSIONS_FILE,
    JSON.stringify({ ...readSessions(), [email]: await page.context().cookies() })
  )
}

export const signInAsAdmin = (page: Page, target: string) => signIn(page, adminEmail(), target)
