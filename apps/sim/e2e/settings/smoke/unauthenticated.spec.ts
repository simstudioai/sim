import { expect, test } from '../../fixtures/browser-test'
import { routeCases } from '../navigation/contracts'

for (const routeCase of routeCases.filter((candidate) => candidate.driver === 'unauthenticated')) {
  test(`${routeCase.caseId} redirects to login without return state`, async ({ page }) => {
    await page.goto(routeCase.pathTemplate)

    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('settings-return-url')))
      .toBeNull()
  })
}
