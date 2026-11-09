import { expect, test } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'

test('the member secrets destination delivers only the credential names the viewer can inspect', async ({
  page,
}) => {
  const link = page.getByRole('main').getByRole('link', { name: /^Generic Secrets/ })
  const credentials = page
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Credentials', exact: true })
  await page.goto(fixtureUrl('/integrations?state=full'))
  await credentials.click()
  await expect(link).toHaveCount(0)

  await page.goto(fixtureUrl('/integrations?state=stress'))
  await credentials.click()
  await link.click()
  await expect(page.getByRole('region', { name: 'Personal secrets' })).toContainText(
    'REPORTING_TOKEN'
  )
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0)

  const managed = await page.goto(fixtureUrl('/integrations?state=stress&secrets=organization'))
  expect(await managed?.text()).not.toContain('REPORTING_TOKEN')
  await credentials.click()
  await link.click()
  await expect(page).toHaveURL(/\/integrations\/secrets\?.*secrets=organization/)
  const main = page.getByRole('main')
  await expect(main.getByRole('link', { name: /Docs/ })).toHaveAttribute(
    'href',
    'https://docs.sim.ai/search/generic-secrets'
  )
  await expect(main.getByRole('button')).toHaveCount(0)
  const detail = await page.reload()
  expect(await detail?.text()).not.toContain('REPORTING_TOKEN')
})
