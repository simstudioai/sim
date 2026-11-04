import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron, expect, test } from '@playwright/test'

test('the actual desktop renderer shares product routes, reserves native chrome and preserves panel tabs', async () => {
  const testInfo = test.info()
  const origin = 'http://127.0.0.1:3182'
  const profile = await mkdtemp(path.join(tmpdir(), 'sim-platform-renderer-'))
  const app = await _electron.launch({
    cwd: path.resolve(__dirname, '../../../../desktop'),
    args: ['.'],
    env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: profile },
  })
  const page = await app.firstWindow()
  try {
    await page.waitForURL((url) => url.origin === origin)
    await page.goto(`${origin}/chat/weekly-review?theme=dark&state=full`)
    await expect(page.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'inset')
    await expect(page.getByRole('button', { name: 'Open chat panel' })).toBeVisible()
    await page.getByRole('button', { name: 'Open chat panel' }).click()
    const panel = page.getByRole('complementary', { name: 'Chat panel' })
    await panel.getByRole('button', { name: 'Terminal Run commands in this session' }).click()
    await expect(panel.getByRole('tab', { selected: true })).toHaveAccessibleName('Terminal')
    await expect(panel.getByRole('region', { name: 'Terminal history' })).toContainText(
      'customer-operations'
    )
    await panel.getByRole('button', { name: 'New panel tab' }).click()
    await panel.getByRole('button', { name: 'Linear', exact: true }).click()
    await panel.getByRole('button', { name: 'Browser actions' }).click()
    await page.getByRole('menuitem', { name: /Zoom/ }).hover()
    await page.getByRole('menuitemradio', { name: '125%' }).click()
    const image = panel.getByRole('img', { name: 'Linear homepage' })
    await expect(image).toBeVisible()
    expect(
      await image.evaluate(
        (el) => el.getBoundingClientRect().width / (el.parentElement?.clientWidth || 1)
      )
    ).toBeCloseTo(1.25, 1)
    await page.screenshot({ path: testInfo.outputPath('desktop-chat.png') })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.isVisible())
        ?.setFullScreen(true)
    )
    await expect(page.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'fullscreen')
    await panel.getByRole('tab', { name: 'Terminal' }).click()
    await expect(panel.getByRole('region', { name: 'Terminal history' })).toBeVisible()
  } finally {
    if (testInfo.status !== testInfo.expectedStatus)
      await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {})
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
