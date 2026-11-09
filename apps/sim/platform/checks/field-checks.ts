import { expect, type Page, type TestInfo } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { waitUntilHydrated } from '@/platform/checks/test'

/** Exercises field paint and clipboard feedback across the input and its sibling action. */
export async function checkCredentialFields(
  page: Page,
  origin: string,
  theme: string,
  testInfo: TestInfo,
  readClipboard: () => Promise<string>
) {
  await page.goto(fixtureUrl(`/integrations/gmail?state=full&theme=${theme}`, origin))
  await waitUntilHydrated(page)
  await page
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^emir@sim.ai / })
    .click()
  const field = page.getByRole('textbox', { name: 'Credential ID', exact: true })
  await expect(field).toHaveAttribute('readonly', '')
  const copy = page.getByRole('button', { name: 'Copy Credential ID', exact: true })
  await page.mouse.move(0, 0)
  await expect
    .poll(() => copy.evaluate((element) => element.checkVisibility({ opacityProperty: true })))
    .toBe(true)
  for (const label of ['Credential ID', 'Display name', 'Description']) {
    const control = page.getByRole('textbox', { name: label, exact: true })
    const frame = control.locator('..')
    const box = await frame.boundingBox()
    if (!box) throw new Error(`${label} is not visible`)
    const paints = []
    for (const fraction of [0.01, 0.4, 0.8, 0.99]) {
      await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2)
      paints.push(
        await frame.evaluate(async (element) => {
          const frames = []
          for (let index = 0; index < 6; index++) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            const css = getComputedStyle(element)
            frames.push([css.backgroundColor, css.borderColor, css.boxShadow, css.color])
          }
          return frames
        })
      )
    }
    await testInfo.attach(`${theme} ${label} paint samples`, {
      body: JSON.stringify(paints),
      contentType: 'application/json',
    })
    expect(new Set(paints.flat().map((paint) => JSON.stringify(paint))).size).toBe(1)
  }
  const value = await field.inputValue()
  await copy.click()
  const copiedAt = Date.now()
  await expect.poll(readClipboard).toBe(value)
  const copied = page.getByRole('button', { name: 'Copied', exact: true })
  const name = page.getByRole('textbox', { name: 'Display name', exact: true })
  await name.click()
  await expect(copied).toBeVisible()
  await expect.poll(() => copied.count(), { timeout: 5500 }).toBe(0)
  expect(Date.now() - copiedAt).toBeGreaterThanOrEqual(3500)
  await expect
    .poll(() => copy.evaluate((element) => element.checkVisibility({ opacityProperty: true })))
    .toBe(true)
  await field.focus()
  await expect
    .poll(() => copy.evaluate((element) => element.checkVisibility({ opacityProperty: true })))
    .toBe(true)
  await field.press('Tab')
  await expect(copy).toBeFocused()
  const description = page.getByRole('textbox', { name: 'Description', exact: true })
  await description.fill('A temporary draft to cancel.')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(description).not.toHaveValue('A temporary draft to cancel.')
  await page.screenshot({ path: testInfo.outputPath(`${theme}-credential-fields.png`) })
}
