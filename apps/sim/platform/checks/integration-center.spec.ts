import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('credential scope hides personal secret sources from shared results and survives details', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=stress&tab=credentials`)
  const main = page.getByRole('main')
  const secrets = main.getByRole('link', { name: /^Generic Secrets / })
  await expect(secrets).toBeVisible()
  await main.getByRole('button', { name: /^Sharing:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Shared', exact: true }).click()
  await expect(secrets).toHaveCount(0)
  await main.getByRole('button', { name: /^Sharing:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Personal', exact: true }).click()
  await secrets.click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(main.getByRole('button', { name: /^Sharing:/ })).toContainText('Personal')
  await expect(secrets).toBeVisible()
})

test('directory filters and ordering survive app details and resource browser history', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: /^App category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Email', exact: true }).click()
  await main.getByRole('button', { name: 'Sort integrations', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Name Z–A', exact: true }).click()
  await expect(
    main.getByRole('region', { name: 'Connected', exact: true }).getByRole('link').first()
  ).toContainText('Gmail')
  await main.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('gmail')
  await main.getByRole('link', { name: /^Gmail / }).click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(main.getByRole('searchbox', { name: 'Search apps', exact: true })).toHaveValue(
    'gmail'
  )
  await expect(main.getByRole('button', { name: /^App category:/ })).toContainText('Email')
  await expect(page).toHaveURL(/order=desc/)
  await expect(main.getByRole('link', { name: /^Fireflies / })).toHaveCount(0)

  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click()
  await main.getByRole('button', { name: /^Sharing:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Personal', exact: true }).click()
  await main.getByRole('searchbox', { name: 'Search skills', exact: true }).fill('preparation')
  await main.getByRole('button', { name: /^Meeting preparation / }).click()
  await expect(page.getByRole('dialog', { name: 'Edit skill', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(main.getByRole('searchbox', { name: 'Search skills', exact: true })).toHaveValue(
    'preparation'
  )
  await expect(main.getByRole('button', { name: /^Sharing:/ })).toContainText('Personal')
  await expect(main.getByRole('button', { name: /^Weekly customer review / })).toHaveCount(0)
})

test('app roster overflow stays passive while avatars explain people and the whole row opens details', async ({
  page,
}) => {
  for (const [scenario, count, accessibleCount] of [
    ['full', '+13', '13 others'],
    ['stress', '+1k', '1000 others'],
  ]) {
    await page.goto(`${origin}/integrations?state=${scenario}`)
    const gmail = page.getByRole('main').getByRole('link', { name: /^Gmail / })
    const people = gmail.getByRole('group', { name: 'Used by', exact: true })
    await expect(people.getByRole('button')).toHaveCount(0)
    const overflow = people.getByLabel(accessibleCount, { exact: true })
    await expect(overflow).toHaveText(count)
    const nina = people.getByRole('img', { name: 'Nina Patel', exact: true })
    await expect
      .poll(() =>
        nina
          .locator('img')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
      )
      .toBe(true)
    await nina.hover()
    await expect(page.getByRole('tooltip', { name: 'Nina Patel', exact: true })).toBeVisible()
    await overflow.click()
    await expect(page).toHaveURL(/\/integrations\/gmail/)
    await expect(page.getByRole('heading', { name: 'Gmail', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
})

test('editing a shared skill preserves its members and survives leaving the directory', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full&tab=skills`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: /^Weekly customer review / }).click()
  const editor = page.getByRole('dialog', { name: 'Edit skill', exact: true })
  await editor
    .getByLabel('Description', { exact: true })
    .fill('Include renewal decisions in the weekly account review.')
  await editor.getByRole('combobox', { name: /^People with access:/ }).click()
  await expect(page.getByRole('option', { name: 'Emir Karabeg', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await page.getByRole('option', { name: 'Alex Chen', exact: true }).click()
  await page.keyboard.press('Escape')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const navigation = page.getByRole('region', { name: 'Platform navigation' })
  await navigation.getByRole('link', { name: 'Home', exact: true }).click()
  await navigation.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click()
  await main.getByRole('button', { name: /^Weekly customer review / }).click()
  await expect(editor.getByLabel('Description', { exact: true })).toHaveValue(
    'Include renewal decisions in the weekly account review.'
  )
  await editor.getByRole('combobox', { name: /^People with access:/ }).click()
  for (const name of ['Emir Karabeg', 'Maya Thompson', 'Alex Chen']) {
    await expect(page.getByRole('option', { name, exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  }
})

test('shared creation needs a recipient and deletion affects only the confirmed resource', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full&tab=skills`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Create skill', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Create skill', exact: true })
  await editor.getByLabel('Name', { exact: true }).fill('Daily account brief')
  await editor.getByLabel('Description', { exact: true }).fill('Prepare the daily handoff.')
  await editor
    .getByLabel('Instructions', { exact: true })
    .fill('Summarize open decisions and cite each source.')
  await editor.getByRole('combobox', { name: 'Access', exact: true }).click()
  await page.getByRole('option', { name: 'Shared', exact: true }).click()
  await editor.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Choose at least one person')
  await editor.getByRole('combobox', { name: /^People with access:/ }).click()
  await page.getByRole('option', { name: 'Nina Patel', exact: true }).click()
  await page.keyboard.press('Escape')
  await editor.getByRole('button', { name: 'Create', exact: true }).click()
  const added = main
    .getByRole('region', { name: 'Shared', exact: true })
    .getByRole('button', { name: /^Daily account brief / })
  await expect(added).toBeVisible()
  await main.getByRole('button', { name: 'Manage Daily account brief', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const confirmation = page.getByRole('dialog', {
    name: 'Delete Daily account brief?',
    exact: true,
  })
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(added).toBeVisible()
  await main.getByRole('button', { name: 'Manage Daily account brief', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(added).toHaveCount(0)
  await expect(main.getByRole('button', { name: /^Weekly customer review / })).toBeVisible()
})

test('MCP and credential examples retain metadata without sending writes or retaining secrets', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  })
  await page.goto(`${origin}/integrations?state=full&tab=mcps`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Connect MCP', exact: true }).click()
  const mcp = page.getByRole('dialog', { name: 'Create MCP', exact: true })
  await mcp.getByLabel('Name', { exact: true }).fill('Test research server')
  await mcp.getByLabel('Server URL', { exact: true }).fill('https://research.example.com/mcp')
  await mcp.getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  await mcp.getByLabel('Token', { exact: true }).fill('integration-center-test-token')
  await mcp.getByRole('button', { name: 'Connect', exact: true }).click()
  await main.getByRole('button', { name: /^Test research server(?: |$)/ }).click()
  const editMcp = page.getByRole('dialog', { name: 'Edit MCP', exact: true })
  await expect(editMcp.getByLabel('Server URL', { exact: true })).toHaveValue(
    'https://research.example.com/mcp'
  )
  await expect(editMcp.getByLabel('Token', { exact: true })).toHaveValue('')
  await editMcp.getByRole('button', { name: 'Cancel', exact: true }).click()

  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Credentials', exact: true })
    .click()
  await main.getByRole('button', { name: 'Create credential', exact: true }).click()
  const credential = page.getByRole('dialog', { name: 'Create credential', exact: true })
  await credential.getByLabel('Name', { exact: true }).fill('Test research key')
  await credential.getByLabel('Key', { exact: true }).fill('RESEARCH_KEY')
  await credential.getByLabel('Value', { exact: true }).fill('integration-center-test-secret')
  await credential.getByRole('button', { name: 'Create', exact: true }).click()
  await main.getByRole('button', { name: /^Test research key(?: |$)/ }).click()
  const editCredential = page.getByRole('dialog', { name: 'Edit credential', exact: true })
  await expect(editCredential.getByLabel('Key', { exact: true })).toHaveValue('RESEARCH_KEY')
  await expect(editCredential.getByLabel('Replace value', { exact: true })).toHaveValue('')
  await editCredential.getByRole('button', { name: 'Cancel', exact: true }).click()
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toContain('integration-center-test-token')
  expect(storage).not.toContain('integration-center-test-secret')
  expect(writes).toEqual([])
})

test('directory controls remain reachable without overlapping at intermediate widths', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full`)
  const main = page.getByRole('main')
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    for (const tab of ['Apps', 'Credentials']) {
      await main
        .getByRole('navigation', { name: 'Integration categories' })
        .getByRole('link', { name: tab, exact: true })
        .click()
      const controls = [
        main.getByRole('searchbox', {
          name: tab === 'Apps' ? 'Search apps' : 'Search credentials',
          exact: true,
        }),
        main.getByRole('button', { name: tab === 'Apps' ? /^App category:/ : /^Sharing:/ }),
        main.getByRole('button', { name: 'Sort integrations', exact: true }),
        ...(tab === 'Credentials'
          ? [main.getByRole('button', { name: 'Create credential', exact: true })]
          : []),
      ]
      const boxes = await Promise.all(
        controls.map(async (control) => {
          await expect(control).toBeVisible()
          const box = await control.boundingBox()
          if (!box) throw new Error('A directory control has no visible bounds')
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
          return box
        })
      )
      for (const [index, box] of boxes.entries()) {
        for (const other of boxes.slice(index + 1)) {
          const overlapWidth =
            Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x)
          const overlapHeight =
            Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y)
          expect(overlapWidth > 1 && overlapHeight > 1).toBe(false)
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      )
    }
  }
})

test('disabling fixtures exposes no resource examples or creation controls', async ({ page }) => {
  for (const tab of ['skills', 'mcps', 'credentials']) {
    await page.goto(`http://127.0.0.1:3180/integrations?state=full&tab=${tab}`)
    const main = page.getByRole('main')
    await expect(
      main.getByRole('button', { name: /^(Create skill|Connect MCP|Create credential)$/ })
    ).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Weekly customer review / })).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Customer knowledge / })).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Research API / })).toHaveCount(0)
  }
})
