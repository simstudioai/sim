import { expect, test } from '@playwright/test'
import { fixturesOffOrigin, fixtureUrl } from '@/platform/checks/routes'

test('sample data requires the server flag even when a URL requests the populated state', async ({
  page,
}) => {
  const off = await page.goto(fixtureUrl('/workbench?state=full', fixturesOffOrigin))
  expect(off?.status()).toBe(200)
  expect(await off?.text()).not.toContain('Sample studio')
  await expect(page.getByRole('navigation', { name: 'Fixture state' })).toHaveCount(0)
})

test('the fixture flag gates the integration index and deep links', async ({ page }) => {
  await page.goto(fixtureUrl('/integrations?state=full', fixturesOffOrigin))
  await expect(page.getByRole('heading', { name: 'No apps yet' })).toBeVisible()
  await page.goto(fixtureUrl('/integrations/gmail?state=full', fixturesOffOrigin))
  await expect(page.getByRole('heading', { name: 'Gmail', exact: true })).toHaveCount(0)
  await expect(page.getByText('emir@sim.ai', { exact: true })).toHaveCount(0)
})

test('a disabled fixture gate serves no sample entity on any product route', async ({
  request,
}) => {
  for (const path of ['/home', '/chat/weekly-review', '/settings/members']) {
    const off = await request.get(fixtureUrl(`${path}?state=full`, fixturesOffOrigin))
    expect(off.status()).toBe(200)
    expect(await off.text()).not.toMatch(
      /Sim Enterprise|Emir Karabeg|Aster Labs|linear-homepage\.[a-f0-9]+\.jpg/
    )
  }
})

test('disabling fixtures exposes no resource examples or creation controls', async ({ page }) => {
  for (const tab of ['skills', 'mcps', 'credentials']) {
    await page.goto(fixtureUrl(`/integrations?state=full&tab=${tab}`, fixturesOffOrigin))
    const main = page.getByRole('main')
    await expect(
      main.getByRole('button', { name: /^(Create skill|Connect MCP|Create credential)$/ })
    ).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Weekly customer review / })).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Customer knowledge / })).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Research API / })).toHaveCount(0)
  }
})
