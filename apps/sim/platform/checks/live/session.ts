import { expect, type Page } from '@playwright/test'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use real seeded members`)
  return value
}

/** The administrator most specs act as. */
export const adminEmail = () => requireEnv('PLATFORM_LIVE_EMAIL')
export const memberEmail = () => requireEnv('PLATFORM_LIVE_MEMBER_EMAIL')
export const organizationId = () => requireEnv('PLATFORM_LIVE_ORGANIZATION_ID')
export const organizationName = () => requireEnv('PLATFORM_LIVE_ORGANIZATION_NAME')

type Cookies = Awaited<ReturnType<ReturnType<Page['context']>['cookies']>>

const sessions = new Map<string, Cookies>()

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
  const known = sessions.get(email)
  if (known) {
    await page.context().addCookies(known)
    await page.goto(target)
    return
  }
  await signInThroughForm(page, email, target)
  sessions.set(email, await page.context().cookies())
}

export const signInAsAdmin = (page: Page, target: string) => signIn(page, adminEmail(), target)
