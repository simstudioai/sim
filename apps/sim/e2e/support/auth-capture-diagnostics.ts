import type { Page } from '@playwright/test'

/**
 * Captures an auth failure only after proving that no entered password remains
 * in the login control. PNGs are intentionally outside the text/ZIP leak
 * scanner, so an uncertain clear must suppress the artifact.
 */
export async function captureSafeAuthFailureScreenshot(
  page: Page,
  screenshotPath: string,
  submittedPassword: string
): Promise<boolean> {
  const formFields = page.locator('input, textarea')
  try {
    const count = await formFields.count()
    for (let index = 0; index < count; index += 1) {
      const field = formFields.nth(index)
      if ((await field.inputValue()).includes(submittedPassword)) await field.fill('')
    }
    for (let index = 0; index < count; index += 1) {
      if ((await formFields.nth(index).inputValue()).includes(submittedPassword)) return false
    }
  } catch {
    return false
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true })
    return true
  } catch {
    return false
  }
}
