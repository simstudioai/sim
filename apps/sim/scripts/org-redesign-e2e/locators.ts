import assert from 'node:assert/strict'
import type { Locator, Page } from '@playwright/test'
import { expect } from '@/scripts/org-redesign-e2e/harness'

declare global {
  interface Window {
    railWidths?: string[]
    sameDocumentMark?: boolean
  }
}

export const menuEntry = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name, exact: typeof name === 'string' })

export const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: 'Organization sidebar' })
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
export const composer = (page: Page) => page.getByRole('textbox', { name: 'Ask Sim' })
export const searchField = (page: Page) =>
  page.getByRole('textbox', { name: 'Search your sources' })
export const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })
export const orgChip = (page: Page) => page.getByRole('button', { name: 'Organization menu' })
export const orgCard = (page: Page) => dialog(page, 'Organization menu')
/** Clicks until its menu opens, since a click that lands before the rail hydrates does nothing. */
export async function openMenu(trigger: Locator, menu: Locator) {
  await expect(async () => {
    await trigger.click()
    await expect(menu).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  return menu
}
export const openOrgCard = (page: Page) => openMenu(orgChip(page), orgCard(page))
/** Outside the sidebar, which has a section with the same name as Home's Workspaces. */
export const homeRegion = (page: Page, name: string) =>
  page.getByRole('main').getByRole('region', { name, exact: true })

export async function navLabels(page: Page) {
  const links = mainNav(page).getByRole('link')
  await expect(links.first()).toBeVisible()
  return links.allInnerTexts()
}

export async function expectPageNotFound(page: Page) {
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
}

/** A rail row's link, named once: a workspace's avatar adds nothing to its name. */
export const railLink = (page: Page, label: string) =>
  sidebar(page).getByRole('link', { name: label, exact: true })

export const accountChip = (page: Page) =>
  sidebar(page).getByRole('button', { name: /, account menu$/ })

/** The row around a rail link: its status glyph sits beside the link, not in it. */
export const railRow = (page: Page, label: string) =>
  sidebar(page)
    .locator('[data-action-side]')
    .filter({ has: page.getByRole('link', { name: label, exact: true }) })

export const railSection = (page: Page, name: string) =>
  sidebar(page).locator('summary', { hasText: name })

/** Opens a section row's options menu: the button appears on hover. */
export async function openRowMenu(page: Page, label: string) {
  const link = railLink(page, label)
  await link.hover()
  await sidebar(page)
    .getByRole('button', { name: `Actions for ${label}`, exact: true })
    .click()
  return page.getByRole('menu', { name: `Actions for ${label}` })
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
