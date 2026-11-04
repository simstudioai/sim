import { expect, test } from '@playwright/test'

const enabled = 'http://127.0.0.1:3181'
const disabled = 'http://127.0.0.1:3180'

test('sample data requires the server flag even when a URL requests the populated state', async ({
  page,
}) => {
  const off = await page.goto(`${disabled}/?state=full`)
  expect(off?.status()).toBe(200)
  expect(await off?.text()).not.toContain('Sample studio')
  await expect(page.getByRole('navigation', { name: 'Fixture state' })).toHaveCount(0)

  await page.goto(`${enabled}/?state=full`)
  const data = page.getByRole('region', { name: 'Preview data' })
  await expect(data.getByText('Weekly review', { exact: true })).toBeVisible()
  await page.goto(`${enabled}/?state=empty`)
  await expect(data).toBeVisible()
  await expect(data.getByText('Weekly review', { exact: true })).toHaveCount(0)
})

test('the loaded typeface and themed canvas match the Paper control recipe', async ({ page }) => {
  for (const [theme, surface] of [
    ['light', 'rgb(255, 255, 255)'],
    ['dark', 'rgb(20, 20, 20)'],
  ]) {
    await page.goto(`${enabled}/?theme=${theme}`)
    await expect(page.locator('[data-platform-ui]')).toHaveCSS('background-color', surface)
    const button = page.getByRole('button', { name: 'Create workspace', exact: true })
    await expect(button).toHaveCSS('font-size', '13px')
    await expect(button).toHaveCSS('line-height', '18px')
    const faces = await button.evaluate(async (element) => {
      await document.fonts.ready
      const style = getComputedStyle(element)
      return (
        await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
      ).map((face) => [face.status, face.family])
    })
    expect(
      faces.some(
        ([status, family]) => status === 'loaded' && family.toLowerCase().includes('geist')
      )
    ).toBe(true)
  }
})

test('keyboard users can advance, dismiss and reopen the workspace dialog from its first step', async ({
  page,
}) => {
  await page.goto(enabled)
  const trigger = page.getByRole('button', { name: 'Create workspace', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('backdrop-filter', 'blur(20px)')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  const next = dialog.getByRole('button', { name: 'Continue' })
  await next.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/^Step 2 of/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Default role, Member' }).click()
  await dialog.getByRole('button', { name: 'Viewer', exact: true }).click()
  await dialog.getByRole('button', { name: 'Back' }).click()
  await next.click()
  await expect(dialog.getByRole('button', { name: 'Default role, Viewer' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/^Step 1 of/)).toBeVisible()
  await next.click()
  await expect(dialog.getByRole('button', { name: 'Default role, Member' })).toBeVisible()
})

for (const width of [390, 647, 901, 1440]) {
  test(`a long workspace chat list stays within its viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`${enabled}/?state=stress&theme=dark`)
    const region = page.getByRole('region', { name: 'Workspace chats' })
    await expect(region).toBeVisible()
    await expect(region).toHaveCSS('mask-image', /calc\(100% - 16px\)/)
    const scrolled = await region.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      return el.scrollTop
    })
    expect(scrolled).toBeGreaterThan(0)
    await expect(region).toHaveCSS('mask-image', /(?<!- )16px/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    )
  })
}

test('preview controls follow the user’s preferred type size without widening the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 647, height: 844 })
  await page.goto(`${enabled}/?state=stress`)
  await page.addStyleTag({ content: 'html { font-size: 125%; }' })
  const trigger = page.getByRole('button', { name: 'Create workspace', exact: true })
  await expect(trigger).toHaveCSS('font-size', '16.25px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(647)
})

test('Paper search, disclosure and segmented controls work with the keyboard', async ({ page }) => {
  await page.goto(`${enabled}/?theme=light&state=full&recipe=C1084`)
  const search = page.getByRole('searchbox')
  await search.fill('workspace')
  const clear = page.getByRole('button', { name: 'Clear search' })
  await clear.focus()
  await page.keyboard.press('Enter')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()

  await page.goto(`${enabled}/?theme=light&state=full&recipe=C0423`)
  const summary = page.locator('summary')
  await summary.focus()
  await page.keyboard.press('Space')
  await expect(page.locator('details[open]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('details[open]')).toHaveCount(0)

  await page.goto(`${enabled}/?theme=light&state=full&recipe=C0970`)
  const options = page.getByRole('radio')
  await expect(options).toHaveCount(2)
  await options.nth(0).check()
  await options.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(options.nth(1)).toBeChecked()
  await expect(options.nth(0)).not.toBeChecked()
})

test('chart menu choices use one tab stop and report selection after arrow-key navigation', async ({
  page,
}) => {
  await page.goto(`${enabled}/?theme=light&state=full&recipe=C0635`)
  const choices = page.getByRole('menuitemradio')
  await expect(choices).toHaveCount(3)
  await choices.first().focus()
  await page.keyboard.press('End')
  await expect(choices.last()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(choices.last()).toBeChecked()
  await expect(choices.first()).not.toBeChecked()
  expect(
    await choices.evaluateAll(
      (items) => items.filter((item) => (item as HTMLElement).tabIndex === 0).length
    )
  ).toBe(1)
})

test('workspace destinations stay reachable and read-only table records scale with the fixture', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${enabled}/?recipe=C1310&state=full`)
  const destinations = page.getByRole('navigation', { name: 'Workspace sections' })
  const forward = destinations.getByRole('button', { name: 'Scroll Workspace sections forward' })
  await expect(forward).toBeVisible()
  const region = destinations.getByRole('region')
  await forward.click()
  await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
  const settings = destinations.getByRole('link', { name: 'Settings' })
  await settings.click()
  await expect(settings).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/destination=8/)
  await page.goto(`${enabled}/?recipe=C1330&state=stress`)
  const table = page.getByRole('table', { name: 'Runs by agent' })
  await expect(table.getByRole('row')).toHaveCount(26)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
