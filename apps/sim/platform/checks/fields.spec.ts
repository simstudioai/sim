import { checkCredentialFields } from '@/platform/checks/field-checks'
import { fixtureOrigin } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

for (const theme of ['light', 'dark']) {
  test(`${theme} credential fields retain stable hover, copy feedback and keyboard access`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await checkCredentialFields(page, fixtureOrigin, theme, test.info(), () =>
      page.evaluate(() => navigator.clipboard.readText())
    )
  })
}
