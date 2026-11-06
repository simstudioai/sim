import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron, expect, test } from '@playwright/test'
import { checkCredentialFields } from '@/platform/checks/field-checks'

test('the actual desktop renderer shares product routes, reserves native chrome and preserves panel tabs', async () => {
  const testInfo = test.info()
  const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3182'
  const profile = await mkdtemp(path.join(tmpdir(), 'sim-platform-renderer-'))
  const app = await _electron.launch({
    cwd: path.resolve(__dirname, '../../../../desktop'),
    args: ['.'],
    env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: profile },
  })
  const page = await app.firstWindow()
  const window = await app.browserWindow(page)
  try {
    await window.evaluate((native) => native.setContentSize(960, 720))
    await page.waitForURL((url) => url.origin === origin)
    for (const theme of ['light', 'dark']) {
      await checkCredentialFields(page, origin, theme, testInfo, () =>
        app.evaluate(({ clipboard }) => clipboard.readText())
      )
    }
    await page.goto(`${origin}/home?theme=dark&state=full`)
    await expect(page.locator('html')).toHaveAttribute('data-sim-desktop-title-bar', 'inset')
    await expect(
      page.getByRole('list', { name: 'Recents' }).getByRole('link', { name: 'GitHub' })
    ).toBeVisible()
    const nav = page.getByRole('region', { name: 'Platform navigation' })
    await nav.getByRole('link', { name: 'Integrations', exact: true }).click()
    const memberPage = page.getByRole('main')
    await memberPage.getByRole('searchbox', { name: 'Search apps' }).fill('Gmail')
    await memberPage.getByRole('link', { name: /^Gmail / }).click()
    await memberPage
      .getByRole('region', { name: 'Connected credentials', exact: true })
      .getByRole('button', { name: /^emir@sim.ai / })
      .click()
    await memberPage.getByRole('tab', { name: 'Permissions', exact: true }).click()
    const send = memberPage.getByRole('group', { name: 'Gmail Send permission' })
    await send.getByRole('radio', { name: 'Ask' }).press('ArrowRight')
    const blocked = send.getByRole('radio', { name: 'Block' })
    await expect(blocked).toBeChecked()
    await expect(blocked).toBeFocused()
    const chatLink = nav.getByRole('link', { name: 'Review the renewal brief' })
    await chatLink.scrollIntoViewIfNeeded()
    const position = await nav.evaluate((element) => element.scrollTop)
    expect(position).toBeGreaterThan(0)
    await chatLink.click()
    await expect(page).toHaveURL(/\/chat\/weekly-review\?/)
    expect(await nav.evaluate((element) => element.scrollTop)).toBe(position)
    await page.getByRole('button', { name: 'Open chat panel' }).press('Enter')
    const panel = page.getByRole('complementary', { name: 'Chat panel' })
    await expect(panel.getByRole('button', { name: 'New panel tab' })).toBeFocused()
    await panel.getByRole('button', { name: 'Terminal Run commands in this session' }).click()
    await panel.getByRole('button', { name: 'Panel tabs' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Terminal' })).toBeChecked()
    await page.keyboard.press('Escape')
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
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(panel.getByRole('tab', { selected: true })).toHaveAccessibleName('Linear')
    await panel.getByRole('button', { name: 'Expand panel' }).click()
    const navigation = await page.getByRole('button', { name: 'Expand sidebar' }).boundingBox()
    const firstTab = panel.getByRole('tab', { name: 'Terminal' })
    const firstTabBox = await firstTab.boundingBox()
    if (!navigation || !firstTabBox) throw new Error('The navigation and first tab must be visible')
    expect(firstTabBox.x).toBeGreaterThanOrEqual(navigation.x + navigation.width)
    await firstTab.click()
    await expect(panel.getByRole('region', { name: 'Terminal history' })).toBeVisible()
    await panel.getByRole('button', { name: 'Restore split panel' }).click()
    await window.evaluate((native) => native.setFullScreen(true))
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
