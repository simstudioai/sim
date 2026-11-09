import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  _electron,
  type ElectronApplication,
  expect,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test'
import { checkCredentialFields } from '@/platform/checks/field-checks'
import { desktopOrigin, fixtureUrl } from '@/platform/checks/routes'

/**
 * Attaches what the window showed when a step failed. Playwright's automatic failure screenshot
 * and page snapshot cover only its own browser pages, never an Electron window, and
 * `testInfo.status` still reads as passing inside the test body, so this runs from the catch.
 */
async function attachPageState(page: Page, testInfo: TestInfo) {
  await testInfo.attach('url', { body: page.url(), contentType: 'text/plain' })
  const screenshot = await page.screenshot().catch(() => null)
  if (screenshot) await testInfo.attach('failure', { body: screenshot, contentType: 'image/png' })
  const text = await page
    .locator('body')
    .innerText({ timeout: 5_000 })
    .catch((error: unknown) => `The body text could not be read: ${String(error)}`)
  await testInfo.attach('body-text', { body: text, contentType: 'text/plain' })
}

/**
 * Collects the shell's main-process output, each line stamped with when it arrived, so a failure
 * shows what the shell did. Navigation events from {@link watchNavigation} arrive on stdout.
 */
function recordMainProcess(app: ElectronApplication) {
  const lines: string[] = []
  const record = (stream: string) => (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line) lines.push(`${new Date().toISOString()} [${stream}] ${line}`)
    }
  }
  app.process().stdout?.on('data', record('stdout'))
  app.process().stderr?.on('data', record('stderr'))
  return lines
}

/** Logs every main-frame navigation of every web contents, present and future, to stdout. */
function watchNavigation(app: ElectronApplication) {
  return app.evaluate(({ app: shell, webContents }) => {
    const watch = (contents: ReturnType<typeof webContents.getAllWebContents>[number]) => {
      const log = (event: string, detail: string) =>
        console.log(
          `[navigation] ${new Date().toISOString()} #${contents.id} ${contents.getType()} ${event} ${detail}`
        )
      contents.on('did-start-navigation', (details) => {
        if (details.isMainFrame) log('start', details.url)
      })
      contents.on('did-redirect-navigation', (details) => {
        if (details.isMainFrame) log('redirect', details.url)
      })
      contents.on('did-navigate', (_event, url, status) => log('commit', `${status} ${url}`))
      contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) log('fail', `${code} ${description} ${url}`)
      })
      contents.on('did-finish-load', () => log('finish', contents.getURL()))
      contents.on('render-process-gone', (_event, details) => log('renderer-gone', details.reason))
      log('watching', contents.getURL())
    }
    for (const contents of webContents.getAllWebContents()) watch(contents)
    shell.on('web-contents-created', (_event, contents) => watch(contents))
  })
}

/** Attaches the main-process log and every window's state as the shell reports it. */
async function attachMainProcessState(
  app: ElectronApplication,
  output: string[],
  testInfo: TestInfo
) {
  const windows = await Promise.race([
    app.evaluate(({ BrowserWindow, webContents }) =>
      JSON.stringify(
        {
          windows: BrowserWindow.getAllWindows().length,
          contents: webContents.getAllWebContents().map((contents) => ({
            id: contents.id,
            type: contents.getType(),
            url: contents.getURL(),
            loading: contents.isLoading(),
            crashed: contents.isCrashed(),
          })),
        },
        null,
        2
      )
    ),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve('The main process did not answer within 5 seconds'), 5_000)
    ),
  ]).catch((error: unknown) => `The main process could not be read: ${String(error)}`)
  await testInfo.attach('shell-windows', { body: windows, contentType: 'application/json' })
  await testInfo.attach('main-process', { body: output.join('\n'), contentType: 'text/plain' })
}

test('the actual desktop renderer shares product routes, reserves native chrome and preserves panel tabs', async () => {
  const testInfo = test.info()
  const profile = await mkdtemp(path.join(tmpdir(), 'sim-platform-renderer-'))
  const app = await _electron.launch({
    cwd: path.resolve(__dirname, '../../../../desktop'),
    args: ['.'],
    env: { ...process.env, SIM_DESKTOP_ORIGIN: desktopOrigin, SIM_DESKTOP_USER_DATA: profile },
  })
  const mainProcessOutput = recordMainProcess(app)
  let page: Page | undefined
  try {
    await watchNavigation(app)
    page = await app.firstWindow()
    const window = await app.browserWindow(page)
    await window.evaluate((native) => native.setContentSize(960, 720))
    await page.waitForURL((url) => url.origin === desktopOrigin)
    for (const theme of ['light', 'dark']) {
      await checkCredentialFields(page, desktopOrigin, theme, testInfo, () =>
        app.evaluate(({ clipboard }) => clipboard.readText())
      )
    }
    await page.goto(fixtureUrl('/home?theme=dark&state=full', desktopOrigin))
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
  } catch (error) {
    await attachMainProcessState(app, mainProcessOutput, testInfo)
    if (page) await attachPageState(page, testInfo)
    throw error
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
