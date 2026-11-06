import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('opening an immediately filtered skill preserves the destination and its saved edit across a workspace pane', async ({
  page,
}) => {
  await page.goto(`${origin}/workspace/operations/skills?state=full`)
  const main = page.getByRole('main')
  const sidebar = page.getByRole('complementary', { name: 'Platform sidebar' })
  await main.getByRole('searchbox', { name: 'Search skills' }).fill('operations')
  await main.getByRole('link', { name: /weekly-review/ }).click()
  const description = page.getByRole('textbox', { name: 'Description', exact: true })
  await description.fill('Quarterly operations summary')
  await main.getByRole('button', { name: 'Save', exact: true }).click()
  await sidebar.getByRole('link', { name: 'Tables', exact: true }).click()
  await expect(page.frameLocator('iframe[title="Tables"]').getByRole('table')).toBeVisible()
  await sidebar.getByRole('link', { name: 'Skills', exact: true }).click()
  await main.getByRole('link', { name: /weekly-review/ }).click()
  await expect(description).toHaveValue('Quarterly operations summary')
})

test('a new workspace chat stays in that workspace when reopened from its sidebar', async ({
  page,
}) => {
  await page.goto(`${origin}/home?state=full`)
  const sidebar = page.getByRole('complementary', { name: 'Platform sidebar' })
  await sidebar.getByRole('link', { name: 'Workspace', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\/operations\/chat\?/)
  await sidebar.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(page).toHaveURL(`${origin}/integrations?state=full`)
  await expect(
    page.getByRole('main').getByRole('navigation', { name: 'Integration categories' })
  ).toBeVisible()
  await sidebar.getByRole('link', { name: 'Workspace', exact: true }).click()
  const text = 'Review the onboarding tasks'
  await page.getByRole('textbox', { name: /Ask about your business/ }).fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
  const thread = sidebar.getByRole('link', { name: text, exact: true })
  await expect(thread).toHaveAttribute('aria-current', 'page')
  await sidebar.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(thread).toBeHidden()
  await sidebar.getByRole('link', { name: 'Finance', exact: true }).click()
  await expect(sidebar.getByRole('link', { name: 'Quarterly forecast' })).toBeVisible()
  await expect(thread).toBeHidden()
  await sidebar.getByRole('link', { name: 'Back', exact: true }).click()
  await sidebar.getByRole('link', { name: 'Workspace', exact: true }).click()
  await thread.click()
  await expect(page.getByRole('heading', { name: text, exact: true })).toBeVisible()
})
