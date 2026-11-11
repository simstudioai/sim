import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { organizationRoutes, simLinkPath } from '@/lib/navigation/paths'
import {
  ADMIN,
  LINK_COUNT,
  MEMBER,
  NAMED_LINKS,
  ORGANIZATION_ID,
  OUTSIDE_ORGANIZATION_ID,
  OUTSIDER,
} from '@/scripts/org-redesign-e2e/fixture'
import {
  check,
  expect,
  org,
  PHONE,
  refused,
  section,
  sql,
  url,
  withRestore,
  withSession,
  withTableHidden,
} from '@/scripts/org-redesign-e2e/harness'
import {
  assertNoHorizontalOverflow,
  clipboard,
  dialog,
  menuEntry,
  pageTurn,
  routePrefetched,
  sidebar,
} from '@/scripts/org-redesign-e2e/locators'

export async function linksChecks() {
  /** Links is a Settings section; `/links` only redirects here. */
  const linksUrl = url(org.simLinks)
  const rowFor = (page: Page, name: string) =>
    page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
  const search = (page: Page) => page.getByRole('searchbox', { name: 'Search links' })
  const removeLink = (name: string) =>
    sql`delete from sim_link where organization_id = ${ORGANIZATION_ID} and name = ${name}`

  section('3 Links')
  await check('a phone keeps every fact of a link, with Restricted in view', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(linksUrl)
        const row = rowFor(page, NAMED_LINKS.restricted.name)
        await expect(
          row.getByText(NAMED_LINKS.restricted.url, { exact: true }).first()
        ).toBeVisible()
        await expect(
          row.getByText(NAMED_LINKS.restricted.description, { exact: true }).first()
        ).toBeVisible()
        await expect(row.getByText(/^Restricted · /)).toBeVisible()
        const columns = await page.getByRole('columnheader').allInnerTexts()
        assert(!columns.join().includes('Created by'), `Columns ${columns}`)
        const [nameCell, list] = [
          await row.getByRole('cell').first().boundingBox(),
          await page.getByRole('region', { name: 'Links' }).boundingBox(),
        ]
        assert(nameCell && list, 'The row and the list are on screen')
        assert(
          nameCell.width > list.width / 2,
          `With 183 links windowed, Name is ${nameCell.width} of ${list.width}`
        )
      },
      { viewport: PHONE }
    )
  })
  await check('the API serves every link the member can see', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(linksUrl)
      let names: string[] = []
      let cursor: string | undefined
      do {
        const response = await page.request.get(
          url(
            `/api/organizations/${ORGANIZATION_ID}/sim-links${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
          )
        )
        const body = await response.json()
        names = [...names, ...body.links.map((link: { name: string }) => link.name)]
        cursor = body.nextCursor ?? undefined
      } while (cursor)
      const [{ count }] = await sql`select count(*)::int as count from sim_link
        where organization_id = ${ORGANIZATION_ID} and name <> ${NAMED_LINKS.unlisted.name}`
      assert.equal(names.length, count, 'Everything but another person’s unlisted link')
      assert(count >= LINK_COUNT - 1, 'The fixture lost links')
      assert(!names.includes(NAMED_LINKS.unlisted.name))
    })
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(linksUrl)
      await search(page).fill(NAMED_LINKS.unlisted.name)
      await expect(rowFor(page, NAMED_LINKS.unlisted.name)).toContainText('Unlisted')
      await search(page).fill(NAMED_LINKS.restricted.name)
      await expect(rowFor(page, NAMED_LINKS.restricted.name)).toContainText('Restricted')
    })
  })
  await check(
    'search over name and description, sim/ prefix, debounce, URL, and Clear',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(linksUrl)
        await search(page).fill('sim/handbook')
        await expect(page).toHaveURL(
          (address) => address.searchParams.get('search') === 'sim/handbook'
        )
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        await expect(rowFor(page, 'resource-001')).toHaveCount(0)
        await search(page).fill('Weekly hours')
        await expect(rowFor(page, NAMED_LINKS.mostUsed.name)).toBeVisible()
        await search(page).fill('zzzz-nothing')
        await expect(page.getByText('Searched every link you can see.')).toBeVisible()
        await page.getByRole('button', { name: 'Clear search', exact: true }).last().click()
        await expect(search(page)).toHaveValue('')
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        await page.goto(`${linksUrl}?search=timesheet`)
        await expect(search(page)).toHaveValue('timesheet')
        await expect(rowFor(page, NAMED_LINKS.mostUsed.name)).toBeVisible()
      })
    }
  )
  await check(
    'sort by Opens, with direction in the URL, and clearing returns to name',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(linksUrl)
        await page.getByRole('button', { name: 'Sort', exact: true }).click()
        await expect(menuEntry(page, 'Name')).toBeVisible()
        await menuEntry(page, 'Opens').click()
        await expect(page).toHaveURL((address) => address.searchParams.get('sort') === 'popular')
        await expect(page.getByRole('button', { name: 'Sort: Opens' })).toBeVisible()
        await expect(page.getByRole('row').nth(1)).toContainText(NAMED_LINKS.mostUsed.name)
        await page.getByRole('button', { name: 'Sort: Opens' }).click()
        await menuEntry(page, 'Clear sort').click()
        await expect(page).toHaveURL((address) => address.searchParams.get('sort') === null)
      })
    }
  )
  await check(
    'row click opens sim/name in a new tab, not an editor; right click and kebab menus',
    async () => {
      await withSession(MEMBER, async ({ page, context }) => {
        await context.route(/^https:\/\/(example\.com|payroll\.example\.com)\//, (route) =>
          route.fulfill({ status: 200, contentType: 'text/html', body: 'destination stand-in' })
        )
        await page.goto(`${linksUrl}?search=handbook`)
        const row = rowFor(page, NAMED_LINKS.handbook.name)
        const popup = context.waitForEvent('page')
        await row.getByText(NAMED_LINKS.handbook.name, { exact: true }).click()
        const opened = await popup
        await opened.waitForLoadState('domcontentloaded')
        assert(/handbook/.test(opened.url()), `Opened ${opened.url()}`)
        await opened.close()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await row.click({ button: 'right' })
        await expect(
          page.getByRole('menu', { name: 'Link actions' }).getByRole('menuitem')
        ).toHaveText(['Open', 'Copy link', 'Edit', 'Delete'])
        await menuEntry(page, 'Copy link').click()
        await expect.poll(() => clipboard(page)).toBe(url(simLinkPath(NAMED_LINKS.handbook.name)))
        await expect(page.getByText('Link copied')).toBeVisible()
        await row.getByRole('button', { name: `${NAMED_LINKS.handbook.name} actions` }).click()
        await expect(menuEntry(page, 'Edit')).toBeVisible()
      })
    }
  )
  await check('a restricted link gives a member only Open and Copy link', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(`${linksUrl}?search=${NAMED_LINKS.restricted.name}`)
      await rowFor(page, NAMED_LINKS.restricted.name).click({ button: 'right' })
      await expect(
        page.getByRole('menu', { name: 'Link actions' }).getByRole('menuitem')
      ).toHaveText(['Open', 'Copy link'])
    })
  })
  await check('canEdit without canManage: edits save while Access stays disabled, with why', () =>
    withRestore(
      () =>
        sql`update sim_link set description = ${NAMED_LINKS.handbook.description} where organization_id = ${ORGANIZATION_ID} and name = ${NAMED_LINKS.handbook.name}`,
      () =>
        withSession(MEMBER, async ({ page }) => {
          await page.goto(`${linksUrl}?search=${NAMED_LINKS.handbook.name}`)
          await rowFor(page, NAMED_LINKS.handbook.name).click({ button: 'right' })
          await menuEntry(page, 'Edit').click()
          const modal = dialog(page, `Edit ${NAMED_LINKS.handbook.name}`)
          const unlisted = modal.getByRole('checkbox', { name: 'Hide from the links page' })
          await expect(unlisted).toBeDisabled()
          await unlisted.hover()
          await expect(
            page.getByRole('tooltip', {
              name: 'Only the creator or an organization admin can change access.',
            })
          ).toBeVisible()
          await expect(
            modal.getByRole('checkbox', { name: 'Only the creator and admins can edit' })
          ).toBeDisabled()
          await modal.getByRole('textbox', { name: 'Description' }).fill('The company handbook')
          await modal.getByRole('button', { name: 'Save', exact: true }).click()
          await expect(modal).toHaveCount(0)
          await expect(rowFor(page, NAMED_LINKS.handbook.name)).toContainText(
            'The company handbook'
          )
        })
    )
  )
  await check(
    'create: field order, normalized name, variable destination, conflict on Name',
    () =>
      withRestore(
        () => removeLink('parts-lookup'),
        () =>
          withSession(MEMBER, async ({ page }) => {
            await page.goto(linksUrl)
            await page.getByRole('button', { name: 'New link', exact: true }).first().click()
            await expect(page).toHaveURL((address) => address.searchParams.has('create'))
            const modal = dialog(page, 'New link')
            const fields = await modal
              .getByRole('textbox')
              .evaluateAll((nodes) =>
                nodes.map(
                  (node) =>
                    node.getAttribute('aria-label') ??
                    node.closest('label')?.textContent ??
                    (node as HTMLInputElement).labels?.[0]?.textContent ??
                    ''
                )
              )
            assert(fields[0]?.startsWith('Destination URL'), `Fields ${fields}`)
            assert(fields[1]?.startsWith('Name'), `Fields ${fields}`)
            assert(fields[2]?.startsWith('Description'), `Fields ${fields}`)
            await expect(modal.getByRole('textbox', { name: 'Default destination' })).toHaveCount(0)
            await modal
              .getByRole('textbox', { name: 'Destination URL' })
              .fill('https://parts.example.com/{*}')
            await expect(modal.getByRole('textbox', { name: 'Default destination' })).toBeVisible()
            await modal
              .getByRole('textbox', { name: 'Default destination' })
              .fill('https://parts.example.com')
            await modal.getByRole('textbox', { name: 'Name' }).fill('Hand Book')
            await expect(modal.getByRole('textbox', { name: 'Name' })).not.toHaveValue('Hand Book')
            await modal.getByRole('textbox', { name: 'Name' }).fill(NAMED_LINKS.handbook.name)
            await modal.getByRole('button', { name: 'Create link', exact: true }).click()
            await expect(modal.getByText(/already exists/)).toBeVisible()
            await modal.getByRole('textbox', { name: 'Name' }).fill('parts-lookup')
            await expect(
              modal.getByRole('checkbox', { name: 'Hide from the links page' })
            ).toBeEnabled()
            await modal.getByRole('button', { name: 'Create link', exact: true }).click()
            await expect(modal).toHaveCount(0)
            await expect(page).toHaveURL((address) => !address.searchParams.has('create'))
            await search(page).fill('parts-lookup')
            await expect(rowFor(page, 'parts-lookup')).toBeVisible()
            const opened = await page.request.get(url(simLinkPath('parts-lookup', '123')), {
              maxRedirects: 0,
            })
            assert.equal(opened.headers().location, 'https://parts.example.com/123')
          })
      ),
    { allow: [/409 POST .*\/sim-links/] }
  )
  await check('?create= prefills the name, and an unknown sim/ link offers it', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(`${linksUrl}?create=brand-new`)
      const modal = dialog(page, 'New link')
      await expect(modal.getByRole('textbox', { name: 'Name' })).toHaveValue('brand-new')
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page).toHaveURL((address) => !address.searchParams.has('create'))
      await page.goto(url(simLinkPath('brand-new')))
      await expect(page.locator('[data-platform-ui]')).toHaveCount(0)
      const offer = page.getByRole('link', { name: 'Create link', exact: true })
      await expect(offer).toBeVisible()
      await expect(offer).toHaveAttribute('href', `${org.simLinks}?create=brand-new`)
    })
  })
  await check('a validation problem shows on its field, and the modal holds while saving', () =>
    withRestore(
      () => removeLink('held-link'),
      () =>
        withSession(MEMBER, async ({ page }) => {
          await page.goto(`${linksUrl}?create=held-link`)
          const modal = dialog(page, 'New link')
          await modal.getByRole('button', { name: 'Create link', exact: true }).click()
          await expect(modal.getByRole('textbox', { name: 'Destination URL' })).toHaveAttribute(
            'aria-invalid',
            'true'
          )
          await modal
            .getByRole('textbox', { name: 'Destination URL' })
            .fill('https://held.example.com')
          const release = createDeferred<void>()
          const saving = createDeferred<void>()
          await page.route(`**/api/organizations/${ORGANIZATION_ID}/sim-links`, async (route) => {
            if (route.request().method() === 'POST') saving.resolve()
            await release.promise
            await route.continue()
          })
          await modal.getByRole('button', { name: 'Create link', exact: true }).click()
          await saving.promise
          await page.keyboard.press('Escape')
          await pageTurn(page)
          await expect(modal).toHaveJSProperty('open', true)
          release.resolve()
          await expect(modal).toHaveCount(0)
        })
    )
  )
  await check('the creator manages Access; delete warns everyone and stops the link working', () =>
    withRestore(
      () => removeLink('removable-link'),
      () =>
        withSession(MEMBER, async ({ page }) => {
          await sql`insert into sim_link (id, organization_id, name, normalized_name, url, created_by, created_at, updated_at)
          values ('org-redesign-link-removable', ${ORGANIZATION_ID}, 'removable-link', 'removablelink', 'https://removable.example.com', ${MEMBER.userId}, now(), now())`
          await page.goto(`${linksUrl}?search=${NAMED_LINKS.mostUsed.name}`)
          await rowFor(page, NAMED_LINKS.mostUsed.name).click({ button: 'right' })
          await menuEntry(page, 'Edit').click()
          const editor = dialog(page, `Edit ${NAMED_LINKS.mostUsed.name}`)
          await expect(
            editor.getByRole('checkbox', { name: 'Hide from the links page' })
          ).toBeEnabled()
          await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
          await page.goto(`${linksUrl}?search=removable-link`)
          await rowFor(page, 'removable-link').click({ button: 'right' })
          await menuEntry(page, 'Delete').click()
          const modal = dialog(page, 'Delete link')
          await expect(
            modal.getByText('removable-link will stop working for everyone in your organization.')
          ).toBeVisible()
          await modal.getByRole('button', { name: 'Delete', exact: true }).click()
          await expect(modal).toHaveCount(0)
          await expect(rowFor(page, 'removable-link')).toHaveCount(0)
          const opened = await page.request.get(url(simLinkPath('removable-link')), {
            maxRedirects: 0,
          })
          assert.notEqual(opened.headers().location, 'https://removable.example.com')
        })
    )
  )
  await check(
    'loading, failure with Retry, and the empty state',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        const hold = createDeferred<void>()
        const requested = createDeferred<void>()
        const isLinksPayload = (address: URL) =>
          address.pathname === org.simLinks && address.searchParams.has('_rsc')
        // Only the click's own read: a prefetch delivers the route, and the click's read holds it.
        await page.route(isLinksPayload, async (route) => {
          if (route.request().headers()['next-router-prefetch'] === undefined) {
            requested.resolve()
            await hold.promise
          }
          await route.continue()
        })
        const prefetched = routePrefetched(page, isLinksPayload)
        await page.goto(url(org.settingsSection('general')))
        const entry = sidebar(page)
          .getByRole('navigation', { name: 'Settings' })
          .getByRole('link', { name: 'Links', exact: true })
        await entry.hover()
        await prefetched()
        await entry.click()
        // Loading paints nothing (platform/AGENTS.md): General stays on screen until Links' read lands.
        await requested.promise
        await pageTurn(page)
        const linksHeading = page.getByRole('heading', { level: 1, name: 'Links', exact: true })
        try {
          await expect(
            page.getByRole('heading', { level: 1, name: 'General', exact: true })
          ).toBeVisible()
          await expect(linksHeading).toHaveCount(0)
          await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0)
        } finally {
          hold.resolve()
        }
        await expect(linksHeading).toBeVisible()
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
      })
      await withSession(MEMBER, async ({ page }) => {
        await withTableHidden('sim_link', async (restore) => {
          await page.goto(linksUrl)
          const retry = page.getByRole('button', { name: /Retry/ })
          await expect(retry).toBeVisible({ timeout: 40_000 })
          await restore()
          await retry.click()
          await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        })
      })
      await withSession(OUTSIDER, async ({ page }) => {
        await page.goto(url(organizationRoutes(OUTSIDE_ORGANIZATION_ID).simLinks))
        await expect(page.getByText('Create short links like handbook')).toBeVisible()
        await page.getByRole('button', { name: 'New link', exact: true }).last().click()
        await expect(dialog(page, 'New link')).toBeVisible()
      })
    },
    // The read whose table the check hides.
    { allow: [refused(500, 'GET', `/api/organizations/${ORGANIZATION_ID}/sim-links`)] }
  )
  await check('the phone keeps Links usable', async () => {
    await withSession(
      MEMBER,
      async ({ page }) => {
        await page.goto(linksUrl)
        await expect(rowFor(page, NAMED_LINKS.handbook.name)).toBeVisible()
        await assertNoHorizontalOverflow(page, 'Links at 390px')
        await page.getByRole('button', { name: 'New link', exact: true }).first().tap()
        await expect(dialog(page, 'New link')).toBeVisible()
      },
      { viewport: PHONE }
    )
  })
}
