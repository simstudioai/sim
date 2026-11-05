import { expect, type Locator, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('either half of a binary mode control switches the composer without breaking keyboard selection', async ({
  page,
}) => {
  await page.goto(`${origin}/home?state=full`)
  const build = page.getByRole('radio', { name: 'Build' })
  const search = page.getByRole('radio', { name: 'Search', exact: true })
  await expect(build).toBeChecked()
  await build.click()
  await expect(search).toBeChecked()
  await expect(page.getByRole('textbox', { name: /Search your company/ })).toBeVisible()
  await search.click()
  await expect(build).toBeChecked()
  await build.press('ArrowRight')
  await expect(search).toBeChecked()
})

test('a notice stays actionable while hovered and can be reopened after its feedback period', async ({
  page,
}) => {
  await page.clock.install()
  await page.goto(`${origin}/home?state=full`)
  await page.getByRole('button', { name: 'Customize Home' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email', exact: true }).click()
  await page.keyboard.press('Escape')
  const tray = page.getByRole('region', { name: 'Notification stack' })
  const undo = tray.getByRole('button', { name: 'Undo' })
  await undo.hover()
  await page.clock.fastForward(5000)
  await expect(undo).toBeVisible()
  await page.getByRole('heading', { name: 'Tasks run' }).hover()
  await page.clock.fastForward(5000)
  await expect(undo).toBeHidden()
  await tray.getByRole('button', { name: /notifications?$/ }).click()
  await undo.click()
  await expect(page.getByRole('region', { name: 'Email', exact: true })).toBeVisible()
})

function paint(control: Locator) {
  return control.evaluate((element) => {
    const canvas = document.createElement('canvas').getContext('2d')
    if (!canvas) throw new Error('Cannot measure control paint')
    const color = (value: string) => {
      canvas.clearRect(0, 0, 1, 1)
      canvas.fillStyle = value
      canvas.fillRect(0, 0, 1, 1)
      const [r, g, b, alpha] = canvas.getImageData(0, 0, 1, 1).data
      return { rgb: [r, g, b], alpha, red: alpha > 0 && r > Math.max(g, b) + 24 }
    }
    const css = getComputedStyle(element)
    const glyph = element.querySelector('svg path')
    return {
      background: color(css.backgroundColor),
      ink: color(glyph ? getComputedStyle(glyph).stroke : css.color),
    }
  })
}

for (const theme of ['light', 'dark']) {
  test(`destructive actions have quiet menu feedback and a filled confirmation in ${theme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${origin}/home?theme=${theme}&state=full`)
    await page.getByRole('button', { name: 'Email options' }).click()
    const hide = page.getByRole('menuitem', { name: 'Hide Email' })
    const disconnect = page.getByRole('menuitem', { name: 'Disconnect Email' })
    await hide.hover()
    expect((await paint(disconnect)).ink.red).toBe(false)
    await disconnect.hover()
    const hovered = await paint(disconnect)
    expect(hovered.ink.red).toBe(true)
    expect(hovered.background.red).toBe(true)
    expect(hovered.background.alpha / 255).toBeCloseTo(0.06, 2)
    await hide.hover()
    await hide.press('ArrowDown')
    expect(await paint(disconnect)).toEqual(hovered)
    await disconnect.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Disconnect Email?' })
    const confirm = dialog.getByRole('button', { name: 'Disconnect', exact: true })
    const rest = (await paint(confirm)).background
    expect(rest.red).toBe(true)
    expect(rest.alpha).toBe(255)
    await confirm.hover()
    const hover = (await paint(confirm)).background
    expect(hover.red).toBe(true)
    expect(hover.rgb).not.toEqual(rest.rgb)
    await page.mouse.down()
    const pressed = (await paint(confirm)).background
    expect(pressed.red).toBe(true)
    expect(pressed.rgb).not.toEqual(hover.rgb)
    await page.mouse.up()
    await expect(dialog).toBeHidden()

    await page.goto(`${origin}/chat/weekly-review?theme=${theme}&state=stress`)
    const remove = page.getByRole('button', {
      name: 'Remove dashboard.png',
      exact: true,
    })
    await page.mouse.move(0, 0)
    expect((await paint(remove)).ink.red).toBe(false)
    await remove.hover()
    const removal = await paint(remove)
    expect(removal.ink.red).toBe(true)
    expect(removal.background).toEqual(hovered.background)
  })
}

test('long feedback scrolls inside the field and dragging its corner leaves the dialog geometry fixed', async ({
  page,
}) => {
  await page.goto(`${origin}/chat/weekly-review?state=full`)
  await page.getByRole('button', { name: 'Rate response' }).first().click()
  await page.getByRole('menuitem', { name: 'Bad response' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share feedback' })
  const details = dialog.getByRole('textbox', { name: 'Details' })
  await details.fill('Feedback about this response.\n'.repeat(60))
  expect(await details.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true
  )
  const before = await details.boundingBox()
  if (!before) throw new Error('Feedback details must be visible')
  await page.mouse.move(before.x + before.width - 3, before.y + before.height - 3)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width - 3, before.y + before.height + 60, { steps: 5 })
  await page.mouse.up()
  expect(await details.boundingBox()).toEqual(before)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
