import { expect, test } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'

test.use({ javaScriptEnabled: false })

test('system appearance follows the OS before hydration while an explicit appearance stays fixed', async ({
  page,
}) => {
  const surface = page.locator('[data-platform-ui]')
  const canvas = { light: 'rgb(255, 255, 255)', dark: 'rgb(20, 20, 20)' }
  for (const preference of ['system', 'light', 'dark'] as const) {
    await page.goto(fixtureUrl(`/home?theme=${preference}`))
    for (const os of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: os })
      const appearance = preference === 'system' ? os : preference
      await expect(surface).toHaveCSS('background-color', canvas[appearance])
      await expect(surface).toHaveCSS('color-scheme', appearance)
    }
  }
})
