import { expect, type Page } from '@playwright/test'
import { adminEmail, memberEmail, requireEnv, signIn } from '@/platform/checks/live/session'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/**
 * Where each persona of the seeded organization lands, and the navigation it is given there. Chat
 * follows the permission group, never the role, and no group of the seeded organization withholds
 * it, so every persona lands on Home.
 */
const PERSONAS = [
  ['owner', () => requireEnv('PLATFORM_LIVE_OWNER_EMAIL')],
  ['admin', adminEmail],
  ['member', memberEmail],
] as const

/**
 * The destination rows of the main navigation, in order. The Workspaces and Chats sections share
 * its landmark, each in a section of its own, so their rows are not destinations.
 */
async function navLabels(page: Page) {
  const links = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')
  await expect(links.first()).toBeVisible()
  return links.evaluateAll((anchors) =>
    anchors
      .filter(
        (anchor): anchor is HTMLElement =>
          anchor instanceof HTMLElement && !anchor.closest('nav section')
      )
      .map((anchor) => anchor.innerText.trim())
  )
}

for (const [persona, email] of PERSONAS) {
  test(`${persona}: /o, the organization root and /home all reach Home`, async ({ page }) => {
    const home = liveRoute('/home')
    await signIn(page, email(), '/o')
    for (const path of ['/o', liveRoute(''), '/home', home]) {
      await page.goto(path)
      await expect(page, path).toHaveURL((url) => url.pathname === home)
    }
    await expect(page.getByRole('textbox', { name: /Ask about your business/ })).toBeVisible()
  })

  test(`${persona}: the main navigation lists Home, Search, People and Integrations in that order`, async ({
    page,
  }) => {
    await signIn(page, email(), liveRoute('/home'))
    // Links is a Settings section, not a destination; People is on in the live environment.
    expect(await navLabels(page)).toEqual(['Home', 'Search', 'People', 'Integrations'])
  })
}
