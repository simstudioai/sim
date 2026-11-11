import { expect } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

test('credential scope hides personal secret sources from shared results and survives details', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/integrations?state=stress&tab=credentials'))
  const main = page.getByRole('main')
  const secrets = main.getByRole('link', { name: /^Generic Secrets / })
  await expect(secrets).toBeVisible()
  await main.getByRole('button', { name: /^Category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Shared', exact: true }).click()
  await expect(secrets).toHaveCount(0)
  await main.getByRole('button', { name: /^Category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Personal', exact: true }).click()
  await secrets.click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(main.getByRole('button', { name: /^Category:/ })).toContainText('Personal')
  await expect(secrets).toBeVisible()
})

test('directory filters and ordering survive app details and resource browser history', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/integrations?state=full'))
  const main = page.getByRole('main')
  await main.getByRole('button', { name: /^App filter:/ }).click()
  await page.getByRole('menuitem', { name: 'Categories', exact: true }).press('ArrowRight')
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
  await expect(main.getByRole('button', { name: /^App filter:/ })).toContainText('Email')
  await expect(page).toHaveURL(/order=desc/)
  await expect(main.getByRole('link', { name: /^Fireflies / })).toHaveCount(0)
  await main.getByRole('button', { name: /^App filter:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Available', exact: true }).click()
  await expect(page).toHaveURL(/connection=available/)
  await expect(page).not.toHaveURL(/category=/)
  await main.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('')
  await expect(main.getByRole('link', { name: /^Gmail / })).toHaveCount(0)
  await main.getByRole('button', { name: /^App filter:/ }).click()
  await page.getByRole('menuitem', { name: 'Categories', exact: true }).press('ArrowRight')
  await page.getByRole('menuitemradio', { name: 'Email', exact: true }).click()
  await expect(page).not.toHaveURL(/connection=/)
  await expect(main.getByRole('link', { name: /^Gmail / })).toBeVisible()

  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click()
  await main.getByRole('button', { name: /^Category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Personal', exact: true }).click()
  await main.getByRole('searchbox', { name: 'Search skills', exact: true }).fill('preparation')
  await main.getByRole('link', { name: /^Meeting preparation / }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(main.getByRole('textbox', { name: 'Instructions', exact: true })).toBeEditable()
  await expect(
    main.getByRole('navigation', { name: 'Skills navigation', exact: true }).getByRole('link')
  ).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(main.getByRole('searchbox', { name: 'Search skills', exact: true })).toHaveValue(
    'preparation'
  )
  await expect(main.getByRole('button', { name: /^Category:/ })).toContainText('Personal')
  await expect(main.getByRole('link', { name: /^Weekly customer review / })).toHaveCount(0)
})

test('available app usage stays inline and passive while connected counts include shared credentials', async ({
  page,
}) => {
  for (const [scenario, others, githubCount] of [
    ['full', '13 others', '1 connected credential'],
    ['stress', '1,000 others', '2 connected credentials'],
  ]) {
    await page.goto(fixtureUrl(`/integrations?state=${scenario}`))
    const main = page.getByRole('main')
    const notion = main.getByRole('link', { name: /^Notion / })
    await expect(notion).toContainText('Used by')
    await expect(notion.locator('img')).toHaveCount(2)
    await expect(notion.getByRole('button')).toHaveCount(0)
    await expect
      .poll(() =>
        notion
          .locator('img')
          .first()
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
      )
      .toBe(true)
    await expect(notion).toContainText(`Nina Patel, Alex Chen, and ${others}`)
    const overflow = notion.getByText(others, { exact: true })
    await expect(overflow).toBeVisible()
    const usageCenters = await Promise.all([
      notion.getByText(/^Nina Patel,?\s*$/).evaluate((node) => {
        const box = node.getBoundingClientRect()
        return box.y + box.height / 2
      }),
      overflow.evaluate((node) => {
        const box = node.getBoundingClientRect()
        return box.y + box.height / 2
      }),
    ])
    expect(Math.abs(usageCenters[0] - usageCenters[1])).toBeLessThanOrEqual(0.25)
    const gmail = main.getByRole('link', { name: /^Gmail / })
    await expect(gmail).toContainText('2 connected credentials')
    await expect(gmail.getByRole('img')).toHaveCount(0)
    await expect(gmail).not.toContainText('Used by')
    await expect(main.getByRole('link', { name: /^GitHub / })).toContainText(githubCount)
    await overflow.click()
    await expect(page).toHaveURL(/\/integrations\/notion/)
    await expect(page.getByRole('heading', { name: 'Notion', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(main).toContainText(`Used by Nina Patel, Alex Chen, and ${others}`)
    await main.getByRole('link', { name: 'Integrations', exact: true }).click()
    await gmail.click()
    await expect(main).not.toContainText('Used by')
  }
})

test('editing a shared skill preserves its members and survives leaving the directory', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/integrations?state=full&tab=skills'))
  const main = page.getByRole('main')
  await main.getByRole('link', { name: /^Weekly customer review / }).click()
  const editor = main.getByRole('form', { name: 'Skill details', exact: true })
  await editor
    .getByLabel('Description', { exact: true })
    .fill('Include renewal decisions in the weekly account review.')
  await editor.getByRole('tab', { name: 'Access', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Access', exact: true })).toBeEnabled()
  await editor.getByRole('combobox', { name: 'People with access', exact: true }).click()
  await expect(page.getByRole('option', { name: 'Emir Karabeg', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await page.getByRole('option', { name: 'Alex Chen', exact: true }).click()
  await page.keyboard.press('Escape')
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  const navigation = page.getByRole('region', { name: 'Platform navigation' })
  await navigation.getByRole('link', { name: 'Home', exact: true }).click()
  await navigation.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click()
  await main.getByRole('link', { name: /^Weekly customer review / }).click()
  await expect(editor.getByLabel('Description', { exact: true })).toHaveValue(
    'Include renewal decisions in the weekly account review.'
  )
  await editor.getByRole('tab', { name: 'Access', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Access', exact: true })).toBeEnabled()
  await editor.getByRole('combobox', { name: 'People with access', exact: true }).click()
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
  await page.goto(fixtureUrl('/integrations?state=full&tab=skills'))
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Create skill', exact: true }).click()
  const editor = main.getByRole('form', { name: 'Skill details', exact: true })
  await editor.getByLabel('Name', { exact: true }).fill('Daily account brief')
  await editor.getByLabel('Description', { exact: true }).fill('Prepare the daily handoff.')
  await editor
    .getByLabel('Instructions', { exact: true })
    .fill('Summarize open decisions and cite each source.')
  await editor.getByRole('tab', { name: 'Access', exact: true }).click()
  await editor.getByRole('combobox', { name: 'Access', exact: true }).click()
  await page.getByRole('option', { name: 'Shared', exact: true }).click()
  await editor.getByRole('button', { name: 'Create skill', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('Choose at least one person')
  await editor.getByRole('tab', { name: 'Access', exact: true }).click()
  await expect(editor.getByRole('combobox', { name: 'Access', exact: true })).toBeEnabled()
  await editor.getByRole('combobox', { name: 'People with access', exact: true }).click()
  await page.getByRole('option', { name: 'Nina Patel', exact: true }).click()
  await page.keyboard.press('Escape')
  await editor.getByRole('button', { name: 'Create skill', exact: true }).click()
  const added = main
    .getByRole('region', { name: 'Shared', exact: true })
    .getByRole('link', { name: /^Daily account brief / })
  await expect(
    main.getByRole('heading', { name: 'Daily account brief', exact: true })
  ).toBeVisible()
  const savedEditor = editor
  await savedEditor.getByRole('button', { name: 'Delete skill', exact: true }).click()
  const confirmation = page.getByRole('dialog', {
    name: 'Delete Daily account brief',
    exact: true,
  })
  await expect(confirmation).toContainText('This removes the skill from your integrations.')
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(savedEditor).toBeVisible()
  await savedEditor.getByRole('button', { name: 'Delete skill', exact: true }).click()
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(added).toHaveCount(0)
  await expect(main.getByRole('link', { name: /^Weekly customer review / })).toBeVisible()
})

test('MCP and credential examples retain metadata without sending writes or retaining secrets', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  })
  await page.goto(fixtureUrl('/integrations?state=full&tab=mcps'))
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Connect MCP', exact: true }).click()
  const mcp = main.getByRole('form', { name: 'MCP details', exact: true })
  await mcp.getByLabel('Name', { exact: true }).fill('Test research server')
  await mcp.getByLabel('Server URL', { exact: true }).fill('https://research.example.com/mcp')
  await mcp.getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  await mcp.getByLabel('Token', { exact: true }).fill('integration-center-test-token')
  await mcp.getByRole('tab', { name: 'Access', exact: true }).click()
  await mcp.getByRole('tab', { name: 'Details', exact: true }).click()
  await expect(mcp.getByLabel('Token', { exact: true })).toHaveValue(
    'integration-center-test-token'
  )
  await mcp.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(
    main.getByRole('heading', { name: 'Test research server', exact: true })
  ).toBeVisible()
  const editMcp = mcp
  await expect(editMcp.getByLabel('Server URL', { exact: true })).toHaveValue(
    'https://research.example.com/mcp'
  )
  await expect(editMcp.getByLabel('Token', { exact: true })).toHaveValue('')
  await editMcp.getByLabel('Token', { exact: true }).fill('integration-center-replacement-token')
  await editMcp.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editMcp.getByLabel('Token', { exact: true })).toHaveValue('')
  await editMcp.getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'None', exact: true }).click()
  await editMcp.getByRole('button', { name: 'Save', exact: true }).click()
  await editMcp.getByRole('combobox', { name: 'Authentication', exact: true }).click()
  await page.getByRole('option', { name: 'Bearer token', exact: true }).click()
  await editMcp.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editMcp.getByRole('alert')).toContainText('Enter a bearer token.')
  await editMcp.getByLabel('Token', { exact: true }).fill('integration-center-discard-token')
  await main
    .getByRole('navigation', { name: 'MCPs navigation', exact: true })
    .getByRole('link')
    .click()
  const discard = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(editMcp.getByLabel('Token', { exact: true })).toHaveValue(
    'integration-center-discard-token'
  )
  await main
    .getByRole('navigation', { name: 'MCPs navigation', exact: true })
    .getByRole('link')
    .click()
  await discard.getByRole('button', { name: 'Discard', exact: true }).click()
  await main.getByRole('link', { name: /^Test research server(?: |$)/ }).click()
  await expect(
    editMcp.getByRole('combobox', { name: 'Authentication', exact: true })
  ).toContainText('None')
  await expect(editMcp.getByLabel('Token', { exact: true })).toHaveCount(0)
  await main
    .getByRole('navigation', { name: 'MCPs navigation', exact: true })
    .getByRole('link')
    .click()

  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Credentials', exact: true })
    .click()
  await main.getByRole('button', { name: 'Create credential', exact: true }).click()
  const credential = page.getByRole('dialog', { name: 'Create credential', exact: true })
  await credential.getByLabel('Name', { exact: true }).fill('Test research key')
  await credential.getByLabel('Key', { exact: true }).fill('RESEARCH_KEY')
  await credential.getByLabel('Value', { exact: true }).fill('integration-center-test-secret')
  await credential.getByRole('button', { name: 'Create credential', exact: true }).click()
  await main.getByRole('button', { name: /^Test research key(?: |$)/ }).click()
  await expect(main.getByLabel('Key', { exact: true })).toHaveValue('RESEARCH_KEY')
  await expect(main.getByRole('tab', { name: 'Access', exact: true })).toBeVisible()
  await main.getByRole('button', { name: 'Replace value', exact: true }).click()
  const replacement = page.getByRole('dialog', { name: 'Replace Test research key', exact: true })
  await expect(replacement.getByLabel('Replace value', { exact: true })).toHaveValue('')
  await replacement.getByRole('button', { name: 'Cancel', exact: true }).click()
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toContain('integration-center-test-token')
  expect(storage).not.toContain('integration-center-test-secret')
  expect(storage).not.toContain('integration-center-replacement-token')
  expect(storage).not.toContain('integration-center-discard-token')
  expect(writes).toEqual([])
})

test('all integration tabs retain usable geometry across themes and widths', async ({ page }) => {
  test.setTimeout(120_000)
  const main = page.getByRole('main')
  for (const theme of ['light', 'dark']) {
    await page.goto(fixtureUrl(`/integrations?state=full&theme=${theme}`))
    for (const width of [390, 901, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      for (const tab of ['Apps', 'Skills', 'MCPs', 'Credentials']) {
        await main
          .getByRole('navigation', { name: 'Integration categories' })
          .getByRole('link', { name: tab, exact: true })
          .click()
        const controls = [
          main.getByRole('searchbox', {
            name: `Search ${tab.toLowerCase()}`,
            exact: true,
          }),
          main.getByRole('button', { name: tab === 'Apps' ? /^App filter:/ : /^Category:/ }),
          main.getByRole('button', { name: 'Sort integrations', exact: true }),
          ...(tab === 'Credentials'
            ? [main.getByRole('button', { name: 'Create credential', exact: true })]
            : []),
        ]
        for (const control of controls) await expect(control).toBeVisible()
        const boxes = await Promise.all(
          controls.map(async (control) => {
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
        await page.screenshot({
          path: test.info().outputPath(`${theme}-${width}-${tab.toLowerCase()}.png`),
        })
      }
    }
  }
})
