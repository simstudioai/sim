import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('an approved app can connect and disconnect a sample account during the same session', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full`)
  const list = page.getByRole('main')
  await list.getByRole('searchbox', { name: 'Search integrations' }).fill('Linear')
  await list.getByRole('link', { name: 'Linear Not connected' }).click()
  await list.getByRole('button', { name: 'Connect account', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Connect to Linear' })
    .getByRole('button', { name: 'Connect account', exact: true })
    .click()
  await expect(list.getByText('emir@sim.ai', { exact: true })).toBeVisible()
  await list.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(list.getByRole('searchbox')).toHaveValue('Linear')
  await list.getByRole('link', { name: 'Linear 1 account' }).click()
  await list.getByRole('button', { name: 'Manage emir@sim.ai' }).click()
  await page.getByRole('menuitem', { name: 'Disconnect account' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect account?' })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await list.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(
    list
      .getByRole('region', { name: 'Available to connect' })
      .getByRole('link', { name: 'Linear Not connected' })
  ).toBeVisible()
})

test('permission changes are scoped to one account, including group defaults and individual overrides', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=stress`)
  await page.getByRole('link', { name: /emir@sim.ai/ }).click()
  const tools = page.getByRole('region', { name: 'Tool permissions' })
  await tools.getByRole('button', { name: /Write tools permission/ }).click()
  await page.getByRole('menuitemradio', { name: 'Block', exact: true }).click()
  await expect(
    tools
      .getByRole('group', { name: 'Gmail Send permission' })
      .getByRole('radio', { name: 'Block' })
  ).toBeChecked()
  await tools
    .getByRole('group', { name: 'Gmail Send permission' })
    .getByRole('radio', { name: 'Ask' })
    .check()
  await expect(tools.getByRole('button', { name: /Write tools permission: Mixed/ })).toBeVisible()
  await tools.getByRole('button', { name: 'Use default for Gmail Send' }).click()
  await expect(tools.getByRole('button', { name: /Write tools permission: Block/ })).toBeVisible()
  await tools.getByRole('searchbox', { name: 'Search tools' }).fill('draft')
  await expect(tools.getByRole('group', { name: 'Gmail Send permission' })).toHaveCount(0)
  await page.getByRole('link', { name: 'All accounts' }).click()
  await page.getByRole('link', { name: /Customer operations and research/ }).click()
  await tools.getByRole('button', { name: /Write tools permission: Ask/ }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Allow', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(
    tools
      .getByRole('group', { name: 'Gmail Send permission' })
      .getByRole('radio', { name: 'Allow' })
  ).toBeDisabled()
})

test('managed, unconfigured and retained connections expose only the actions the member can take', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=stress`)
  const main = page.getByRole('main')
  await main.getByRole('link', { name: 'GitLab Organization managed' }).click()
  await expect(main.getByRole('heading', { name: 'Organization managed' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Connect account' })).toHaveCount(0)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: 'Confluence Disabled by your organization' }).click()
  await main.getByRole('button', { name: 'Manage Engineering' }).click()
  await expect(page.getByRole('menuitem', { name: 'Disconnect account' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Reconnect account' })).toHaveCount(0)
})

test('a single click opens a member credential at 200 percent text size', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 })
  await page.goto(`${origin}/integrations?state=full`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.getByRole('link', { name: 'Gmail 1 account' }).click()
  await expect(page.getByRole('region', { name: 'Tool permissions' })).toBeVisible()
})

test('the fixture flag and member inventory gate both the index and deep links', async ({
  page,
}) => {
  for (const [site, state] of [
    ['http://127.0.0.1:3180', 'full'],
    [origin, 'empty'],
  ]) {
    await page.goto(`${site}/integrations?state=${state}`)
    await expect(page.getByRole('heading', { name: 'No integrations available' })).toBeVisible()
    await page.goto(`${site}/integrations/gmail?state=${state}`)
    await expect(page.getByRole('heading', { name: 'Gmail', exact: true })).toHaveCount(0)
    await expect(page.getByText('emir@sim.ai', { exact: true })).toHaveCount(0)
  }
})
