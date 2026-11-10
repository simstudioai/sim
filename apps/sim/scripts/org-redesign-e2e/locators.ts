import assert from 'node:assert/strict'
import type { Locator, Page, Request } from '@playwright/test'
import { waitUntilHydrated } from '@/platform/checks/test'
import { expect } from '@/scripts/org-redesign-e2e/harness'

declare global {
  interface Window {
    railWidths?: string[]
    sameDocumentMark?: boolean
  }
}

export const menuEntry = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name, exact: typeof name === 'string' })

/** The one product sidebar every organization and workspace page shares. */
export const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Platform sidebar' })
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
/**
 * The shared message composer on Home and in a chat. Its accessible name is its placeholder, which
 * changes with the mode and the turn, so it is found by the composer it sits in.
 */
export const composer = (page: Page) =>
  page.getByRole('main').locator('[data-elevation="composer"]').getByRole('textbox').first()
export const searchField = (page: Page) =>
  page.getByRole('search').getByRole('textbox', { name: 'Search', exact: true })
export const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })
export const orgChip = (page: Page) => page.getByRole('button', { name: 'Organization menu' })
export const orgCard = (page: Page) => dialog(page, 'Organization menu')
/** Opens a menu with one click once the page has hydrated: server-rendered markup has no handler. */
export async function openMenu(trigger: Locator, menu: Locator) {
  await hydrated(trigger.page())
  await trigger.click()
  await expect(menu).toBeVisible()
  return menu
}
export const openOrgCard = (page: Page) => openMenu(orgChip(page), orgCard(page))
/** Outside the sidebar, which has a section with the same name as Home's Workspaces. */
export const homeRegion = (page: Page, name: string) =>
  page.getByRole('main').getByRole('region', { name, exact: true })

/**
 * The destination rows, in order. The Workspaces and Chats sections share the Main navigation
 * landmark, each in its own region, so their rows are not destinations.
 */
export async function navLabels(page: Page) {
  const links = mainNav(page).getByRole('link')
  await expect(links.first()).toBeVisible()
  return links.evaluateAll((anchors) =>
    anchors
      .filter(
        (anchor): anchor is HTMLElement =>
          anchor instanceof HTMLElement && !anchor.closest('nav section')
      )
      .map((anchor) => anchor.innerText)
  )
}

export async function expectPageNotFound(page: Page) {
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
}

/** A rail row's link, named once: a workspace's avatar adds nothing to its name. */
export const railLink = (page: Page, label: string) =>
  sidebar(page).getByRole('link', { name: label, exact: true })

/** The footer's account control, named by the person it belongs to. */
export const accountChip = (page: Page, name: string) =>
  sidebar(page).locator('footer').getByRole('button', { name, exact: true })

/** The row around a rail link: its status glyph sits beside the link, not in it. */
export const railRow = (page: Page, label: string) =>
  sidebar(page)
    .locator('[data-action-side]')
    .filter({ has: page.getByRole('link', { name: label, exact: true }) })

/** A collapsible sidebar section: a region named for it, holding its disclosure. */
export const railRegion = (page: Page, name: string) =>
  sidebar(page).getByRole('region', { name, exact: true })
export const railSection = (page: Page, name: string) =>
  railRegion(page, name).locator('summary', { hasText: name })

/**
 * A chat's rail link, paging the Chats section with See more until it lists: the section shows a
 * page at a time by last activity, and chats seeded together share theirs, so their order is not
 * one to wait on.
 */
export async function revealRailChat(page: Page, title: string) {
  const chats = railRegion(page, 'Chats')
  const link = chats.getByRole('link', { name: title, exact: true })
  await expect(async () => {
    if ((await link.count()) === 0)
      await chats.getByRole('button', { name: 'See more', exact: true }).click({ timeout: 1_000 })
    await expect(link).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  return link
}

/** Opens a section row's options menu: the button appears on hover. */
export async function openRowMenu(page: Page, label: string) {
  const link = railLink(page, label)
  await link.hover()
  await sidebar(page)
    .getByRole('button', { name: `Actions for ${label}`, exact: true })
    .click()
  return page.getByRole('menu', { name: `Actions for ${label}` })
}

/**
 * Resolves once the route's prefetch has landed: a response arrived and none is outstanding. The
 * router can only show a loading boundary a prefetch already delivered, and it fetches a route in
 * several requests whose order and timing are its own.
 */
export function routePrefetched(page: Page, isPayload: (address: URL) => boolean) {
  let outstanding = 0
  let landed = 0
  const matches = (request: Request) =>
    isPayload(new URL(request.url())) && request.headers()['next-router-prefetch'] !== undefined
  page.on('request', (request) => {
    if (matches(request)) outstanding += 1
  })
  const finish = (request: Request) => {
    if (!matches(request)) return
    outstanding -= 1
    landed += 1
  }
  page.on('requestfinished', finish)
  page.on('requestfailed', finish)
  return () => expect.poll(() => landed > 0 && outstanding === 0).toBe(true)
}

export async function clipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

/**
 * Lets everything the last input scheduled run, so a request it caused has left by the time this
 * returns. How a check proves something did not happen, without guessing at a delay.
 */
export async function pageTurn(page: Page) {
  await page.evaluate(
    () => new Promise((settled) => requestAnimationFrame(() => setTimeout(settled)))
  )
}

/**
 * Waits until React has hydrated the whole document, then lets the effects that commit scheduled
 * run, so a press or click reaches the listener they attach.
 */
export async function hydrated(page: Page) {
  await waitUntilHydrated(page)
  await pageTurn(page)
}

/**
 * Runs a real navigation and returns a test that it stayed in the document: a full load drops the
 * mark, and these checks are about what a client navigation carries over.
 */
export async function navigateWithinDocument(page: Page, navigate: () => Promise<unknown>) {
  await page.evaluate(() => {
    window.sameDocumentMark = true
  })
  await navigate()
  return () => page.evaluate(() => window.sameDocumentMark)
}

/**
 * Rests the pointer on the page's far corner and lets any hover transition it ended finish, so two
 * captures of computed styles compare the same pointer state.
 */
export async function parkMouse(page: Page) {
  const size = page.viewportSize()
  assert(size, 'The page has a viewport')
  await page.mouse.move(size.width - 1, size.height - 1)
  await pageTurn(page)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => {}))
    )
  )
}

export async function assertNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, width } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: innerWidth,
  }))
  assert(scrollWidth <= width + 1, `${label} overflows: ${scrollWidth}px in ${width}px`)
}
