import { expect, type Locator, test } from '@playwright/test'
import evidence from '@sim/emcn-platform/catalog/evidence.json'
import { load } from 'cheerio'
import { fixturesOffOrigin, fixtureUrl } from '@/platform/checks/routes'

const enabled = fixtureUrl('/workbench')
const catalog = process.env.PLATFORM_E2E_ORIGIN
  ? enabled
  : fixtureUrl('/workbench', fixturesOffOrigin)

test('the workbench changes its example data with the selected fixture state', async ({ page }) => {
  await page.goto(`${enabled}?state=full`)
  const data = page.getByRole('region', { name: 'Preview data' })
  await expect(data.getByText('Weekly review', { exact: true })).toBeVisible()
  await page.goto(`${enabled}?state=empty`)
  await expect(data).toBeVisible()
  await expect(data.getByText('Weekly review', { exact: true })).toHaveCount(0)
})

test('the loaded typeface and themed canvas match the Paper control recipe', async ({ page }) => {
  for (const [theme, surface] of [
    ['light', 'rgb(255, 255, 255)'],
    ['dark', 'rgb(20, 20, 20)'],
  ]) {
    await page.goto(`${enabled}?theme=${theme}`)
    await expect(page.locator('[data-platform-ui]')).toHaveCSS('background-color', surface)
    const button = page.getByRole('button', { name: 'Create workspace', exact: true })
    await expect(button).toHaveCSS('font-size', '13px')
    await expect(button).toHaveCSS('line-height', '18px')
    const faces = await button.evaluate(async (element) => {
      await document.fonts.ready
      const style = getComputedStyle(element)
      return (
        await document.fonts.load(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
      ).map((face) => [face.status, face.family])
    })
    expect(
      faces.some(
        ([status, family]) => status === 'loaded' && family.toLowerCase().includes('geist')
      )
    ).toBe(true)
  }
})

test('keyboard users can advance, dismiss and reopen the workspace dialog from its first step', async ({
  page,
}) => {
  await page.goto(enabled)
  const trigger = page.getByRole('button', { name: 'Create workspace', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('backdrop-filter', 'blur(20px)')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  const next = dialog.getByRole('button', { name: 'Continue' })
  await next.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/^Step 2 of/)).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Default role', exact: true }).click()
  await dialog.getByRole('option', { name: 'Viewer', exact: true }).click()
  await dialog.getByRole('button', { name: 'Back' }).click()
  await next.click()
  await expect(dialog.getByRole('combobox', { name: 'Default role', exact: true })).toContainText(
    'Viewer'
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(/^Step 1 of/)).toBeVisible()
  await next.click()
  await expect(dialog.getByRole('combobox', { name: 'Default role', exact: true })).toContainText(
    'Member'
  )
})

for (const width of [390, 647, 901, 1440]) {
  test(`a long workspace chat list stays within its viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`${enabled}?state=stress&theme=dark`)
    const region = page.getByRole('region', { name: 'Workspace chats' })
    await expect(region).toBeVisible()
    await expect(region).toHaveCSS('mask-image', /calc\(100% - 16px\)/)
    const scrolled = await region.evaluate((el) => {
      el.scrollTop = el.scrollHeight
      return el.scrollTop
    })
    expect(scrolled).toBeGreaterThan(0)
    await expect(region).toHaveCSS('mask-image', /(?<!- )16px/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    )
  })
}

test('preview controls follow the user’s preferred type size without widening the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 647, height: 844 })
  await page.goto(`${enabled}?state=stress`)
  await page.addStyleTag({ content: 'html { font-size: 125%; }' })
  const trigger = page.getByRole('button', { name: 'Create workspace', exact: true })
  await expect(trigger).toHaveCSS('font-size', '16.25px')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(647)
})

test('Paper search, disclosure and segmented controls work with the keyboard', async ({ page }) => {
  await page.goto(`${enabled}?theme=light&state=full&recipe=C1084`)
  const search = page.getByRole('searchbox')
  await search.fill('workspace')
  const clear = page.getByRole('button', { name: 'Clear search' })
  await clear.focus()
  await page.keyboard.press('Enter')
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()

  await page.goto(`${enabled}?theme=light&state=full&recipe=C0423`)
  const summary = page.locator('summary')
  await summary.focus()
  await page.keyboard.press('Space')
  await expect(page.locator('details[open]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('details[open]')).toHaveCount(0)

  await page.goto(`${enabled}?theme=light&state=full&recipe=C0970`)
  const options = page.getByRole('radio')
  await expect(options).toHaveCount(2)
  await options.nth(0).check()
  await options.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(options.nth(1)).toBeChecked()
  await expect(options.nth(0)).not.toBeChecked()
})

test('chart menu choices use one tab stop and report selection after arrow-key navigation', async ({
  page,
}) => {
  await page.goto(`${enabled}?theme=light&state=full&recipe=C0635`)
  const choices = page.getByRole('menuitemradio')
  await expect(choices).toHaveCount(3)
  await choices.first().focus()
  await page.keyboard.press('End')
  await expect(choices.last()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(choices.last()).toBeChecked()
  await expect(choices.first()).not.toBeChecked()
  expect(
    await choices.evaluateAll(
      (items) => items.filter((item) => (item as HTMLElement).tabIndex === 0).length
    )
  ).toBe(1)
})

test('workspace destinations stay reachable and read-only table records scale with the fixture', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${enabled}?recipe=C1310&state=full`)
  const destinations = page.getByRole('navigation', { name: 'Workspace sections' })
  const forward = destinations.getByRole('button', { name: 'Scroll Workspace sections forward' })
  await expect(forward).toBeVisible()
  const region = destinations.getByRole('region')
  await forward.click()
  await expect.poll(() => region.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
  const settings = destinations.getByRole('link', { name: 'Settings' })
  await settings.click()
  await expect(settings).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/destination=8/)
  await page.goto(`${enabled}?recipe=C1330&state=stress`)
  const table = page.getByRole('table', { name: 'Agent performance' })
  await expect(table.getByRole('row')).toHaveCount(26)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('property lists follow the record count and keep contributor and issue values usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const properties = page.getByRole('region', { name: 'Properties' })
  for (const [scenario, count] of [
    ['empty', 0],
    ['full', 3],
    ['stress', 5],
  ] as const) {
    await page.goto(`${enabled}?recipe=C1362&state=${scenario}`)
    await expect(properties).toBeVisible()
    await expect(properties.getByRole('term')).toHaveCount(count)
    await expect(properties.getByRole('definition')).toHaveCount(count)
  }
  await expect(properties.getByRole('img', { name: 'Jo Bell' })).toBeVisible()
  const issue = properties.getByRole('link', { name: 'OPS-1042' })
  await issue.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/recipe=C1336/)
})

test('catalog collections render fixture records independently of Paper specimen counts', async ({
  page,
}) => {
  for (const [state, count] of [
    ['empty', 0],
    ['full', 2],
    ['stress', 27],
  ] as const) {
    for (const [key, label] of [
      ['C1284', 'Workspaces'],
      ['C0212', 'Attachments'],
    ] as const) {
      await page.goto(`${enabled}?recipe=${key}&state=${state}`)
      const list = page.getByRole('list', { name: label, exact: true })
      await expect(list).toHaveCount(1)
      await expect(list.getByRole('listitem')).toHaveCount(count)
      if (label === 'Workspaces' && state === 'full') {
        await expect(list.getByRole('listitem')).toHaveText(['Operations', 'Product'])
      }
    }
  }
})

test('browser actions keep their accessible names and visibility choices toggle independently', async ({
  page,
}) => {
  await page.goto(`${enabled}?recipe=C0633&state=full`)
  const browser = page.getByRole('menu', { name: 'Browser actions' })
  const copy = browser.getByRole('menuitem', { name: 'Copy link' })
  await copy.focus()
  await page.keyboard.press('End')
  await expect(browser.getByRole('menuitem', { name: 'Downloads' })).toBeFocused()
  await page.goto(`${enabled}?recipe=C0647&state=empty`)
  const email = page.getByRole('menuitemcheckbox', { name: 'Email' })
  const calendar = page.getByRole('menuitemcheckbox', { name: 'Calendar' })
  await expect(calendar).toBeChecked()
  await email.focus()
  await page.keyboard.press('Space')
  await expect(email).not.toBeChecked()
  await expect(calendar).toBeChecked()
})

test('chart labels and totals follow the supplied series', async ({ page }) => {
  await page.goto(`${enabled}?recipe=C1324&state=empty`)
  await expect(
    page.getByRole('list', { name: 'Distribution legend' }).getByRole('listitem')
  ).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Runs by workflow' }).getByText('—')).toBeVisible()
  await page.goto(`${enabled}?recipe=C1324&state=full`)
  const chart = page.getByRole('region', { name: 'Runs by workflow' })
  await expect(chart.getByText('84,739')).toBeVisible()
  await expect(chart.getByRole('button', { name: 'Agents: All agents' })).toBeVisible()
  await page.setViewportSize({ width: 410, height: 800 })
  const ring = await chart.getByRole('img').boundingBox()
  const list = await chart.getByRole('list', { name: 'Distribution legend' }).boundingBox()
  if (!ring || !list) throw new Error('The donut and its legend must be visible')
  expect(list.y).toBeGreaterThanOrEqual(ring.y + ring.height)
  await page.goto(`${enabled}?recipe=C1324&state=stress`)
  const legend = page.getByRole('list', { name: 'Distribution legend' })
  await expect(legend.getByRole('listitem')).toHaveCount(6)
  await legend.getByRole('button').last().focus()
  await expect(page.getByRole('tooltip')).toContainText('Escalate')
  await page.goto(`${enabled}?recipe=C1322&state=stress`)
  await expect(page.getByRole('list', { name: 'Chart periods' }).getByRole('listitem')).toHaveCount(
    12
  )
})

test('a picker can extend beyond the modal and keeps the pointer and Escape on the right layer', async ({
  page,
}) => {
  const popupRecipe = (option: Locator) =>
    option.evaluate((row) => {
      const surface = row.closest('[data-material="floating"]')
      if (!surface) throw new Error('Missing floating menu surface')
      const panel = getComputedStyle(surface)
      const item = getComputedStyle(row)
      return [
        panel.backgroundColor,
        panel.backdropFilter,
        panel.boxShadow,
        panel.border,
        panel.borderRadius,
        panel.padding,
        item.borderRadius,
        item.paddingInline,
        row.getBoundingClientRect().height,
      ]
    })
  await page.setViewportSize({ width: 320, height: 500 })
  await page.goto(`${enabled}?theme=dark`)
  await page.getByRole('combobox', { name: 'Access', exact: true }).click()
  const mainRecipe = await popupRecipe(page.getByRole('option', { name: 'Private', exact: true }))
  await page.keyboard.press('Escape')
  const open = page.getByRole('button', { name: 'Create workspace', exact: true })
  await open.click()
  const modal = page.getByRole('dialog', { name: 'Create workspace' })
  await modal.getByRole('button', { name: 'Continue' }).click()
  const group = modal.getByRole('combobox', { name: 'Default role', exact: true })
  await group.click()
  const option = modal.getByRole('option', { name: 'Viewer', exact: true })
  await expect(option).toBeInViewport({ ratio: 1 })
  expect(await popupRecipe(option)).toEqual(mainRecipe)
  const search = modal.getByRole('combobox', { name: 'Find a role' })
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('outline-style', 'none')
  const bounds = await option.boundingBox()
  if (!bounds) throw new Error('The menu option disappeared before pointer selection')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  const selected = modal.getByRole('combobox', { name: 'Default role', exact: true })
  await expect(selected).toContainText('Viewer')
  await selected.click()
  await expect(modal.getByRole('combobox', { name: 'Find a role' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(selected).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(open).toBeFocused()
})

test('Home tasks run draws the selected dataset and exposes its last point to keyboard users', async ({
  page,
}) => {
  const chart = page.getByRole('region', { name: 'Tasks run' })
  const plot = chart.getByRole('img', { name: 'Tasks run' })
  await page.goto(`${enabled}?recipe=C0162&state=empty`)
  await expect(plot).toBeVisible()
  await expect(plot.locator('path')).toHaveCount(0)
  await page.goto(`${enabled}?recipe=C0162&state=full`)
  const fullPath = await plot.locator('path').last().getAttribute('d')
  expect(fullPath).toBeTruthy()
  await page.goto(`${enabled}?recipe=C0162&state=stress`)
  const range = chart.getByRole('button', { name: /Range:/ })
  await range.click()
  await page.getByRole('menuitemradio', { name: 'Last 30 days' }).click()
  await expect(plot.locator('path').last()).not.toHaveAttribute('d', fullPath ?? '')
  const explorer = chart.getByRole('group', { name: 'Tasks run data' })
  await expect(range).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(explorer).toBeFocused()
  await page.keyboard.press('End')
  await expect(chart.getByRole('tooltip')).toContainText('Jan 9')
  await expect(chart.getByRole('tooltip')).toContainText('17')
})

test('dashboard tables format numeric data, distinguish missing cells and retain the readable columns as space narrows', async ({
  page,
}) => {
  await page.goto(`${enabled}?recipe=C1330&state=full`)
  const table = page.getByRole('table', { name: 'Agent performance' })
  const intake = table.getByRole('row').filter({ hasText: 'Intake assistant' })
  await expect(intake.getByRole('cell')).toHaveText([
    'Intake assistant',
    '8 running',
    '1,090',
    '98.4%',
    '4.2 min',
    '$21.18',
  ])
  await expect(intake.getByRole('cell', { name: '8 running' })).toHaveCSS('text-align', 'start')
  await expect(intake.getByRole('cell', { name: '1,090' })).toHaveCSS('text-align', 'end')

  await page.goto(`${enabled}?recipe=C1331&theme=dark&state=stress`)
  const incomplete = table.getByRole('row').nth(1)
  await expect(incomplete.getByRole('cell').nth(2)).toHaveText('0')
  await expect(incomplete.getByRole('cell').last()).toHaveText('—')
  for (const [width, labels] of [
    [647, ['Agent', 'Live status', 'Requests', 'Avg time']],
    [390, ['Agent', 'Requests', 'Avg time']],
  ] as const) {
    await page.setViewportSize({ width, height: 844 })
    await expect(table.getByRole('columnheader')).toHaveText([...labels])
    await expect(incomplete.getByRole('cell', { name: '0', exact: true })).toHaveCSS(
      'text-align',
      'end'
    )
    expect(await table.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('series tooltips stay beside the inspected mark at both edges of the plot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1050, height: 840 })
  for (const [key, title, bands] of [
    ['C1320', 'Workflow runs', false],
    ['C1322', 'Runs by day', true],
  ] as const) {
    await page.goto(`${enabled}?recipe=${key}&state=full`)
    const chart = page.getByRole('region', { name: title })
    const plot = chart.getByRole('group', { name: `${title} data` })
    await plot.scrollIntoViewIfNeeded()
    const bounds = await plot.boundingBox()
    if (!bounds) throw new Error('Plot is missing')
    for (const [end, pointer] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      if (pointer) {
        await plot.hover({ position: { x: end ? bounds.width - 1 : 1, y: bounds.height / 2 } })
      } else {
        await plot.focus()
        await page.keyboard.press(end ? 'End' : 'Home')
      }
      const tooltip = chart.getByRole('tooltip')
      await expect(tooltip).toBeVisible()
      const mark = bands
        ? await plot
            .locator('svg')
            .nth(end ? -1 : 0)
            .boundingBox()
        : await plot.locator('circle').evaluate((el) => el.getBoundingClientRect().toJSON())
      if (!mark) throw new Error('Active mark is missing')
      const center = mark.x + mark.width / 2
      await expect
        .poll(async () => {
          const tip = await tooltip.boundingBox()
          if (!tip || tip.x < bounds.x - 1 || tip.x + tip.width > bounds.x + bounds.width + 1)
            return -1
          return Math.round(end ? center - (tip.x + tip.width) : tip.x - center)
        })
        .toBe(12)
      if (!bands) {
        const dot = plot.locator('circle')
        await expect(dot).toHaveCSS('stroke', 'none')
        await expect(dot).toHaveCSS('fill', /^rgb\(/)
        expect(mark.width).toBeCloseTo(mark.height, 1)
      }
    }
  }
})

test('choices support keyboard typeahead and disable an empty collection', async ({ page }) => {
  await page.goto(`${enabled}?theme=dark`)
  const access = page.getByRole('combobox', { name: 'Access', exact: true })
  await access.focus()
  await access.press('ArrowDown')
  const options = page.getByRole('listbox')
  await expect(options.getByRole('option', { name: 'Private' })).toBeFocused()
  await page.keyboard.press('o')
  await expect(options.getByRole('option', { name: 'Organization' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(access).toContainText('Organization')
  await expect(access).toBeFocused()
  await page.goto(`${enabled}?recipe=C0347&state=empty`)
  const empty = page.getByRole('combobox', { name: 'ChipSelect', exact: true })
  await expect(empty).toBeDisabled()
  await expect(empty).toHaveText('')
})

test('the Paper catalog searches its full list and submits and resets the selected key', async ({
  page,
}) => {
  await page.goto(`${catalog}?recipe=C1332`)
  const picker = page.getByRole('combobox', { name: 'Paper master', exact: true })
  await picker.click()
  const search = page.getByRole('combobox', { name: 'Search masters' })
  const list = page.getByRole('listbox', { name: 'Paper master' })
  await expect(list.getByRole('option')).toHaveCount(
    evidence.filter((row) => row.theme === 'L').length
  )
  await expect(list).toBeInViewport({ ratio: 1 })
  await search.fill('C0162')
  await search.press('ArrowDown')
  await search.press('Enter')
  const form = page.locator('form').filter({ has: picker })
  await expect
    .poll(() => form.evaluate((el) => new FormData(el as HTMLFormElement).get('recipe')))
    .toBe('C0162')
  await form.evaluate((el) => (el as HTMLFormElement).reset())
  await expect(picker).toContainText('C1332')
  await expect
    .poll(() => form.evaluate((el) => new FormData(el as HTMLFormElement).get('recipe')))
    .toBe('C1332')
  await picker.click()
  await search.fill('OverflowText')
  await page.getByRole('option', { name: /C0807/ }).click()
  await page.getByRole('button', { name: 'View master' }).click()
  await expect(page).toHaveURL(/recipe=C0807/)
  await expect(picker).toContainText('C0807')
})

test('every registered master resolves through its production workbench URL', async ({
  request,
}) => {
  test.setTimeout(180_000)
  const concurrency = 6
  for (let offset = 0; offset < evidence.length; offset += concurrency) {
    await Promise.all(
      evidence.slice(offset, offset + concurrency).map(async ({ key, theme }) => {
        const query = new URLSearchParams({
          recipe: key,
          theme: theme === 'L' ? 'light' : 'dark',
          state: 'full',
        })
        const response = await request.get(`${enabled}?${query}`, {
          // The shared dev server can recycle its worker during the catalog sweep.
          maxRetries: process.env.PLATFORM_E2E_ORIGIN ? 2 : 0,
        })
        try {
          expect(response.status(), key).toBe(200)
          const page = load(await response.text())
          expect(page('input[name="recipe"]').val(), key).toBe(key)
        } finally {
          await response.dispose()
        }
      })
    )
  }
})

test('Help keyboard navigation enters Downloads, returns to its parent, and restores focus after choosing the child action', async ({
  page,
}) => {
  await page.goto(`${enabled}?recipe=C0651`)
  const trigger = page.getByRole('button', { name: 'Help', exact: true })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const root = page.getByRole('menu', { name: 'Help', exact: true })
  const downloads = root.getByRole('menuitem', { name: 'Download apps' })
  await expect(downloads).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const child = page.getByRole('menu', { name: 'Download apps', exact: true })
  const mac = child.getByRole('menuitem', { name: 'Sim for macOS' })
  await expect(mac).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(child).toBeHidden()
  await expect(downloads).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(mac).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(child).toBeHidden()
  await expect(downloads).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(mac).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(root).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('Help submenu flips at either edge and remains open while the pointer travels diagonally into it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 440 })
  await page.goto(`${enabled}?recipe=C0651`)
  const trigger = page.getByRole('button', { name: 'Help', exact: true })
  for (const edge of ['left', 'right'] as const) {
    await trigger.evaluate((element, corner) => {
      element.style.position = 'fixed'
      element.style.inset = 'auto'
      element.style[corner] = '8px'
      element.style.bottom = '8px'
    }, edge)
    await trigger.click()
    const root = page.getByRole('menu', { name: 'Help', exact: true })
    const downloads = root.getByRole('menuitem', { name: 'Download apps' })
    await downloads.hover()
    const highlighted = await downloads.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    )
    const child = page.getByRole('menu', { name: 'Download apps' })
    await expect(child).toBeVisible()
    const mac = child.getByRole('menuitem', { name: 'Sim for macOS' })
    await expect
      .poll(async () => {
        const [box, head, button] = await Promise.all([
          child.locator('..').boundingBox(),
          root.locator('..').boundingBox(),
          trigger.boundingBox(),
        ])
        if (!box || !head || !button) return false
        const gap = edge === 'left' ? box.x - head.x - head.width : head.x - box.x - box.width
        return (
          box.x >= 0 &&
          box.x + box.width <= 760 &&
          box.y >= 0 &&
          box.y + box.height <= 440 &&
          head.y + head.height <= button.y &&
          Math.abs(gap - 4) < 1
        )
      })
      .toBe(true)
    const [row, item] = await Promise.all([downloads.boundingBox(), mac.boundingBox()])
    if (!row || !item) throw new Error('Missing submenu geometry')
    await page.mouse.move(
      edge === 'left' ? row.x + row.width - 2 : row.x + 2,
      row.y + row.height - 3
    )
    await page.mouse.move(
      edge === 'left' ? item.x + 2 : item.x + item.width - 2,
      item.y + item.height - 3,
      { steps: 16 }
    )
    await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 10 })
    await expect(mac).toBeVisible()
    await expect(downloads).toHaveCSS('background-color', highlighted)
    await mac.click()
    await expect(root).toBeHidden()
  }
})

test('a long range menu scrolls inside its themed surface and selecting its final choice restores focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 360 })
  await page.goto(`${enabled}?recipe=C1331&theme=dark&state=stress`)
  const trigger = page.getByRole('button', { name: 'Agents: All agents' })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Agents' })
  const choices = menu.getByRole('menuitemradio')
  await expect(choices).toHaveCount(26)
  expect(
    await menu.evaluate((el) => el.closest('[data-platform-ui]')?.getAttribute('data-theme'))
  ).toBe('dark')
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await page.keyboard.press('End')
  await expect(choices.last()).toBeFocused()
  expect(await menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const label = await choices.last().innerText()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  const updated = page.getByRole('button', { name: `Agents: ${label}` })
  await expect(updated).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
