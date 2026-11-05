import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('the member secrets destination delivers only the credential names the viewer can inspect', async ({
  page,
}) => {
  const link = page.getByRole('main').getByRole('link', { name: /^Generic Secrets/ })
  await page.goto(`${origin}/integrations?state=full`)
  await expect(link).toHaveCount(0)

  await page.goto(`${origin}/integrations?state=stress`)
  await link.click()
  await expect(page.getByRole('region', { name: 'Personal secrets' })).toContainText(
    'REPORTING_TOKEN'
  )
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0)

  const managed = await page.goto(`${origin}/integrations?state=stress&secrets=organization`)
  expect(await managed?.text()).not.toContain('REPORTING_TOKEN')
  await link.click()
  await expect(page).toHaveURL(/\/integrations\/secrets\?.*secrets=organization/)
  await expect(
    page.getByRole('main').getByText('Organization managed', { exact: true })
  ).toBeVisible()
  const detail = await page.reload()
  expect(await detail?.text()).not.toContain('REPORTING_TOKEN')
})
