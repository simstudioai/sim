import { test } from '@playwright/test'
import { checkCredentialFields } from '@/platform/checks/field-checks'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

for (const theme of ['light', 'dark']) {
  test(`${theme} credential fields retain stable hover, copy feedback and keyboard access`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await checkCredentialFields(page, origin, theme, test.info(), () =>
      page.evaluate(() => navigator.clipboard.readText())
    )
  })
}
