#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

/** Verifies advertised open states against the isolated running Studio fixture app. */
const url = new URL(process.env.SIM_STUDIO_E2E_URL ?? 'http://127.0.0.1:3002')
const reportPath = process.env.SIM_STUDIO_E2E_REPORT_PATH
if (!reportPath) throw new Error('SIM_STUDIO_E2E_REPORT_PATH is required')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  throw new Error('The fixture server must be loopback')
const directory = path.dirname(path.resolve(reportPath))
mkdirSync(directory, { recursive: true })
const results = []
let browser
let suiteError
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--deterministic-mode',
      '--disable-gpu',
      '--disable-skia-runtime-opts',
      '--disable-partial-raster',
    ],
  })
  const context = await browser.newContext({
    viewport: { width: 460, height: 320 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.clock.install({ time: new Date('2026-09-23T12:00:00Z') })
  for (const [id, extra, selector] of [
    ['wizard', { state: 'open' }, '[role=dialog]'],
    ['chip-modal', { state: 'open' }, '[role=dialog]'],
    ['chip-modal', { axis: 'open', value: 'true' }, '[role=dialog]'],
    ['tooltip', { state: 'open', export: 'Tooltip.Content' }, '[role=tooltip]'],
    ['dropdown-menu-sub-content', { action: 'open-submenu' }, '[data-studio-submenu]'],
    ['popover', { action: 'open-folder' }, '[data-studio-back-button]'],
  ])
    for (const theme of ['light', 'dark'])
      for (const size of [16, 20]) {
        if (
          process.env.SIM_STUDIO_E2E_CASE &&
          !process.env.SIM_STUDIO_E2E_CASE.split(',').includes(id)
        )
          continue
        const scenario = extra.axis
          ? `${extra.axis}=${extra.value}`
          : extra.export
            ? `${extra.export}-${extra.state}`
            : (extra.action ?? `state=${extra.state}`)
        const name = `${id}-${scenario}-${theme}-${size}`
        const start = performance.now()
        const screenshot = path.join(directory, `${name}.png`)
        let error
        let screenshotSaved = false
        try {
          const params = new URLSearchParams({
            kind: 'component',
            id,
            theme,
            size: String(size),
            ...extra,
          })
          const response = await page.goto(new URL(`/fixture?${params}`, url).href, {
            waitUntil: 'domcontentloaded',
          })
          assert.equal(response?.status(), 200)
          await page.locator('[data-studio-fixture]').waitFor()
          await page.locator(`${selector}:visible`).first().waitFor({ timeout: 3000 })
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(150)
          const rootSize = await page.evaluate(
            () => getComputedStyle(document.documentElement).fontSize
          )
          assert.equal(rootSize, `${size}px`)
          const rootDark = await page.evaluate(() =>
            document.documentElement.classList.contains('dark')
          )
          assert.equal(rootDark, theme === 'dark')
        } catch (failure) {
          error = String(failure)
        }
        try {
          await page.screenshot({ path: screenshot, animations: 'disabled' })
          screenshotSaved = true
        } catch (failure) {
          error ??= `Screenshot failed: ${failure}`
        }
        results.push({
          name,
          status: error ? 'failed' : 'passed',
          durationMs: Math.round(performance.now() - start),
          ...(screenshotSaved ? { screenshot } : {}),
          ...(error ? { error } : {}),
        })
      }
  await context.close()
} catch (failure) {
  suiteError = String(failure)
} finally {
  if (!results.length && !suiteError) suiteError = 'No fixture cases matched SIM_STUDIO_E2E_CASE'
  try {
    await browser?.close()
  } catch (failure) {
    suiteError ??= String(failure)
  } finally {
    writeFileSync(
      reportPath,
      `${JSON.stringify({ url: url.href, results, ...(suiteError ? { error: suiteError } : {}) }, null, 2)}\n`
    )
  }
}
process.stdout.write(
  `${results.filter((result) => result.status === 'passed').length}/${results.length} fixture checks passed; report ${reportPath}\n`
)
process.exitCode = suiteError || results.some((result) => result.status === 'failed') ? 1 : 0
