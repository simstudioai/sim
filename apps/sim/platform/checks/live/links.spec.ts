import { expect, type Page } from '@playwright/test'
import { memberEmail, organizationId, requireEnv, signIn } from '@/platform/checks/live/session'
import { withLiveDatabase } from '@/platform/checks/live/support/database'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** More rows than the list's first page, so scrolling has to read on. */
const BULK_LINKS = 183

const rowFor = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })

/**
 * Runs `check` with {@link BULK_LINKS} links of the seeded organization's, which sort after the
 * seeded `handbook` by name, the last after every other, and deletes them afterwards whatever
 * happened, so the Links checks after this one read the seed as written.
 */
async function withBulkLinks(check: (last: string) => Promise<void>) {
  const run = Date.now()
  const last = `zz-bulk-${run}`
  await withLiveDatabase(
    (sql) => sql`insert into sim_link (id, organization_id, name, normalized_name, url, description,
        created_by, created_at, updated_at)
      select ${`platform-live-bulk-${run}-`}::text || n::text, ${organizationId()},
        case when n = ${BULK_LINKS}::int then ${last}::text
          else ${`x-bulk-${run}-`}::text || lpad(n::text, 3, '0') end,
        case when n = ${BULK_LINKS}::int then ${last.replaceAll('-', '')}::text
          else ${`xbulk${run}`}::text || lpad(n::text, 3, '0') end,
        'https://example.com/bulk/' || n::text, 'Bulk link ' || n::text,
        (select id from "user" where email = ${requireEnv('PLATFORM_LIVE_OWNER_EMAIL')}), now(), now()
      from generate_series(1, ${BULK_LINKS}::int) n`
  )
  try {
    await check(last)
  } finally {
    await withLiveDatabase(
      (sql) => sql`delete from sim_link where id like ${`platform-live-bulk-${run}-%`}`
    )
  }
}

test('Links: header, Chrome install, columns, and a list that reads on as it scrolls', async ({
  page,
  context,
}) => {
  await withBulkLinks(async (last) => {
    await context.route('https://chromewebstore.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Store stand-in' })
    )
    await signIn(page, memberEmail(), liveRoute('/settings/links'))
    await expect(page.getByRole('heading', { level: 1, name: 'Links' })).toBeVisible()
    // Settings' column is narrower than the table's wide layout: Name and Destination stay, and
    // what the wide-only columns hold reads under each name instead.
    await expect(page.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Destination', exact: true })).toBeVisible()
    for (const wideOnly of ['Description', 'Created by', 'Access', 'Updated'])
      await expect(page.getByRole('columnheader', { name: wideOnly, exact: true })).toBeHidden()

    const store = context.waitForEvent('page')
    await page.getByRole('button', { name: 'Install Sim for Chrome' }).click()
    await expect(await store).toHaveURL(/chromewebstore\.google\.com/)

    await expect(rowFor(page, 'handbook')).toBeVisible()
    await expect(
      rowFor(page, 'handbook')
        .getByText('The company handbook', { exact: true })
        .filter({ visible: true })
    ).toHaveCount(1)
    const pages: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/sim-links') && request.url().includes('cursor='))
        pages.push(request.url())
    })
    // The page is a region named by its heading, and the scrolling list a region inside it.
    const list = page.getByRole('region', { name: 'Links' }).getByRole('region', { name: 'Links' })
    await expect(async () => {
      await list.evaluate((node) => {
        const scroller =
          [node, ...node.querySelectorAll('*')].find(
            (element) => element.scrollHeight > element.clientHeight + 20
          ) ?? node
        scroller.scrollTop = scroller.scrollHeight
      })
      await expect(rowFor(page, last)).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 30_000 })
    expect(pages.length, 'rows past the first page load as the list scrolls').toBeGreaterThan(0)
  })
})
