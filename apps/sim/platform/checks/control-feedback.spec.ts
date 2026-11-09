import { expect, type Locator, test } from '@playwright/test'
import sharp from 'sharp'
import { fixtureUrl } from '@/platform/checks/routes'

test('either half of a binary mode control switches the composer without breaking keyboard selection', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full'))
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
  await page.goto(fixtureUrl('/home?state=full'))
  await expect(page.getByRole('region', { name: 'Home dashboard' })).toHaveAttribute(
    'data-edges',
    'end'
  )
  await page.getByRole('button', { name: 'Organization menu' }).click()
  const inviteShadow = await page
    .getByRole('button', { name: 'Invite', exact: true })
    .evaluate((button) => getComputedStyle(button).boxShadow)
  await page.keyboard.press('Escape')
  await page.clock.install()
  await page.getByRole('button', { name: 'Customize Home' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Email', exact: true }).click()
  await page.keyboard.press('Escape')
  const tray = page.getByRole('region', { name: 'Notification stack' })
  const undo = tray.getByRole('button', { name: 'Undo' })
  await undo.hover()
  await page.clock.fastForward(5000)
  await expect(undo).toBeVisible()
  await expect(tray.getByRole('article')).toHaveCSS('box-shadow', 'none')
  await page.getByRole('heading', { name: 'Tasks run' }).hover()
  await page.clock.fastForward(5000)
  await expect(undo).toBeHidden()
  const count = tray.getByRole('button', { name: /^Notifications? \d+$/ })
  await count.click()
  await page.setViewportSize({ width: 1140, height: 230 })
  const viewport = tray.locator('[data-scroll-axis="vertical"]')
  await expect(viewport).toHaveAttribute('data-edges', 'end')
  for (const card of await tray.getByRole('article').all()) {
    await expect(card).toHaveCSS('box-shadow', 'none')
  }
  const surface = viewport.locator('..')
  await expect(surface).toHaveCSS('box-shadow', inviteShadow)

  // Sample just below the scrolling edge, where the shadow falls on the page.
  const clip = await viewport.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.ceil(rect.bottom),
      width: 8,
      height: 1,
    }
  })
  const shadow = await page.screenshot({ clip })
  await count.click()
  expect(await page.screenshot({ clip })).not.toEqual(shadow)
  await count.click()
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

/** Sample the rendered fill inside the corner, clear of the label and rounded edge. */
async function fillLightness(button: Locator) {
  const rgb = await sharp(await button.screenshot({ scale: 'css' }))
    .extract({ left: 8, top: 8, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer()
  return button.evaluate((_, channels) => {
    const brush = document.createElement('canvas').getContext('2d')
    if (!brush) throw new Error('Cannot measure the rendered button')
    brush.fillStyle = `oklab(from rgb(${channels}) l 0 0)`
    return Number.parseFloat(brush.fillStyle.slice('oklab('.length)) * 100
  }, rgb.join(' '))
}

async function pressAndMeasure(button: Locator) {
  await button.page().mouse.move(0, 0)
  const rest = await fillLightness(button)
  await button.hover()
  const hover = await fillLightness(button)
  await button.page().mouse.down()
  const pressed = await fillLightness(button)
  await button.page().mouse.up()
  return [rest - hover, rest - pressed]
}

for (const theme of ['light', 'dark']) {
  test.describe(`${theme} action feedback`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(fixtureUrl(`/chat/weekly-review?theme=${theme}&state=full`))
    })

    test('archiving and saving have the same perceptual hover and press steps', async ({
      page,
    }) => {
      const chat = page.getByRole('link', { name: 'Review the renewal brief', exact: true })
      const options = page.getByRole('button', { name: 'Actions for Review the renewal brief' })
      await chat.hover()
      await options.click()
      const rename = page.getByRole('menuitem', { name: 'Rename' })
      await rename.click()
      const primary = await pressAndMeasure(page.getByRole('button', { name: 'Save', exact: true }))

      await chat.hover()
      await options.click()
      const archive = page.getByRole('menuitem', { name: 'Archive' })
      await rename.hover()
      expect((await paint(archive)).ink.red).toBe(false)
      await archive.hover()
      const hovered = await paint(archive)
      expect(hovered.ink.red).toBe(true)
      expect(hovered.background.red).toBe(true)
      expect(hovered.background.alpha / 255).toBeCloseTo(0.06, 2)
      await rename.hover()
      await rename.press('End')
      expect(await paint(archive)).toEqual(hovered)
      await archive.press('Enter')

      const dialog = page.getByRole('dialog', { name: 'Archive chat' })
      const confirm = dialog.getByRole('button', { name: 'Archive', exact: true })
      const fill = (await paint(confirm)).background
      expect(fill.red).toBe(true)
      expect(fill.alpha).toBe(255)
      const danger = await pressAndMeasure(confirm)
      await expect(dialog).toBeHidden()
      await test.info().attach('Perceptual change from rest', {
        body: JSON.stringify({ states: ['hover', 'pressed'], save: primary, archive: danger }),
        contentType: 'application/json',
      })
      expect(danger[0]).toBeGreaterThan(1)
      expect(danger[1]).toBeGreaterThan(danger[0])
      for (const [state, delta] of danger.entries()) {
        expect(
          Math.abs(delta - primary[state]),
          `Archive ${delta}, Save ${primary[state]}`
        ).toBeLessThan(1)
      }
    })

    test('credential destruction matches Archive hover and keeps confirmation separate', async ({
      page,
    }) => {
      const paint = (control: Locator) =>
        control.evaluate((element) => {
          const style = getComputedStyle(element)
          return { ink: style.color, fill: style.backgroundColor }
        })
      const chat = page.getByRole('link', { name: 'Review the renewal brief', exact: true })
      await chat.hover()
      await page.getByRole('button', { name: 'Actions for Review the renewal brief' }).click()
      const archive = page.getByRole('menuitem', { name: 'Archive', exact: true })
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).hover()
      const resting = await paint(archive)
      await archive.hover()
      const hovered = await paint(archive)
      await archive.click()
      await page
        .getByRole('dialog', { name: 'Archive chat' })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()

      await page.goto(fixtureUrl(`/integrations/gmail?state=full&theme=${theme}`))
      const main = page.getByRole('main')
      await main.getByRole('button', { name: /^Customer operations service account / }).click()
      const disconnect = main.getByRole('button', { name: 'Disconnect', exact: true })
      await page.mouse.move(0, 0)
      expect(await paint(disconnect)).toEqual(resting)
      await disconnect.focus()
      expect(await paint(disconnect)).toEqual(resting)
      await disconnect.hover()
      expect(await paint(disconnect)).toEqual(hovered)
      await page.mouse.down()
      const pressed = await paint(disconnect)
      expect(pressed.ink).toBe(hovered.ink)
      expect(pressed.fill).not.toBe(hovered.fill)
      await page.mouse.up()
      const dialog = page.getByRole('dialog', { name: /^Disconnect Customer operations/ })
      await expect(dialog).toBeVisible()
      const confirmation = dialog.getByRole('button', { name: 'Disconnect', exact: true })
      expect((await paint(confirmation)).fill).not.toBe(resting.fill)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(disconnect).toBeVisible()
      await page.mouse.move(0, 0)
      await disconnect.focus()
      expect(await paint(disconnect)).toEqual(resting)
      await page.keyboard.down('Space')
      expect(await paint(disconnect)).toEqual(pressed)
      await page.keyboard.up('Space')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(disconnect).toBeVisible()
      await test.info().attach('Shared destructive feedback', {
        body: JSON.stringify({ resting, hovered, pressed }),
        contentType: 'application/json',
      })
    })

    test('dismissing a recent uses the same neutral action as closing a tab', async ({ page }) => {
      await page.getByRole('button', { name: 'Open chat panel' }).click()
      const panel = page.getByRole('complementary', { name: 'Chat panel' })
      const close = panel.getByRole('button', { name: 'Close Workspaces tab' })
      await close.hover()
      const neutral = await paint(close)
      expect(neutral.ink.red).toBe(false)
      const list = panel.getByRole('list', { name: 'Recents' })
      const labels = list.getByRole('listitem')
      const before = await labels.allTextContents()
      const remove = list.getByRole('button', { name: 'Remove Renewal brief from recents' })
      await remove.hover()
      expect(await paint(remove)).toEqual(neutral)
      await remove.click()
      await expect(labels).toHaveText(before.filter((label) => label !== 'Renewal brief'))
      await expect(panel.getByRole('tab', { selected: true })).toHaveAccessibleName('Workspaces')
    })
  })
}

test('long feedback scrolls inside the field and dragging its corner leaves the dialog geometry fixed', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/chat/weekly-review?state=full'))
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

test('the composer keeps its reading size through reflow and respects a larger root text size', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?theme=light&state=full'))
  const editor = page.getByRole('textbox', { name: /Ask about your business/ })
  const desktop = await editor.evaluate((el) => getComputedStyle(el).fontSize)
  await editor.fill('Continue the conversation')
  for (const width of [768, 640, 390]) {
    await page.setViewportSize({ width, height: 780 })
    await expect(editor).toBeFocused()
    await expect(editor).toHaveCSS('font-size', desktop)
    await expect(editor).toHaveValue('Continue the conversation')
  }
  await page.addStyleTag({ content: 'html { font-size: 125%; }' })
  await expect(editor).toHaveCSS('font-size', `${Number.parseFloat(desktop) * 1.25}px`)
})
