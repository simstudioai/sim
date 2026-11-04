import { expect, test } from '@playwright/test'

const base = 'http://127.0.0.1:3181'

test('preferences apply to the interface and survive settings navigation in this session', async ({
  page,
}) => {
  await page.goto(`${base}/settings?theme=unrecognized&state=full`)
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  await expect(theme).toHaveText('System')
  await theme.click()
  await page.getByRole('option', { name: 'Dark', exact: true }).click()
  await expect(page.locator('[data-platform-ui]')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('combobox', { name: 'Interface font' }).click()
  await page.getByRole('option', { name: 'System', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preferences' })).toHaveCSS(
    'font-family',
    /system-ui/
  )
  await page.getByRole('switch', { name: 'In-app notifications' }).click()
  await page.getByRole('switch', { name: 'Play sound' }).focus()
  await page.keyboard.press('Space')
  await page
    .getByRole('navigation', { name: 'Settings', exact: true })
    .getByRole('link', { name: 'Notifications' })
    .click()
  await expect(page).toHaveURL(/\/settings\/notifications\?.*state=full/)
  await expect(page.getByRole('switch', { name: 'In-app notifications' })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: 'Play sound' })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toHaveCSS(
    'font-family',
    /system-ui/
  )
})

test('the small Settings drawer filters destinations, restores navigation and closes on selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 356, height: 740 })
  await page.goto(`${base}/settings?state=full`)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation drawer' })
  const field = drawer.getByRole('searchbox', { name: 'Search settings' })
  await field.fill('nonexistent')
  await expect(drawer.getByText('No matching settings')).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Preferences' })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Clear search' }).click()
  await expect(field).toBeFocused()
  await field.fill('notifications')
  await drawer.getByRole('link', { name: 'Notifications' }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Play sound' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(356)
})

test('cancelled profile edits reset and saved name and picture survive Settings navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 356, height: 740 })
  await page.goto(`${base}/settings?state=full`)
  await page.getByRole('button', { name: 'Emir Karabeg', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit display name' })
  await dialog.getByRole('textbox', { name: 'Display name' }).fill('Unsaved draft')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Emir Karabeg', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Display name' })).toHaveValue('Emir Karabeg')
  const replacement = 'International operations and customer onboarding specialist'
  await dialog.getByRole('textbox', { name: 'Display name' }).fill(replacement)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  const button = page.getByRole('button', { name: replacement })
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('img', { name: replacement })).toBeVisible()
  await page.getByLabel('Set your profile picture').setInputFiles({
    name: 'photo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="17" height="13"/>'),
  })
  const picture = page.getByRole('region', { name: 'Profile' }).locator('img')
  await expect(picture).toHaveJSProperty('naturalWidth', 17)
  const open = page.getByRole('button', { name: 'Expand sidebar' })
  const drawer = page.getByRole('dialog', { name: 'Navigation drawer' })
  await open.click()
  await drawer.getByRole('link', { name: 'Notifications' }).click()
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
  await open.click()
  await drawer.getByRole('link', { name: 'Preferences' }).click()
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(picture).toHaveJSProperty('naturalWidth', 17)
  await open.click()
  await drawer.getByRole('button', { name: 'Back to app' }).click()
  await expect(page.getByRole('heading', { name: 'Good morning, International' })).toBeVisible()
  await open.click()
  await expect(drawer.getByRole('img', { name: replacement })).toHaveJSProperty('naturalWidth', 17)
  await drawer.getByRole('button', { name: replacement }).click()
  await expect(button).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Emir Karabeg', exact: true })).toBeVisible()
  await expect(picture).toHaveCount(0)
})
