import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('an approved app can connect and disconnect a sample account during the same session', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full`)
  const list = page.getByRole('main')
  await list.getByRole('searchbox', { name: 'Search integrations' }).fill('Linear issues')
  await list.getByRole('link', { name: /^Linear / }).click()
  const guide = list.getByRole('link', { name: 'Docs (opens in a new tab)', exact: true })
  await expect(guide).toHaveAttribute('href', 'https://docs.sim.ai/search/linear')
  await expect(guide).toHaveAttribute('target', '_blank')
  await list.getByRole('button', { name: 'Linear', exact: true }).click()
  const title = list.getByRole('heading', { name: 'Linear', exact: true })
  await expect(title).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(list.getByRole('button', { name: 'Add account' })).toHaveCount(0)
  const credential = list.getByRole('region', { name: 'Connected credential' })
  await expect(credential.getByText('emir@sim.ai', { exact: true })).toBeVisible()
  await list.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(list.getByRole('searchbox')).toHaveValue('Linear issues')
  await list.getByRole('link', { name: /^Linear / }).click()
  await credential.getByRole('button', { name: 'Manage emir@sim.ai' }).click()
  await page.getByRole('menuitem', { name: 'Disconnect account' }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect account?' })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await expect(title).toBeFocused()
  await list.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(
    list
      .getByRole('region', { name: 'Available to connect' })
      .getByRole('link', { name: /^Linear / })
  ).toBeVisible()
})

test('individual permissions inherit their default without changing other tools', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full`)
  const access = page.getByRole('region', { name: 'Requested permissions' })
  const writeScopes = access.getByRole('list', { name: 'Write and manage' })
  await expect(writeScopes.getByText('Send emails', { exact: true })).toBeVisible()
  const tools = page.getByRole('region', { name: 'Tool permissions' })
  const send = tools.getByRole('group', { name: 'Gmail Send permission' })
  const draft = tools.getByRole('group', { name: 'Gmail Draft permission' })
  await send.getByRole('radio', { name: 'Block' }).check()
  await expect(draft.getByRole('radio', { name: 'Ask' })).toBeChecked()
  await page.getByRole('main').getByRole('link', { name: 'Integrations', exact: true }).click()
  await page.getByRole('link', { name: /^Gmail / }).click()
  await expect(send.getByRole('radio', { name: 'Block' })).toBeChecked()
  await send.getByRole('radio', { name: 'Ask' }).check()
  await expect(send).toHaveAccessibleDescription('Inherits Ask from write tools.')
  const query = tools.getByRole('searchbox', { name: 'Search tools' })
  await query.fill('draft')
  await expect(draft).toBeVisible()
  await expect(send).toHaveCount(0)
  await query.fill('unknown-tool')
  await expect(tools.getByText('No matching tools', { exact: true })).toBeVisible()
  await page.goto(`${origin}/integrations/gmail?state=stress`)
  await expect(send.getByRole('radio', { name: 'Allow' })).toBeDisabled()
})

test('a cleared integration search stays clear when opening a provider and returning', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full&q=Fireflies`)
  const main = page.getByRole('main')
  const field = main.getByRole('searchbox', { name: 'Search integrations' })
  await page
    .getByRole('region', { name: 'Platform navigation' })
    .getByRole('link', { name: 'Integrations', exact: true })
    .click()
  await expect(field).toHaveValue('')
  await field.fill('Nonexistent')
  await field.fill('emir')
  await main.getByRole('button', { name: 'Clear search' }).click()
  await main.getByRole('link', { name: /^Linear / }).click()
  await expect(main.getByRole('heading', { name: 'Linear', exact: true })).toBeVisible()
  await page.goBack()
  await expect(field).toHaveValue('')
  await expect(main.getByRole('link', { name: /^Fireflies / })).toBeVisible()
})

test('managed, unconfigured and retained connections expose only the actions the member can take', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=stress`)
  const main = page.getByRole('main')
  const fireflies = main.getByRole('link', { name: /^Fireflies / })
  await expect(fireflies).toContainText('meeting transcripts and recordings')
  await fireflies.click()
  await expect(main.getByRole('region', { name: 'Connected credential' })).toContainText(
    'Fireflies'
  )
  const reads = main
    .getByRole('region', { name: 'Search access' })
    .getByRole('list', { name: 'Read-only tools' })
  await expect(reads).toContainText('Read available meeting summaries')
  await expect(main.getByRole('radio')).toHaveCount(0)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: /^GitLab / }).click()
  await expect(main.getByRole('heading', { name: 'Organization managed' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Connect account' })).toHaveCount(0)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: /^Confluence / }).click()
  await main.getByRole('button', { name: 'Manage engineering@sim.ai' }).click()
  await expect(page.getByRole('menuitem', { name: 'Disconnect account' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Reconnect account' })).toHaveCount(0)
})

test('a single click opens a member credential at 200 percent text size', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 })
  await page.goto(`${origin}/integrations?state=full`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.getByRole('link', { name: /^Gmail / }).click()
  const tools = page.getByRole('region', { name: 'Tool permissions' })
  const choices = tools.getByRole('group', { name: 'Gmail Send permission' })
  await expect(choices).toBeVisible()
  for (const policy of ['Allow', 'Ask', 'Block']) {
    const lines = await choices.getByText(policy, { exact: true }).evaluate((label) => {
      const range = document.createRange()
      range.selectNodeContents(label)
      return new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size
    })
    expect(lines).toBe(1)
  }
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
