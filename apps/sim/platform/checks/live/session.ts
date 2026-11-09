import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { type BrowserContext, expect, type Page } from '@playwright/test'
import { waitUntilHydrated } from '@/platform/checks/test'

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
/**
 * One Playwright storage state per person, on disk: Playwright starts a new worker process after
 * every failed test, and a person signs in through the form once per run however many specs act as
 * them.
 */
const storageStatePath = (email: string) => path.join(reportDir, 'sessions', `${email}.json`)

function readStorageState(
  email: string
): { cookies: Parameters<BrowserContext['addCookies']>[0] } | null {
  try {
    return JSON.parse(readFileSync(storageStatePath(email), 'utf8'))
  } catch {
    return null
  }
}

const LOGIN_PATH = /^\/login\/?$/
/** Gives each form sign-in its own client address, as the people a deployment serves have. */
let signInAddress = 0

/**
 * Types the credentials into the login page `target` redirected to, as a person would, and waits
 * for the page the sign-in lands on (`target`, from the login page's callback) to load and hydrate.
 *
 * Better Auth refuses a fourth sign-in from one client address within ten seconds, and this suite
 * signs in more people than that from one machine, so each sign-in carries its own forwarded
 * address, as `org-redesign-e2e` does for its sessions.
 */
export async function signInThroughForm(page: Page, email: string, target: string) {
  await page.goto(target)
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  signInAddress += 1
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.${process.pid % 250}.${Math.floor(signInAddress / 250)}.${signInAddress % 250}`,
  })
  try {
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
  } finally {
    await page.setExtraHTTPHeaders({})
  }
  await waitUntilHydrated(page)
}

/**
 * Opens `target` as `email`. The first sign-in per person goes through the form and lands on
 * `target`; later ones restore its storage state.
 */
export async function signIn(page: Page, email: string, target: string) {
  const known = readStorageState(email)
  if (known) {
    await page.context().addCookies(known.cookies)
    await page.goto(target)
    return
  }
  await signInThroughForm(page, email, target)
  mkdirSync(path.dirname(storageStatePath(email)), { recursive: true })
  await page.context().storageState({ path: storageStatePath(email) })
}

export const signInAsAdmin = (page: Page, target: string) => signIn(page, adminEmail(), target)
