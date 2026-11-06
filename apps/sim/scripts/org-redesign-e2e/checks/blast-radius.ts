import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ADMIN,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  ORGANIZATION_ID,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  onHome,
  orgUrl,
  refused,
  section,
  url,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  composer,
  navigateWithinDocument,
  parkMouse,
  railLink,
} from '@/scripts/org-redesign-e2e/locators'

export async function blastRadiusChecks() {
  section('Blast radius')
  const workspaceHome = `/workspace/${MEMBER_ADMIN_WORKSPACE.id}/home`
  const WORKSPACE_RAIL_ROWS = ['Integrations', 'Tables', 'Files', 'Knowledge bases', 'Logs']
  await check('/workspace has no platform surface and its usual nav', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(url(workspaceHome))
      const rail = page.getByRole('complementary', { name: 'Workspace sidebar' })
      await expect(rail).toBeVisible()
      for (const label of WORKSPACE_RAIL_ROWS)
        await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible()
      await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
    })
  })
  await check(
    'client navigation from /o to /workspace leaves legacy controls unchanged',
    async () => {
      const sample = (page: Page) =>
        page.evaluate(() => {
          const props = [
            'font-family',
            'font-size',
            'font-weight',
            'line-height',
            'letter-spacing',
            'color',
            'background-color',
            'border-top-color',
            'border-top-width',
            'border-top-style',
            'border-top-left-radius',
            'padding-top',
            'padding-left',
            'height',
            'box-shadow',
            'outline-style',
          ]
          const tokens = [
            '--bg',
            '--surface-1',
            '--surface-3',
            '--text-primary',
            '--text-muted',
            '--border',
            '--font-sans',
            '--font-mono',
            '--color-border',
            '--color-accent',
            '--color-background',
            '--color-secondary',
            '--text-caption',
          ]
          const rootStyle = getComputedStyle(document.documentElement)
          const output: Record<string, string> = {}
          for (const token of tokens)
            output[`:root ${token}`] = rootStyle.getPropertyValue(token).trim()
          for (const prop of props)
            output[`body ${prop}`] = getComputedStyle(document.body).getPropertyValue(prop)
          const seen = new Map<string, number>()
          const rail = document.querySelector('[aria-label="Workspace sidebar"]')
          const controls = rail
            ? rail.querySelectorAll('a, button, input, textarea, [role="button"], h1, h2, p, span')
            : []
          for (const element of Array.from(controls).slice(0, 200)) {
            const text = (element.textContent ?? '').trim().slice(0, 24)
            const base = `${element.tagName} ${element.getAttribute('aria-label') ?? text}`
            const count = seen.get(base) ?? 0
            seen.set(base, count + 1)
            const key = `${base} #${count}`
            const style = getComputedStyle(element)
            output[key] = props.map((prop) => style.getPropertyValue(prop)).join(' | ')
          }
          return output
        })
      for (const theme of ['light', 'dark'] as const) {
        let fresh: Record<string, string> = {}
        await withSession(
          ADMIN,
          async (session) => {
            await session.page.goto(url(workspaceHome))
            await expect(
              session.page.getByRole('complementary', { name: 'Workspace sidebar' })
            ).toBeVisible()
            await session.settle()
            await parkMouse(session.page)
            fresh = await sample(session.page)
          },
          { theme }
        )
        await withSession(
          ADMIN,
          async (session) => {
            const { page } = session
            for (const path of ['links', 'integrations', 'search?mode=search', 'home']) {
              await page.goto(orgUrl(`/${path}`))
              await session.settle()
            }
            const inDocument = await navigateWithinDocument(page, () =>
              railLink(page, MEMBER_ADMIN_WORKSPACE.name).click()
            )
            await expect(page).toHaveURL(url(workspaceHome), { timeout: 45_000 })
            await expect(
              page.getByRole('complementary', { name: 'Workspace sidebar' })
            ).toBeVisible()
            assert(await inDocument(), 'The move to /workspace reloaded the page')
            await session.settle()
            await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
            // The click that got here leaves the pointer over a rail row, which would read as hover.
            await parkMouse(page)
            await expect(
              page.getByRole('complementary', { name: 'Workspace sidebar' }).locator(':hover')
            ).toHaveCount(0)
            const carried = await sample(page)
            const differences = Object.keys(fresh)
              .filter((key) => key in carried && carried[key] !== fresh[key])
              .map((key) => `${key}: fresh ${fresh[key]} vs carried ${carried[key]}`)
            const comparedControls = Object.keys(fresh).filter(
              (key) => !key.startsWith(':root ') && !key.startsWith('body ') && key in carried
            )
            for (const label of WORKSPACE_RAIL_ROWS)
              assert(
                comparedControls.some((key) => key.startsWith(`A ${label} #`)),
                `The comparison never reached the ${label} row: ${comparedControls.join(', ')}`
              )
            assert.deepEqual(
              differences,
              [],
              `${differences.length} computed styles moved in ${theme}`
            )
          },
          { theme }
        )
      }
    }
  )
  await check("a workspace's Credential groups link opens the organization's page", async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(url(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}/settings/connected-accounts`))
      await expect(page).toHaveURL(/\/o\/[^/]+\/settings\/connected-accounts/)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Credential groups', exact: true })
      ).toBeVisible()
    })
  })
  await check('workspace settings never read an inbox the group withholds', async () => {
    await withSession(MEMBER, async (session) => {
      await session.page.goto(url(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}/settings/general`))
      await expect(
        session.page.getByRole('complementary', { name: 'Workspace sidebar' })
      ).toBeVisible()
      await session.settle()
      assert.deepEqual(
        session.requests.filter(({ path }) => /^\/api\/workspaces\/[^/]+\/inbox/.test(path)),
        []
      )
    })
  })
  await check('the extension panel has no platform surface and reads no Home data', async () => {
    await withSession(
      MEMBER,
      async (session) => {
        const { page } = session
        // Opened outside the extension's frame, where a chrome-extension target has no meaning.
        await page.addInitScript(() => {
          const post = window.postMessage.bind(window)
          window.postMessage = ((...args: Parameters<typeof post>) => {
            if (!String(args[1]).startsWith('chrome-extension://')) post(...args)
          }) as typeof window.postMessage
        })
        const consoleErrors: string[] = []
        page.on('console', (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text())
        })
        await page.goto(url(`/extension/o/${ORGANIZATION_ID}`))
        await expect(composer(page))
          .toBeVisible()
          .catch((error) => {
            throw new Error(`${getErrorMessage(error)}\nConsole: ${consoleErrors.join('\n')}`)
          })
        await session.settle()
        await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        const home = session.requests.filter(({ path }) => /\/home\/|\/usage\/activity/.test(path))
        assert.deepEqual(home, [])
        await expect(page.getByRole('region', { name: 'Email', exact: true })).toHaveCount(0)
        await page.goto(url('/extension/create-link'))
        await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
      },
      { viewport: { name: 'panel', width: 400, height: 800 } }
    )
  })
  await check(
    '/sim, /sim-links, /invite, login and marketing have no platform surface',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route(/^https:\/\/example\.com\//, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'stand-in' })
        )
        for (const path of ['/sim/no-such-link', '/invite/not-a-token']) {
          await page.goto(url(path))
          await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        }
      })
      await withSession(null, async ({ page }) => {
        for (const path of ['/login', '/', '/platform']) {
          await page.goto(url(path))
          await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        }
      })
    },
    {
      // The three addresses this check opens that have nothing to show.
      allow: [
        refused(404, 'GET', '/sim/no-such-link'),
        refused(404, 'GET', '/invite/not-a-token'),
        refused(404, 'GET', '/platform'),
      ],
    }
  )
  await check('the surface defines its caption token without reaching :root', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const { onRoot, onSurface } = await page.evaluate(() => {
        const read = (element: Element | null) =>
          element ? getComputedStyle(element).getPropertyValue('--text-caption').trim() : null
        return {
          onRoot: read(document.documentElement),
          onSurface: read(document.querySelector('[data-platform-ui]')),
        }
      })
      assert(onSurface, 'Home mounts the surface, which defines the token')
      assert.notEqual(onRoot, onSurface, 'The surface token reached :root')
    })
  })
}
