import assert from 'node:assert/strict'
import type { Locator, Page } from '@playwright/test'
import { sleep } from '@sim/utils/helpers'
import {
  ADMIN,
  ADMIN_CHATS,
  CONNECTED,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  MEMBER_CHATS,
  MEMBER_WRITE_WORKSPACE,
  NARROW,
  ORGANIZATION_ID,
  ORGANIZATION_NAME,
  OWNER,
  STANDARD_GROUP_ID,
  WORKSPACES,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  notProvable,
  onHome,
  orgUrl,
  PHONE,
  pathOf,
  root,
  section,
  sql,
  url,
  withRestore,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import {
  accountChip,
  clipboard,
  composer,
  dialog,
  mainNav,
  menuEntry,
  navigateWithinDocument,
  navLabels,
  openRowMenu,
  orgCard,
  orgChip,
  railLink,
  railRow,
  railSection,
  sidebar,
} from '@/scripts/org-redesign-e2e/locators'
import { SIDEBAR_WIDTH } from '@/stores/constants'

export async function sidebarChecks() {
  section('2 Sidebar: nav')
  for (const persona of [MEMBER, ADMIN, OWNER, NARROW]) {
    await check(`${persona.key}: nav rows in today's order, plus Home for members`, async () => {
      await onHome(persona, async ({ page }) => {
        assert.deepEqual(await navLabels(page), ['Home', 'Search', 'Integrations', 'Links'])
      })
    })
  }
  await check('the current row is lit on descendants, and none on an agent chat', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl(`/search/chat/${ADMIN_CHATS.assistant.id}`))
      await expect(mainNav(page).getByRole('link', { name: 'Search' })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await page.goto(orgUrl(`/chat/${ADMIN_CHATS.agent.id}`))
      await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(0)
    })
  })
  await check(
    'right click on a nav row: Open in new tab and Copy link with the full URL',
    async () => {
      await onHome(MEMBER, async ({ page, context }) => {
        const row = mainNav(page).getByRole('link', { name: 'Links', exact: true })
        await row.click({ button: 'right' })
        await menuEntry(page, 'Copy link').click()
        await expect.poll(() => clipboard(page)).toBe(orgUrl('/links'))
        await row.click({ button: 'right' })
        const popup = context.waitForEvent('page')
        await menuEntry(page, 'Open in new tab').click()
        await expect(await popup).toHaveURL(orgUrl('/links'))
      })
    }
  )
  await check('hover warms Links and Integrations through their own reads', async () => {
    await withSession(MEMBER, async (session) => {
      const { page } = session
      await page.goto(orgUrl('/home'))
      await session.settle()
      session.requests.length = 0
      await mainNav(page).getByRole('link', { name: 'Links', exact: true }).hover()
      await expect
        .poll(() => session.requests.some(({ path }) => path.includes('/sim-links')))
        .toBe(true)
    })
  })

  section('2 Sidebar: rail chrome')
  await check(
    'collapse button and Mod+B toggle the icon rail, kept by cookie with no flash',
    async () => {
      await onHome(MEMBER, async ({ page, context }) => {
        const rail = sidebar(page)
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
        await expect(rail).toHaveAttribute('data-collapsed', 'true')
        await expect
          .poll(async () => Math.round((await rail.boundingBox())?.width ?? 0))
          .toBe(SIDEBAR_WIDTH.COLLAPSED)
        await expect
          .poll(
            async () => (await context.cookies()).find((c) => c.name === 'sidebar_collapsed')?.value
          )
          .toBe('1')
        const html = await (await context.request.get(orgUrl('/home'))).text()
        assert(/aria-label="Organization sidebar"/.test(html), 'The rail is in the document')
        assert(
          /data-collapsed="true"[^>]*aria-label="Organization sidebar"|aria-label="Organization sidebar"[^>]*data-collapsed="true"/.test(
            html
          ),
          'The server rendered it collapsed'
        )
        await page.reload()
        await expect(rail).toHaveAttribute('data-collapsed', 'true')
        await page.locator('body').click({ position: { x: 700, y: 20 } })
        await page.keyboard.press('Control+b')
        await expect(rail).not.toHaveAttribute('data-collapsed', 'true')
        await composer(page).click()
        await page.keyboard.press('Control+b')
        await expect(rail).not.toHaveAttribute('data-collapsed', 'true')
      })
    }
  )
  await check(
    'collapsed: tooltips name the rows, flyouts show every row, keyboard expands',
    async () => {
      await onHome(ADMIN, async ({ page }) => {
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
        await mainNav(page).getByRole('link', { name: 'Search', exact: true }).hover()
        await expect(page.getByRole('tooltip').filter({ hasText: 'Search' })).toBeVisible()
        await sidebar(page).getByRole('button', { name: 'Workspaces', exact: true }).hover()
        const flyout = dialog(page, 'Workspaces')
        await expect(flyout).toBeVisible()
        for (const { name } of WORKSPACES)
          await expect(flyout.getByText(name, { exact: true })).toBeVisible()
        await expect(flyout.getByText('New workspace')).toBeVisible()
        await page.mouse.move(800, 500)
        await sidebar(page).getByRole('button', { name: 'Chats', exact: true }).hover()
        const chats = dialog(page, 'Chats')
        await expect(chats.getByText(ADMIN_CHATS.agent.title)).toBeVisible()
        await page.mouse.move(800, 500)
        const edge = sidebar(page).getByRole('button', { name: 'Expand sidebar' }).last()
        await edge.focus()
        await page.keyboard.press('Enter')
        await expect(sidebar(page)).not.toHaveAttribute('data-collapsed', 'true')
      })
    }
  )
  await check('a collapsed member flyout omits New workspace', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      await sidebar(page).getByRole('button', { name: 'Workspaces', exact: true }).hover()
      const flyout = dialog(page, 'Workspaces')
      await expect(flyout.getByText(MEMBER_ADMIN_WORKSPACE.name)).toBeVisible()
      await expect(flyout.getByText('New workspace')).toHaveCount(0)
    })
  })
  for (const theme of ['light', 'dark'] as const) {
    await check(`Home and Links paint one canvas (${theme})`, async () => {
      await withSession(
        MEMBER,
        async ({ page }) => {
          const canvasBehind = (target: Locator) =>
            target.evaluate((node) => {
              for (let at: Element | null = node; at; at = at.parentElement) {
                const color = getComputedStyle(at).backgroundColor
                if (color !== 'rgba(0, 0, 0, 0)') return color
              }
              return null
            })
          await page.goto(orgUrl('/home'))
          const home = await canvasBehind(page.getByRole('heading', { name: /^Good / }))
          await page.goto(orgUrl('/links'))
          const links = await canvasBehind(page.getByRole('heading', { level: 1, name: 'Links' }))
          assert.equal(home, links)
        },
        { theme }
      )
    })
  }
  await check('dragging the edge resizes the rail', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const edge = sidebar(page).getByRole('separator', { name: 'Resize sidebar' })
      const before = (await sidebar(page).boundingBox())?.width ?? 0
      const box = await edge.boundingBox()
      assert(box, 'The edge is on screen')
      await page.mouse.move(box.x + box.width / 2, box.y + 200)
      await page.mouse.down()
      await page.mouse.move(box.x + 80, box.y + 200, { steps: 8 })
      await page.mouse.up()
      await expect
        .poll(async () => (await sidebar(page).boundingBox())?.width ?? 0)
        .toBeGreaterThan(before + 30)
    })
  })
  await check('arrow keys on the edge resize the rail, within its bounds', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const edge = sidebar(page).getByRole('separator', { name: 'Resize sidebar' })
      const width = async () => Math.round((await sidebar(page).boundingBox())?.width ?? 0)
      const before = await width()
      await expect(edge).toHaveAttribute('aria-valuenow', String(before))
      // Home's field takes focus once it mounts, which is after the rail: this waits it out.
      await expect(composer(page)).toBeFocused()
      await edge.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(width).toBe(before + 16)
      await expect(edge).toHaveAttribute('aria-valuenow', String(before + 16))
      await page.keyboard.press('ArrowLeft')
      await expect.poll(width).toBe(before)
      for (let press = 0; press < 20; press++) await page.keyboard.press('ArrowLeft')
      await expect.poll(width).toBe(SIDEBAR_WIDTH.MIN)
      await page.keyboard.press('Enter')
      await expect.poll(width).toBe(SIDEBAR_WIDTH.MIN)
    })
  })
  await check(
    'the rail opens at its design width and moves to and from /workspace with no frame between',
    async () => {
      const railWidths = (page: Page) => page.evaluate(() => window.railWidths ?? [])
      await withSession(ADMIN, async ({ page }) => {
        await page.addInitScript(() => {
          const seen = new Set<string>()
          const record = () => {
            for (const rail of document.querySelectorAll('aside[aria-label$=" sidebar"]')) {
              const width = Math.round(rail.getBoundingClientRect().width)
              if (width > 0) seen.add(`${rail.getAttribute('aria-label')}:${width}`)
            }
            window.railWidths = [...seen]
            requestAnimationFrame(record)
          }
          requestAnimationFrame(record)
        })
        await page.goto(orgUrl('/home'))
        await expect(sidebar(page)).toBeVisible()
        const inDocument = await navigateWithinDocument(page, () =>
          railLink(page, MEMBER_ADMIN_WORKSPACE.name).click()
        )
        await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible({
          timeout: 45_000,
        })
        assert(await inDocument(), 'The move to /workspace reloaded the page')
        await page.goBack()
        await expect(sidebar(page)).toBeVisible({ timeout: 45_000 })
        assert(await inDocument(), 'The move back to /o reloaded the page')
        await sleep(250)
        assert.deepEqual((await railWidths(page)).sort(), [
          `Organization sidebar:${SIDEBAR_WIDTH.ORGANIZATION_DEFAULT}`,
          `Workspace sidebar:${SIDEBAR_WIDTH.DEFAULT}`,
        ])
      })
    }
  )
  await check(
    'a dragged organization width is kept and leaves the workspace rail alone',
    async () => {
      await onHome(ADMIN, async ({ page }) => {
        const edge = sidebar(page).getByRole('separator', { name: 'Resize sidebar' })
        const box = await edge.boundingBox()
        assert(box, 'The edge is on screen')
        await page.mouse.move(box.x + box.width / 2, box.y + 200)
        await page.mouse.down()
        await page.mouse.move(340, box.y + 200, { steps: 8 })
        await page.mouse.up()
        const railWidth = async (rail: Locator) =>
          Math.round((await rail.boundingBox())?.width ?? 0)
        await expect.poll(() => railWidth(sidebar(page))).toBe(340)
        await page.reload()
        await expect.poll(() => railWidth(sidebar(page))).toBe(340)
        await page.goto(url(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}/home`))
        const workspaceRail = page.getByRole('complementary', { name: 'Workspace sidebar' })
        await expect.poll(() => railWidth(workspaceRail)).toBe(SIDEBAR_WIDTH.DEFAULT)
      })
    }
  )
  await check('a width saved before the organization default still applies', async () => {
    await onHome(ADMIN, async ({ page }) => {
      await page.evaluate(() =>
        localStorage.setItem('sidebar-state', JSON.stringify({ state: { sidebarWidth: 310 } }))
      )
      await page.reload()
      await expect
        .poll(async () => Math.round((await sidebar(page).boundingBox())?.width ?? 0))
        .toBe(310)
    })
  })
  await check('on a phone the rail is a drawer that opens and closes', async () => {
    await onHome(
      MEMBER,
      async ({ page }) => {
        await expect(composer(page)).toBeVisible()
        await expect(
          page.getByRole('button', { name: 'Collapse sidebar', exact: true })
        ).toBeHidden()
        const toggle = page.getByRole('button', { name: /open (sidebar|menu|navigation)/i }).first()
        await toggle.tap()
        await expect(mainNav(page).getByRole('link', { name: 'Links', exact: true })).toBeVisible()
        await mainNav(page).getByRole('link', { name: 'Links', exact: true }).tap()
        await expect(page).toHaveURL(orgUrl('/links'))
        await expect(page.getByRole('heading', { name: 'Links' })).toBeVisible()
      },
      { viewport: PHONE }
    )
  })
  await check('the rail swaps to Settings navigation and back', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/settings/general'))
      await expect(mainNav(page)).toHaveCount(0)
      await expect(sidebar(page).getByRole('link', { name: 'Members', exact: true })).toBeVisible()
      await sidebar(page).getByRole('button', { name: 'Back to app', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/home'))
      await expect(composer(page)).toBeVisible()
    })
  })
  notProvable('Hover peek on the macOS desktop app', 'Needs the packaged desktop app on macOS')
  notProvable('Impersonation banner', 'Needs an admin impersonation session')

  section('2 Sidebar: org card')
  await check(
    'chip names the organization; a member gets a read-only card with Settings',
    async () => {
      await onHome(MEMBER, async ({ page }) => {
        const chip = orgChip(page)
        await expect(chip).toContainText(ORGANIZATION_NAME)
        await chip.click()
        const card = orgCard(page)
        await expect(card.getByText(/\d+ members?/)).toBeVisible()
        await expect(card.getByRole('button', { name: 'Rename organization' })).toHaveCount(0)
        await expect(card.getByRole('button', { name: 'Change organization logo' })).toHaveCount(0)
        await expect(card.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
        await card.getByRole('button', { name: 'Settings', exact: true }).click()
        await expect(page).toHaveURL(orgUrl('/settings/members'))
      })
    }
  )
  await check('an admin renames inline: Enter saves, Escape cancels, and it survives reload', () =>
    withRestore(
      () => sql`update organization set name = ${ORGANIZATION_NAME} where id = ${ORGANIZATION_ID}`,
      () =>
        onHome(ADMIN, async ({ page }) => {
          const chip = orgChip(page)
          const card = orgCard(page)
          async function startRename() {
            await card.getByRole('button', { name: 'Rename organization' }).click()
            return card.getByRole('textbox', { name: 'Organization name' })
          }
          const renamed = `${ORGANIZATION_NAME} Group`
          await chip.click()
          const field = await startRename()
          await field.fill('Discarded name')
          await field.press('Escape')
          await expect(card.getByText(ORGANIZATION_NAME, { exact: true })).toBeVisible()
          const again = await startRename()
          await again.fill(renamed)
          await again.press('Enter')
          await expect(chip).toContainText(renamed)
          await page.reload()
          await expect(chip).toContainText(renamed)
          await chip.click()
          const restore = await startRename()
          await restore.fill(ORGANIZATION_NAME)
          await restore.press('Enter')
          await expect
            .poll(
              async () =>
                (await sql`select name from organization where id = ${ORGANIZATION_ID}`)[0]?.name
            )
            .toBe(ORGANIZATION_NAME)
          await expect(chip).toContainText(ORGANIZATION_NAME)
        })
    )
  )
  await check(
    'a failed rename shows inline and holds the menu open',
    async () => {
      await withSession(ADMIN, async ({ page }) => {
        await page.route(`**/api/organizations/${ORGANIZATION_ID}`, (route) =>
          route.request().method() === 'PATCH' || route.request().method() === 'PUT'
            ? route.fulfill({ status: 400, json: { error: 'That name is taken' } })
            : route.continue()
        )
        await page.goto(orgUrl('/home'))
        await orgChip(page).click()
        const card = orgCard(page)
        await card.getByRole('button', { name: 'Rename organization' }).click()
        const field = card.getByRole('textbox', { name: 'Organization name' })
        await field.fill('Taken name')
        await field.press('Enter')
        await expect(card.getByRole('alert')).toBeVisible()
        await expect(card).toBeVisible()
      })
    },
    { allow: [/400 (PATCH|PUT) \/api\/organizations\//] }
  )
  await check('an admin can change the logo from the card', () =>
    withRestore(
      () => sql`update organization set logo = null where id = ${ORGANIZATION_ID}`,
      () =>
        onHome(ADMIN, async ({ page }) => {
          await orgChip(page).click()
          const card = orgCard(page)
          await expect(card.getByRole('button', { name: 'Change organization logo' })).toBeEnabled()
          const started = page.waitForResponse(
            (response) =>
              response.request().method() === 'POST' &&
              pathOf(response.url()) === '/api/files/uploads'
          )
          await page.getByLabel('Organization logo').setInputFiles({
            name: 'logo.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              'base64'
            ),
          })
          const response = await started
          assert(
            response.ok(),
            `Starting the upload answered ${response.status()}: ${await response.text()}`
          )
          await expect
            .poll(
              async () =>
                (await sql`select logo from organization where id = ${ORGANIZATION_ID}`)[0]?.logo
            )
            .toBeTruthy()
        })
    )
  )
  await check('Invite follows the default group, and an admin invites when it allows', async () => {
    await onHome(ADMIN, async ({ page }) => {
      await orgChip(page).click()
      await expect(orgCard(page).getByRole('button', { name: 'Invite', exact: true })).toHaveCount(
        0
      )
      await sql`update permission_group set config = config - 'disableInvitations' where id = ${STANDARD_GROUP_ID}`
      await page.reload()
      await orgChip(page).click()
      await orgCard(page).getByRole('button', { name: 'Invite', exact: true }).click()
      const modal = dialog(page, 'Invite people')
      await expect(modal).toBeVisible()
      const field = modal.getByRole('textbox', { name: 'Email addresses' })
      await field.fill(`invitee@org-redesign.test`)
      await field.press('Enter')
      await expect(
        modal.getByRole('combobox', { name: 'Role' }).or(modal.getByLabel('Role'))
      ).toBeVisible()
      await field.fill('refused@org-redesign.test')
      await field.press('Enter')
      await expect(modal.getByRole('button', { name: 'Send invites' })).toBeEnabled()
      await page.route('**/api/workspaces/invitations/batch', (route) =>
        route.fulfill({
          json: {
            success: false,
            successful: ['invitee@org-redesign.test'],
            added: [],
            failed: [{ email: 'refused@org-redesign.test', error: 'Seat limit reached' }],
            invitations: [],
          },
        })
      )
      await modal.getByRole('button', { name: 'Send invites' }).click()
      await expect(modal.getByRole('alert')).toBeVisible()
      await expect(modal.getByText('refused@org-redesign.test')).toBeVisible()
      await expect(modal.getByText('invitee@org-redesign.test')).toHaveCount(0)
      await modal.getByRole('button', { name: 'Cancel' }).click()
      await expect(modal).toHaveCount(0)
    }).finally(
      () =>
        sql`update permission_group set config = config || '{"disableInvitations":true}'::jsonb where id = ${STANDARD_GROUP_ID}`
    )
  })

  section('2 Sidebar: workspaces')
  await check('a member sees only their workspaces; + is disabled and says why', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })
      ).toBeVisible()
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_WRITE_WORKSPACE.name })
      ).toBeVisible()
      await expect(railLink(page, 'Finance')).toHaveCount(0)
      await expect(
        sidebar(page).getByRole('button', {
          name: /Only organization owners and admins can create organization workspaces/,
        })
      ).toBeDisabled()
    })
  })
  await check('no workspaces says so', async () => {
    await onHome(NARROW, async ({ page }) => {
      await expect(sidebar(page).getByText('No workspaces yet')).toBeVisible()
    })
  })
  await check('an admin pages through workspaces and the section collapses', async () => {
    await onHome(ADMIN, async ({ page }) => {
      const rail = sidebar(page)
      await expect(rail.getByRole('link', { name: WORKSPACES[4].name })).toBeVisible()
      await expect(rail.getByRole('link', { name: WORKSPACES[6].name })).toHaveCount(0)
      await rail.getByRole('button', { name: 'See more' }).click()
      await expect(rail.getByRole('link', { name: WORKSPACES[6].name })).toBeVisible()
      await rail.getByRole('button', { name: 'See less' }).click()
      await expect(rail.getByRole('link', { name: WORKSPACES[6].name })).toHaveCount(0)
      await railSection(page, 'Workspaces').click()
      await expect(railLink(page, WORKSPACES[0].name)).toBeHidden()
    })
  })
  await check(
    'workspace menu: Open in new tab, Pin, Rename gated, nothing destructive',
    async () => {
      await onHome(MEMBER, async ({ page, context }) => {
        const writeMenu = await openRowMenu(page, MEMBER_WRITE_WORKSPACE.name)
        await expect(menuEntry(page, 'Rename')).toBeDisabled()
        await expect(writeMenu.getByRole('menuitem')).toHaveText([
          'Open in new tab',
          'Pin',
          'Rename',
        ])
        await page.keyboard.press('Escape')
        await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
        await expect(menuEntry(page, 'Rename')).toBeEnabled()
        await menuEntry(page, 'Pin').click()
        await expect(
          railRow(page, MEMBER_ADMIN_WORKSPACE.name).getByRole('img', { name: 'Pinned' })
        ).toBeVisible()
        await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
        await menuEntry(page, 'Unpin').click()
        await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
        const popup = context.waitForEvent('page')
        await menuEntry(page, 'Open in new tab').click()
        await expect(await popup).toHaveURL((address) =>
          address.pathname.startsWith(`/workspace/${MEMBER_ADMIN_WORKSPACE.id}`)
        )
      })
    }
  )
  await check('an admin creates a workspace and enters it', () =>
    withRestore(
      () => sql`delete from workspace where name = 'Created in acceptance'`,
      () =>
        onHome(ADMIN, async ({ page }) => {
          await sidebar(page).getByRole('button', { name: 'New workspace', exact: true }).click()
          const modal = dialog(page, 'Create workspace')
          await modal.getByRole('textbox', { name: 'Name' }).fill('Created in acceptance')
          await modal.getByRole('button', { name: 'Create', exact: true }).click()
          await expect(page).toHaveURL((address) => address.pathname.startsWith('/workspace/'), {
            timeout: 45_000,
          })
        })
    )
  )
  await check('rename a workspace from its menu', () =>
    withRestore(
      () =>
        sql`update workspace set name = ${MEMBER_ADMIN_WORKSPACE.name} where id = ${MEMBER_ADMIN_WORKSPACE.id}`,
      () =>
        onHome(MEMBER, async ({ page }) => {
          await openRowMenu(page, MEMBER_ADMIN_WORKSPACE.name)
          await menuEntry(page, 'Rename').click()
          const modal = dialog(page, 'Rename workspace')
          const field = modal.getByRole('textbox', { name: 'Name' })
          await field.fill('Operations East')
          await modal.getByRole('button', { name: 'Save', exact: true }).click()
          await expect(sidebar(page).getByRole('link', { name: 'Operations East' })).toBeVisible()
          await openRowMenu(page, 'Operations East')
          await menuEntry(page, 'Rename').click()
          await dialog(page, 'Rename workspace')
            .getByRole('textbox', { name: 'Name' })
            .fill(MEMBER_ADMIN_WORKSPACE.name)
          await dialog(page, 'Rename workspace')
            .getByRole('button', { name: 'Save', exact: true })
            .click()
          await expect(
            sidebar(page).getByRole('link', { name: MEMBER_ADMIN_WORKSPACE.name })
          ).toBeVisible()
        })
    )
  )

  section('2 Sidebar: chats')
  await check('rows link by mode, and an empty list says so', async () => {
    await onHome(MEMBER, async ({ page }) => {
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_CHATS.assistant.title })
      ).toHaveAttribute('href', `${root}/search/chat/${MEMBER_CHATS.assistant.id}`)
    })
    await onHome(ADMIN, async ({ page }) => {
      await expect(
        sidebar(page).getByRole('link', { name: ADMIN_CHATS.agent.title })
      ).toHaveAttribute('href', `${root}/chat/${ADMIN_CHATS.agent.id}`)
    })
    await onHome(NARROW, async ({ page }) => {
      await expect(sidebar(page).getByText('No chats yet')).toBeVisible()
    })
  })
  await check('unread dot, hidden on the chat itself; Mark as read and unread work', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const row = railRow(page, MEMBER_CHATS.unread.title)
      await expect(row.getByRole('img', { name: 'Unread' })).toBeVisible()
      await openRowMenu(page, MEMBER_CHATS.unread.title)
      await menuEntry(page, 'Mark as read').click()
      await expect(row.getByRole('img', { name: 'Unread' })).toHaveCount(0)
      await openRowMenu(page, MEMBER_CHATS.unread.title)
      await menuEntry(page, 'Mark as unread').click()
      await expect(row.getByRole('img', { name: 'Unread' })).toBeVisible()
      await railLink(page, MEMBER_CHATS.unread.title).click()
      await expect(page).toHaveURL(
        (address) => address.pathname === `${root}/search/chat/${MEMBER_CHATS.unread.id}`
      )
      await expect(row.getByRole('img', { name: 'Unread' })).toHaveCount(0)
    })
  })
  await check('menu: Copy link, Pin, Rename inline, right click opens the same menu', () =>
    withRestore(
      () =>
        sql`update copilot_chats set title = ${MEMBER_CHATS.assistant.title} where id = ${MEMBER_CHATS.assistant.id}`,
      () =>
        onHome(MEMBER, async ({ page, context }) => {
          const title = MEMBER_CHATS.assistant.title
          const row = railLink(page, title)
          await row.click({ button: 'right' })
          await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
            'Open in new tab',
            'Copy link',
            'Mark as unread',
            'Pin',
            'Rename',
            'Delete',
          ])
          await menuEntry(page, 'Copy link').click()
          await expect
            .poll(() => clipboard(page))
            .toBe(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
          await openRowMenu(page, title)
          await menuEntry(page, 'Pin').click()
          await expect(railRow(page, title).getByRole('img', { name: 'Pinned' })).toBeVisible()
          await openRowMenu(page, title)
          await menuEntry(page, 'Unpin').click()
          await openRowMenu(page, title)
          await menuEntry(page, 'Rename').click()
          const modal = dialog(page, 'Rename chat')
          await modal.getByRole('textbox', { name: 'Chat name' }).fill(`${title} renamed`)
          await modal.getByRole('button', { name: 'Save', exact: true }).click()
          await expect(sidebar(page).getByRole('link', { name: `${title} renamed` })).toBeVisible()
          await openRowMenu(page, `${title} renamed`)
          const popup = context.waitForEvent('page')
          await menuEntry(page, 'Open in new tab').click()
          await expect(await popup).toHaveURL(orgUrl(`/search/chat/${MEMBER_CHATS.assistant.id}`))
          await openRowMenu(page, `${title} renamed`)
          await menuEntry(page, 'Rename').click()
          await modal.getByRole('textbox', { name: 'Chat name' }).fill(title)
          await modal.getByRole('button', { name: 'Save', exact: true }).click()
          await expect(sidebar(page).getByRole('link', { name: title, exact: true })).toBeVisible()
        })
    )
  )
  await check('deleting the open chat returns to where its mode lives', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl(`/search/chat/${MEMBER_CHATS.removable.id}`))
      await openRowMenu(page, MEMBER_CHATS.removable.title)
      await menuEntry(page, 'Delete').click()
      const modal = dialog(page, 'Delete chat')
      await expect(modal.getByText(MEMBER_CHATS.removable.title)).toBeVisible()
      await modal.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page).toHaveURL((address) => address.pathname === `${root}/search`)
      await expect(
        sidebar(page).getByRole('link', { name: MEMBER_CHATS.removable.title })
      ).toHaveCount(0)
    })
  })
  await check(
    'shift click selects a range, background click clears, bulk delete keeps failed rows',
    async () => {
      await onHome(MEMBER, async ({ page }) => {
        const first = sidebar(page).getByRole('link', { name: MEMBER_CHATS.bulkOne.title })
        const second = sidebar(page).getByRole('link', { name: MEMBER_CHATS.bulkTwo.title })
        await first.click({ modifiers: ['Shift'] })
        await second.click({ modifiers: ['Shift'] })
        await second.click({ button: 'right' })
        await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Delete 2 chats'])
        await page.keyboard.press('Escape')
        await sidebar(page)
          .locator('nav')
          .first()
          .evaluate((node) => node.parentElement?.click())
        await second.click({ button: 'right' })
        await expect(page.getByRole('menu').getByRole('menuitem').last()).toHaveText('Delete')
        await page.keyboard.press('Escape')
        await first.click({ modifiers: ['Shift'] })
        await page.route(`**/api/mothership/chats/${MEMBER_CHATS.bulkTwo.id}`, (route) =>
          route.request().method() === 'DELETE'
            ? route.fulfill({ status: 500, json: { error: 'No' } })
            : route.continue()
        )
        await second.click({ button: 'right' })
        await menuEntry(page, 'Delete 2 chats').click()
        const modal = dialog(page, 'Delete 2 chats')
        await modal.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(first).toHaveCount(0)
        await expect(second).toBeVisible()
        await expect(dialog(page, 'Delete chat')).toBeVisible()
        await page.unrouteAll()
        await dialog(page, 'Delete chat')
          .getByRole('button', { name: 'Delete', exact: true })
          .click()
        await expect(second).toHaveCount(0)
      })
    },
    { allow: [/500 DELETE \/api\/mothership\/chats\//] }
  )

  section('2 Sidebar: footer')
  await check('account chip and menu: Settings and Sign out', async () => {
    await onHome(MEMBER, async ({ page }) => {
      const chip = accountChip(page)
      await expect(chip).toContainText(MEMBER.name)
      await expect(chip).toHaveAccessibleName(`${MEMBER.name}, account menu`)
      await chip.click()
      const menu = dialog(page, 'Account menu')
      await expect(menu.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
      await menu.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(page).toHaveURL(orgUrl('/settings/general'))
    })
  })
  await check('sign out ends the session', () =>
    withRestore(
      () => sql`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${`org-redesign-session-row-${CONNECTED.key}`}, ${CONNECTED.sessionToken}, ${CONNECTED.userId}, ${ORGANIZATION_ID}, now() + interval '1 day', now(), now())
      on conflict (id) do nothing`,
      () =>
        onHome(CONNECTED, async ({ page }) => {
          await accountChip(page).click()
          await dialog(page, 'Account menu')
            .getByRole('button', { name: 'Sign out', exact: true })
            .click()
          await expect(page).toHaveURL(
            (address) => address.pathname === '/login' || address.pathname === '/',
            { timeout: 30_000 }
          )
        })
    )
  )
  await check(
    'Help menu: Documentation, Join Slack, and a support request posted with its fields',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route(/docs\.sim\.ai|sim\.ai\/slack|slack\.com/, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'stand-in' })
        )
        await page.goto(orgUrl('/home'))
        const help = sidebar(page).getByRole('button', { name: 'Help', exact: true })
        await help.click()
        await expect(menuEntry(page, 'Join Slack')).toBeVisible()
        const docs = context.waitForEvent('page')
        await menuEntry(page, 'Documentation').click()
        await (await docs).close()
        await help.click()
        await menuEntry(page, 'Contact support').click()
        const modal = dialog(page, 'Contact support')
        await page.route('**/api/help', (route) =>
          route.fulfill({ status: 200, json: { success: true } })
        )
        await modal.getByRole('textbox', { name: 'Subject' }).fill('A question')
        await modal.getByRole('textbox', { name: 'Message' }).fill('The details')
        const sent = page.waitForRequest((request) => request.url().endsWith('/api/help'))
        await modal.getByRole('button', { name: 'Send', exact: true }).click()
        const request = await sent
        assert.match(request.headers()['content-type'] ?? '', /multipart\/form-data/)
        const posted = request.postData() ?? ''
        assert.match(posted, /A question/, 'The request carries its subject')
        assert.match(posted, /The details/, 'The request carries its message')
        await expect(modal).toHaveCount(0)
      })
    }
  )
  await check('Help menu: the macOS app is offered on a Mac browser only', async () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    for (const [userAgent, offered] of [
      [mac, 1],
      [windows, 0],
    ] as const) {
      await withSession(MEMBER, async ({ page }) => {
        await page.addInitScript((agent) => {
          Object.defineProperty(navigator, 'userAgent', { get: () => agent })
        }, userAgent)
        await page.goto(orgUrl('/home'))
        await sidebar(page).getByRole('button', { name: 'Help', exact: true }).click()
        await expect(menuEntry(page, 'Contact support')).toBeVisible()
        await expect(menuEntry(page, 'Download apps')).toHaveCount(offered)
      })
    }
  })
  notProvable(
    'Help menu: desktop update row',
    'Needs the packaged desktop app with an update pending'
  )
}
