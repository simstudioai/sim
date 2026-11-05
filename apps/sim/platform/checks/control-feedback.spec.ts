import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('either half of a binary mode control switches the composer without breaking keyboard selection', async ({
  page,
}) => {
  await page.goto(`${origin}/home?state=full`)
  const build = page.getByRole('radio', { name: 'Build' })
  const search = page.getByRole('radio', { name: 'Search', exact: true })
  await expect(build).toBeChecked()
  await build.click()
  await expect(search).toBeChecked()
  await expect(page.getByRole('textbox', { name: /Search your company/ })).toBeVisible()
  await search.click()
  await expect(build).toBeChecked()
  await build.press('ArrowRight')
  await expect(search).toBeChecked()
})

test('a notice stays actionable while hovered and can be reopened after its feedback period', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto(`${origin}/home?state=full`)
  await page.getByRole('button', { name: 'Customize Home' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email', exact: true }).click()
  await page.keyboard.press('Escape')
  const tray = page.getByRole('region', { name: 'Notification stack' })
  const undo = tray.getByRole('button', { name: 'Undo' })
  await undo.hover()
  await page.clock.fastForward(5000)
  await expect(undo).toBeVisible()
  await page.getByRole('heading', { name: 'Tasks run' }).hover()
  await page.clock.fastForward(5000)
  await expect(undo).toBeHidden()
  await tray.getByRole('button', { name: /notifications?$/ }).click()
  await undo.click()
  await expect(page.getByRole('region', { name: 'Email', exact: true })).toBeVisible()
})
