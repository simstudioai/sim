import { checkCredentialFields } from '@/platform/checks/field-checks'
import { test } from '@/platform/checks/fixture-test'
import { fixtureOrigin } from '@/platform/checks/routes'

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
