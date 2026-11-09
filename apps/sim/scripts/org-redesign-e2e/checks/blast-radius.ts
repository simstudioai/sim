import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { workspaceEntry, workspacePath } from '@/platform/lib/workspace-navigation'
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
  org,
  refused,
  section,
  url,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  navigateWithinDocument,
  parkMouse,
  railLink,
  sidebar,
} from '@/scripts/org-redesign-e2e/locators'

/** The tabs every live workspace serves whatever the rollout flags say (`workspaceTabs`). */
const LIVE_WORKSPACE_TABS = ['Logs', 'Tables', 'Files', 'Knowledge bases', 'Workflows', 'Settings']
/** Reads only organization Home makes: its widgets and its activity chart. */
const HOME_READ = /\/home\/|\/usage\/activity/

const workspaceTabs = (page: Page) =>
  page.getByRole('navigation', { name: `${MEMBER_ADMIN_WORKSPACE.name} pages`, exact: true })
const workspaceLanding = workspacePath(MEMBER_ADMIN_WORKSPACE.id, 'workflows')

export async function blastRadiusChecks() {
  section('Blast radius')
  await check(
    'a workspace opens on Workflows in the shared shell, with its tabs and no Home reads',
    async () => {
      await withSession(ADMIN, async (session) => {
        const { page } = session
        await page.goto(url(workspaceEntry(MEMBER_ADMIN_WORKSPACE.id)))
        await expect(page).toHaveURL((address) => address.pathname === workspaceLanding)
        await expect(sidebar(page)).toBeVisible()
        const tabs = workspaceTabs(page)
        for (const label of LIVE_WORKSPACE_TABS)
          await expect(tabs.getByRole('link', { name: label, exact: true })).toBeVisible()
        // Issues has no backend, so live workspaces hide its tab (org-parity.md, "Issues").
        await expect(tabs.getByRole('link', { name: 'Issues', exact: true })).toHaveCount(0)
        await session.settle()
        assert.deepEqual(
          session.requests.filter(({ path }) => HOME_READ.test(path)),
          [],
          'A workspace page read organization Home data'
        )
      })
    }
  )
  await check(
    'client navigation from the organization to a workspace paints it as a fresh load does',
    async () => {
      const sample = (page: Page, tabsLabel: string) =>
        page.evaluate((tabsName) => {
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
            '--color-canvas',
            '--color-ink',
            '--color-secondary',
            '--color-boundary',
            '--color-selected',
            '--text-body',
            '--text-caption',
          ]
          const output: Record<string, string> = {}
          const surface = document.querySelector('[data-platform-ui]')
          const surfaceStyle = surface ? getComputedStyle(surface) : null
          for (const token of tokens)
            output[`surface ${token}`] = surfaceStyle?.getPropertyValue(token).trim() ?? ''
          for (const prop of props)
            output[`body ${prop}`] = getComputedStyle(document.body).getPropertyValue(prop)
          const seen = new Map<string, number>()
          const regions = [
            document.querySelector('[aria-label="Platform sidebar"]'),
            document.querySelector(`nav[aria-label="${CSS.escape(tabsName)}"]`),
          ]
          const controls = regions.flatMap((region) =>
            region
              ? Array.from(
                  region.querySelectorAll(
                    'a, button, input, textarea, [role="button"], h1, h2, p, span'
                  )
                )
              : []
          )
          for (const element of controls.slice(0, 200)) {
            const text = (element.textContent ?? '').trim().slice(0, 24)
            const base = `${element.tagName} ${element.getAttribute('aria-label') ?? text}`
            const count = seen.get(base) ?? 0
            seen.set(base, count + 1)
            const key = `${base} #${count}`
            const style = getComputedStyle(element)
            output[key] = props.map((prop) => style.getPropertyValue(prop)).join(' | ')
          }
          return output
        }, tabsLabel)
      const tabsLabel = `${MEMBER_ADMIN_WORKSPACE.name} pages`
      for (const theme of ['light', 'dark'] as const) {
        let fresh: Record<string, string> = {}
        await withSession(
          ADMIN,
          async (session) => {
            await session.page.goto(url(workspaceLanding))
            await expect(workspaceTabs(session.page)).toBeVisible()
            await session.settle()
            await parkMouse(session.page)
            fresh = await sample(session.page, tabsLabel)
          },
          { theme }
        )
        await withSession(
          ADMIN,
          async (session) => {
            const { page } = session
            for (const path of [
              org.simLinks,
              org.integrations,
              `${org.search}?mode=search`,
              org.home,
            ]) {
              await page.goto(url(path))
              await session.settle()
            }
            const inDocument = await navigateWithinDocument(page, () =>
              railLink(page, MEMBER_ADMIN_WORKSPACE.name).click()
            )
            await expect(page).toHaveURL((address) => address.pathname === workspaceLanding, {
              timeout: 45_000,
            })
            await expect(workspaceTabs(page)).toBeVisible()
            assert(await inDocument(), 'The move to the workspace reloaded the page')
            await session.settle()
            // The click that got here leaves the pointer over a rail row, which would read as hover.
            await parkMouse(page)
            await expect(sidebar(page).locator(':hover')).toHaveCount(0)
            const carried = await sample(page, tabsLabel)
            const differences = Object.keys(fresh)
              .filter((key) => key in carried && carried[key] !== fresh[key])
              .map((key) => `${key}: fresh ${fresh[key]} vs carried ${carried[key]}`)
            const comparedControls = Object.keys(fresh).filter(
              (key) => !key.startsWith('surface ') && !key.startsWith('body ') && key in carried
            )
            for (const label of LIVE_WORKSPACE_TABS)
              assert(
                comparedControls.some((key) => key.startsWith(`A ${label} #`)),
                `The comparison never reached the ${label} tab: ${comparedControls.join(', ')}`
              )
            assert(
              comparedControls.some((key) => key.startsWith(`A ${MEMBER_ADMIN_WORKSPACE.name} #`)),
              `The comparison never reached the sidebar's workspace row: ${comparedControls.join(', ')}`
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
      await page.goto(url(workspacePath(MEMBER_ADMIN_WORKSPACE.id, 'settings/connected-accounts')))
      await expect(page).toHaveURL(
        (address) => address.pathname === org.settingsSection('connected-accounts')
      )
      await expect(
        page.getByRole('heading', { level: 1, name: 'Credential Groups', exact: true })
      ).toBeVisible()
    })
  })
  await check('workspace settings never read an inbox the group withholds', async () => {
    await withSession(MEMBER, async (session) => {
      // Teammates is the workspace's default section; General moved to organization Settings.
      await session.page.goto(url(workspacePath(MEMBER_ADMIN_WORKSPACE.id, 'settings/teammates')))
      await expect(workspaceTabs(session.page)).toBeVisible()
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
        // The panel keeps its own composer, outside the product shell.
        await expect(page.getByRole('textbox', { name: 'Ask Sim' }))
          .toBeVisible()
          .catch((error) => {
            throw new Error(`${getErrorMessage(error)}\nConsole: ${consoleErrors.join('\n')}`)
          })
        await session.settle()
        await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        const home = session.requests.filter(({ path }) => HOME_READ.test(path))
        assert.deepEqual(home, [])
        await expect(page.getByRole('region', { name: 'Email', exact: true })).toHaveCount(0)
        const createLink = await page.goto(url('/extension/create-link'))
        assert.equal(createLink?.status(), 200, 'The create-link panel did not load')
        await session.settle()
        await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
      },
      { viewport: { name: 'panel', width: 400, height: 800 } }
    )
  })
  await check(
    '/sim, /sim-links, /invite, login and marketing have no platform surface',
    async () => {
      await withSession(MEMBER, async (session) => {
        const { page, context } = session
        await context.route(/^https:\/\/example\.com\//, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'stand-in' })
        )
        const member = [
          ['/sim/no-such-link', page.getByText("This link doesn't exist yet.")],
          ['/invite/not-a-token', page.getByText('Invitation Error')],
        ] as const
        for (const [path, anchor] of member) {
          await page.goto(url(path))
          await expect(anchor, `${path} rendered nothing`).toBeVisible()
          await session.settle()
          await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        }
      })
      await withSession(null, async (session) => {
        const { page } = session
        const signedOut = [
          ['/login', page.locator('#email')],
          ['/', page.getByRole('heading', { level: 1 }).first()],
          ['/platform', page.getByRole('heading', { level: 1, name: 'One AI workspace' })],
        ] as const
        for (const [path, anchor] of signedOut) {
          await page.goto(url(path))
          await expect(anchor, `${path} rendered nothing`).toBeVisible()
          await session.settle()
          await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
        }
      })
    },
    {
      // The link and the invitation this check opens that do not exist.
      allow: [
        refused(404, 'GET', '/sim/no-such-link'),
        refused(404, 'GET', '/api/invitations/not-a-token'),
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
