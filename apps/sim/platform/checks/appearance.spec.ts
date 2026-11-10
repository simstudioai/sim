import { expect } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test.use({ javaScriptEnabled: false })

test('system appearance follows the OS before hydration while an explicit appearance stays fixed', async ({
  page,
}) => {
  const surface = page.locator('[data-platform-ui]')
  const paint = () =>
    surface.evaluate((element) => {
      const style = getComputedStyle(element)
      return { canvas: style.backgroundColor, scheme: style.colorScheme }
    })
  // What each explicit appearance paints, under the OS preference that would contradict it.
  const explicit = { light: { canvas: '', scheme: '' }, dark: { canvas: '', scheme: '' } }
  for (const appearance of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: appearance === 'light' ? 'dark' : 'light' })
    await page.goto(fixtureUrl(`/home?theme=${appearance}`))
    explicit[appearance] = await paint()
    expect(explicit[appearance].scheme).toBe(appearance)
  }
  expect(explicit.light.canvas).not.toBe(explicit.dark.canvas)
  for (const preference of ['system', 'light', 'dark'] as const) {
    await page.goto(fixtureUrl(`/home?theme=${preference}`))
    for (const os of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: os })
      const appearance = preference === 'system' ? os : preference
      await expect.poll(paint).toEqual(explicit[appearance])
    }
  }
})
