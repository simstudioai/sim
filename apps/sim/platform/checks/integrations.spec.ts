import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'
const withoutFixtures = 'http://127.0.0.1:3180'

test('a single click opens an integration from a long list with enlarged text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 820 })
  await page.goto(`${origin}/integrations?state=stress`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const gmail = page.getByRole('link', { name: /^Gmail / })
  await gmail.scrollIntoViewIfNeeded()
  await gmail.click()
  await expect(page.getByRole('heading', { name: 'Gmail', exact: true })).toBeVisible()
})

test('adding member Search provisions sign-in, preserves decisions on navigation and lets an admin remove the app', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=empty`)
  await page.getByRole('button', { name: 'Add integration', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Add integration', exact: true })
  await picker.getByRole('searchbox').fill('Notion')
  await picker.getByRole('button', { name: /^Notion/ }).click()
  await page
    .getByRole('dialog', { name: 'Add Notion' })
    .getByRole('button', { name: 'Add integration', exact: true })
    .click()
  await expect(page).toHaveURL(/\/integrations\/notion\?state=empty/)
  const approval = page.getByRole('switch', { name: 'Allow in Search' })
  await expect(approval).toBeChecked()
  await page.getByRole('link', { name: 'Your accounts' }).click()
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  const authorize = page.getByRole('dialog', { name: 'Connect to Notion' })
  await expect(authorize.getByRole('button', { name: 'Continue to Notion' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'Search', exact: true }).click()
  await approval.click()
  await page.getByRole('button', { name: 'Disable search', exact: true }).click()
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Integrations' })
    .click()
  await page.getByRole('link', { name: /^Notion / }).click()
  await expect(approval).not.toBeChecked()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Remove Notion?' })
    .getByRole('button', { name: 'Remove integration' })
    .click()
  await expect(page.getByRole('heading', { name: 'No integrations added' })).toBeVisible()
})

test('workspace grants distinguish the same service’s OAuth and MCP credentials and apply only after Save', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/access?state=full&theme=dark`)
  const finance = page.getByRole('button', { name: /^Finance / })
  await finance.click()
  const modal = page.getByRole('dialog', { name: 'Edit workspace access' })
  await modal.getByRole('combobox', { name: 'Credential access' }).click()
  await page.getByRole('option', { name: 'Selected credential types' }).click()
  await expect(modal.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await modal.getByRole('searchbox', { name: 'Search credential types' }).fill('Notion')
  await modal.getByRole('button', { name: 'Notion (MCP)' }).click()
  await modal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(finance).toHaveAccessibleName(/1 credential type/)
  await finance.click()
  await expect(modal.getByRole('button', { name: 'Notion (OAuth)' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await expect(modal.getByRole('button', { name: 'Notion (MCP)' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await modal.getByRole('combobox', { name: 'Credential access' }).click()
  await page.getByRole('option', { name: 'All credential types' }).click()
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await expect(finance).toHaveAccessibleName(/1 credential type/)
})

test('members can manage their own account permissions without receiving private organization configuration', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full&role=member&view=people`)
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: 'People', exact: true })).toHaveCount(0)
  await expect(main.getByRole('switch', { name: 'Allow in Search' })).toHaveCount(0)
  await main.getByRole('link', { name: 'Your accounts' }).click()
  await main.getByRole('button', { name: 'Manage emir@sim.ai' }).click()
  await page.getByRole('menuitem', { name: 'Tool permissions' }).click()
  const permissions = page.getByRole('dialog', { name: 'Tool permissions' })
  const write = permissions.getByRole('combobox', { name: 'Write tools' })
  await write.click()
  await expect(page.getByRole('option', { name: 'Allow automatically' })).toHaveCount(0)
  await page.getByRole('option', { name: 'Block', exact: true }).click()
  await permissions.getByRole('button', { name: 'Save changes' }).click()
  await main.getByRole('button', { name: 'Manage emir@sim.ai' }).click()
  await page.getByRole('menuitem', { name: 'Tool permissions' }).click()
  await expect(write).toContainText('Block')
  const memberAccess = await page.goto(`${origin}/integrations/access?state=full&role=member`)
  expect(await memberAccess?.text()).not.toContain('oauth:slack')
  await expect(page.getByRole('button', { name: /^Customer operations / })).toHaveCount(0)
})

test('revoking an organization enrollment reaches every provider and a new invitation stays a draft', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full&view=people`)
  await page.getByRole('button', { name: 'Actions for nina@example.com' }).click()
  await page.getByRole('menuitem', { name: 'Revoke access' }).click()
  await page
    .getByRole('dialog', { name: 'Revoke organization access?' })
    .getByRole('button', { name: 'Revoke access' })
    .click()
  await page.getByRole('main').getByRole('link', { name: 'Integrations', exact: true }).click()
  await page.getByRole('link', { name: /^Slack / }).click()
  await page.getByRole('link', { name: 'People', exact: true }).click()
  await expect(page.getByText('Access revoked', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Invite people' }).click()
  const invite = page.getByRole('dialog', { name: 'Invite people' })
  await invite.getByRole('textbox', { name: 'Email addresses' }).fill('nina@example.com,')
  await invite.getByRole('button', { name: 'Save invitation draft' }).click()
  await expect(page.getByText('Invitation draft', { exact: true })).toBeVisible()
  await expect(page.getByText('Access revoked', { exact: true })).toHaveCount(0)
})

test('fixture-off integration routes expose no sample catalog or management action', async ({
  page,
}) => {
  await page.goto(`${withoutFixtures}/integrations?state=stress`)
  await expect(page.getByRole('heading', { name: 'No integrations added' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add integration' })).toHaveCount(0)
  const response = await page.goto(`${withoutFixtures}/integrations/gmail?state=full`)
  await expect(page.getByRole('main').getByRole('heading', { name: 'Gmail' })).toHaveCount(0)
  expect(await response?.text()).not.toContain('nina@example.com')
})
