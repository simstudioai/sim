import { expect, type Page } from '@playwright/test'
import { signInAsAdmin } from '@/platform/checks/live/session'
import { liveRoute } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** The composer's skill list: one organization-wide mentions read, as legacy read `/api/skills`. */
const SKILLS_READ = /^\/api\/organizations\/[^/]+\/mentions\?(?=.*family=skills)/
/**
 * The composer's lists, which wait until someone asks: the organization mentions reads that took
 * over from legacy's per-workspace reads, and those reads, which nothing should make any more.
 */
const RESOURCE_LIST_READ = [
  /^\/api\/organizations\/[^/]+\/mentions\?/,
  /^\/api\/skills\?/,
  /^\/api\/workflows\?/,
  /^\/api\/table\?/,
  /^\/api\/workspaces\/[^/]+\/files/,
  /^\/api\/knowledge\?/,
  /^\/api\/folders\?/,
  /^\/api\/mothership\/chats\?(?=.*workspaceId=)/,
  /^\/api\/permission-groups\/user/,
  /^\/api\/logs\?/,
]

/** Every composer list read `page` sends from now on, by path and query. */
function recordListReads(page: Page) {
  const reads: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    const read = `${url.pathname}${url.search}`
    if (RESOURCE_LIST_READ.some((pattern) => pattern.test(read))) reads.push(read)
  })
  return reads
}

/** Home's composer, once the page around it has read what it shows. */
async function openHomeComposer(page: Page) {
  await signInAsAdmin(page, liveRoute('/home'))
  const main = page.getByRole('main')
  await expect(main.getByRole('region', { name: 'Tasks run', exact: true })).toBeVisible()
  await expect(
    main.getByRole('region', { name: 'Email', exact: true }).getByText('Connect your email')
  ).toBeVisible()
  return page.getByRole('textbox', { name: /Ask about your business/ })
}

test('an admin composer reads no workspace list until its menu opens, then the menu fills', async ({
  page,
}) => {
  const reads = recordListReads(page)
  await openHomeComposer(page)
  expect(reads, 'the composer read every workspace on load').toEqual([])
  await page.getByRole('button', { name: 'Add attachment', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Add attachment' })
  const workspaceRow = menu.getByRole('menuitem', { name: 'Operations', exact: true })
  await expect(workspaceRow).toBeVisible()
  expect(reads.length).toBeGreaterThan(0)
  await page.getByLabel('Search resources', { exact: true }).fill('Operations')
  await expect(workspaceRow).toBeVisible()
})

test('a slash in an admin composer reads skills, not the resource lists', async ({ page }) => {
  const reads = recordListReads(page)
  const composer = await openHomeComposer(page)
  await composer.pressSequentially('/')
  await expect(
    page.getByRole('listbox', { name: 'Skills and MCP servers' }).getByRole('option').first()
  ).toBeVisible()
  expect(reads.length, 'the skills were read').toBeGreaterThan(0)
  expect(reads.filter((read) => !SKILLS_READ.test(read))).toEqual([])
})
