import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { SETTINGS_FOR_ADMIN, SETTINGS_FOR_ALL } from '@/scripts/org-redesign-e2e/checks/settings'
import {
  ADMIN,
  ADMIN_CHATS,
  CONNECTED,
  GRANTS,
  MEMBER,
  MEMBER_CHATS,
  OWNER,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  artifactDirectory,
  beginWalk,
  DESKTOP,
  org,
  type Persona,
  PHONE,
  pathOf,
  record,
  routes,
  section,
  type Theme,
  url,
  type Viewport,
  WALK_CONCURRENCY,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import { composer, pageTurn } from '@/scripts/org-redesign-e2e/locators'
import { stubConnectedHome } from '@/scripts/org-redesign-e2e/stubs'

const settingsRoutes = (sections: readonly string[]) =>
  sections.map((section) => ({ name: `settings-${section}`, path: org.settingsSection(section) }))

interface WalkRoute {
  name: string
  path: string
}

/** Each persona's routes, as full paths from the organization's route builder. */
function routesFor(persona: Persona): WalkRoute[] {
  // Every member here may chat, so everyone has Home (org-parity.md, "Home page gate").
  const home: WalkRoute = { name: 'home', path: org.home }
  const shared: WalkRoute[] = [
    home,
    { name: 'search', path: `${org.search}?mode=search` },
    { name: 'search-empty-query', path: `${org.search}?mode=search&q=warranty` },
    { name: 'assistant', path: `${org.search}?mode=assistant` },
    { name: 'integrations', path: org.integrations },
    { name: 'integration-gmail', path: `${org.integrations}/gmail` },
    { name: 'integration-gitlab', path: `${org.integrations}/gitlab` },
    { name: 'generic-secrets', path: org.memberSecrets },
    { name: 'links', path: org.simLinks },
    { name: 'links-new', path: `${org.simLinks}?create=new-link` },
    ...settingsRoutes(SETTINGS_FOR_ALL),
  ]
  if (persona === MEMBER)
    return [...shared, { name: 'assistant-chat', path: org.searchChat(MEMBER_CHATS.assistant.id) }]
  if (persona === ADMIN || persona === OWNER)
    return [
      ...shared,
      ...(persona === ADMIN ? [{ name: 'agent-chat', path: org.chat(ADMIN_CHATS.agent.id) }] : []),
      ...settingsRoutes([...SETTINGS_FOR_ADMIN, 'search-mcp']),
    ]
  if (persona === CONNECTED)
    return [
      home,
      { name: 'integrations', path: org.integrations },
      { name: 'integration-gmail', path: `${org.integrations}/gmail` },
      {
        name: 'tool-permissions',
        path: `${org.integrations}/gmail?account=${GRANTS.gmail.credentialId}`,
      },
    ]
  return shared
}

/** Enough to name what a slow route was waiting on. */
const SLOWEST_READS = 5
/** How far a probe grows the viewport to see which panes follow it. */
const PANE_PROBE_PX = 200

/**
 * The app scrolls inside its own panes, so the viewport grows to what they hold before the shot. A
 * pane with a ceiling of its own, such as a Home widget's list, stays a scroller at any height and
 * shows no more for it: only the panes that follow the viewport count.
 */
async function viewportHolding(page: Page, viewport: Viewport) {
  const scrollers = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('body *'))
      .filter((element) => element.scrollHeight - element.clientHeight > 1)
      .map((element) => ({
        element,
        clientHeight: element.clientHeight,
        overflow: element.scrollHeight - element.clientHeight,
      }))
  )
  await page.setViewportSize({ width: viewport.width, height: viewport.height + PANE_PROBE_PX })
  await pageTurn(page)
  const overflow = await scrollers.evaluate((measured) =>
    measured
      .filter(({ element, clientHeight }) => element.clientHeight > clientHeight)
      .reduce((tallest, { overflow }) => Math.max(tallest, overflow), 0)
  )
  await scrollers.dispose()
  return Math.min(viewport.height + overflow, 3600)
}

export async function fullPageScreenshot(page: Page, path: string, viewport: Viewport) {
  const height = await viewportHolding(page, viewport)
  await page.setViewportSize({ width: viewport.width, height })
  await pageTurn(page)
  await page.screenshot({
    path,
    fullPage: true,
    animations: 'disabled',
    style: 'nextjs-portal { display: none; }',
    timeout: 20_000,
  })
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
}

/** Long enough for a persona's walk to list every route that failed. */
const WALK_ERROR_LIMIT = 16_000

async function walkOne(persona: Persona, viewport: Viewport, theme: Theme) {
  const name = `${persona.key} ${viewport.name} ${theme}: every route renders healthy`
  const started = performance.now()
  try {
    await withSession(
      persona,
      async (session) => {
        const { page } = session
        const failures: string[] = []
        if (persona === CONNECTED) await stubConnectedHome(page)
        for (const route of routesFor(persona)) {
          session.reads.length = 0
          const navigated = performance.now()
          const response = await page.goto(url(route.path), { timeout: 60_000 })
          const documentMs = Math.round(performance.now() - navigated)
          const contentReadyMs = await session.contentReady().catch((error) => {
            failures.push(`${route.name}: ${getErrorMessage(error)}`)
            return null
          })
          if (route.name === 'home')
            await composer(page)
              .waitFor({ timeout: 20_000 })
              .catch(() => failures.push('home never left its skeleton'))
          const screenshot = `${persona.key}__${route.name}__${viewport.name}__${theme}.png`
          const path = resolve(artifactDirectory, screenshot)
          await fullPageScreenshot(page, path, viewport)
            // A client redirect can land after the page has settled.
            .catch(() => session.settle().then(() => fullPageScreenshot(page, path, viewport)))
            .catch((error) => failures.push(`${route.name} screenshot: ${getErrorMessage(error)}`))
          const facts = await page.evaluate(() => ({
            // The surface follows the system appearance, so the painted canvas is what says dark.
            dark: (() => {
              const start = document.querySelector('main') ?? document.body
              for (let at: Element | null = start; at; at = at.parentElement) {
                const color = getComputedStyle(at).backgroundColor
                const channels = color.match(/[\d.]+/g)?.map(Number)
                const alpha = color.includes('/') ? channels?.at(-1) : channels?.[3]
                if (!channels || channels.length < 3 || alpha === 0) continue
                if (/^okl/.test(color)) return channels[0] < 0.5
                const scale = color.startsWith('color(') ? 255 : 1
                const [red, green, blue] = channels.map((channel) => channel * scale)
                return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 128
              }
              return false
            })(),
            font: getComputedStyle(document.body).fontFamily,
            overflow: document.documentElement.scrollWidth - innerWidth,
            surfaces: document.querySelectorAll('[data-platform-ui]').length,
            // The rail and page header paint on every route, so only the page's own text counts.
            text: (() => {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
              let length = 0
              while (walker.nextNode()) {
                const { parentElement, textContent } = walker.currentNode
                if (parentElement?.closest('aside, nav, header, script, style, noscript')) continue
                length += textContent?.trim().length ?? 0
              }
              return length
            })(),
          }))
          routes.push({
            persona: persona.key,
            route: route.path,
            viewport: viewport.name,
            theme,
            status: response?.status() ?? null,
            finalPath: pathOf(page.url()),
            screenshot,
            platformSurfaces: facts.surfaces,
            contentReadyMs,
            documentMs,
            slowestReads: [...session.reads].sort((a, b) => b.ms - a.ms).slice(0, SLOWEST_READS),
            readCount: session.reads.length,
          })
          if ((response?.status() ?? 500) >= 400)
            failures.push(`${route.name} status ${response?.status()}`)
          const expectedPathname = route.path.split('?')[0]
          if (new URL(page.url()).pathname !== expectedPathname)
            failures.push(`${route.name} landed on ${pathOf(page.url())}`)
          if (facts.dark !== (theme === 'dark')) failures.push(`${route.name} wrong theme`)
          if (/Times/.test(facts.font)) failures.push(`${route.name} has no stylesheet`)
          if (facts.overflow > 1) failures.push(`${route.name} overflows by ${facts.overflow}px`)
          if (facts.text === 0) failures.push(`${route.name} rendered an empty shell`)
          if (facts.surfaces === 0) failures.push(`${route.name} mounted no design-system surface`)
        }
        assert.deepEqual(failures, [])
      },
      { viewport, theme }
    )
    record(name, 'Route walk', started)
  } catch (error) {
    record(name, 'Route walk', started, truncate(getErrorMessage(error), WALK_ERROR_LIMIT))
  }
}

export async function walkRoutes(personas: Persona[]) {
  section('Route walk')
  beginWalk()
  const plan = personas.flatMap((persona) =>
    [DESKTOP, PHONE].flatMap((viewport) =>
      (['light', 'dark'] as const).map((theme) => ({ persona, viewport, theme }))
    )
  )
  await mapWithConcurrency(plan, WALK_CONCURRENCY, ({ persona, viewport, theme }) =>
    walkOne(persona, viewport, theme)
  )
}
