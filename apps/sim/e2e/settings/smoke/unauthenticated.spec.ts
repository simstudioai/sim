import { expect, test } from '../../fixtures/browser-test'

test('protected settings redirect unauthenticated users to login', async ({ page }) => {
  await page.goto('/account/settings/general')

  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
