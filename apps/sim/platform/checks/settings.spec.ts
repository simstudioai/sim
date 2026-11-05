import { expect, type Locator, test } from '@playwright/test'

const base = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('preferences apply to the interface and survive settings navigation in this session', async ({
  page,
}) => {
  await page.goto(`${base}/settings?theme=unrecognized&state=full`)
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true })
  await expect(theme).toHaveText('System')
  await theme.click()
  await page.getByRole('option', { name: 'Dark', exact: true }).click()
  await expect(page.locator('[data-platform-ui]')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('combobox', { name: 'Interface font' }).click()
  await page.getByRole('option', { name: 'System', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Preferences' })).toHaveCSS(
    'font-family',
    /system-ui/
  )
  await page.getByRole('switch', { name: 'In-app notifications' }).click()
  await page.getByRole('switch', { name: 'Play sound' }).focus()
  await page.keyboard.press('Space')
  await page
    .getByRole('navigation', { name: 'Settings', exact: true })
    .getByRole('link', { name: 'Notifications' })
    .click()
  await expect(page).toHaveURL(/\/settings\/notifications\?.*state=full/)
  await expect(page.getByRole('switch', { name: 'In-app notifications' })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: 'Play sound' })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toHaveCSS(
    'font-family',
    /system-ui/
  )
})

test('the small Settings drawer filters destinations, restores navigation and closes on selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 356, height: 740 })
  await page.goto(`${base}/settings?state=full`)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation drawer' })
  const field = drawer.getByRole('searchbox', { name: 'Search settings' })
  await field.fill('nonexistent')
  await expect(drawer.getByText('No matching settings')).toBeVisible()
  await expect(drawer.getByRole('link', { name: 'Preferences' })).toHaveCount(0)
  await drawer.getByRole('button', { name: 'Clear search' }).click()
  await expect(field).toBeFocused()
  await field.fill('notifications')
  await drawer.getByRole('link', { name: 'Notifications' }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Play sound' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(356)
})

test('cancelled profile edits reset and saved name and picture survive Settings navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 356, height: 740 })
  await page.goto(`${base}/settings?state=full`)
  await page.getByRole('button', { name: 'Emir Karabeg', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit display name' })
  await dialog.getByRole('textbox', { name: 'Display name' }).fill('Unsaved draft')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Emir Karabeg', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Display name' })).toHaveValue('Emir Karabeg')
  const replacement = 'International operations and customer onboarding specialist'
  await dialog.getByRole('textbox', { name: 'Display name' }).fill(replacement)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  const button = page.getByRole('button', { name: replacement })
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('img', { name: replacement })).toBeVisible()
  await page.getByLabel('Set your profile picture').setInputFiles({
    name: 'photo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="17" height="13"/>'),
  })
  const picture = page.getByRole('region', { name: 'Profile' }).locator('img')
  await expect(picture).toHaveJSProperty('naturalWidth', 17)
  const open = page.getByRole('button', { name: 'Expand sidebar' })
  const drawer = page.getByRole('dialog', { name: 'Navigation drawer' })
  await open.click()
  await drawer.getByRole('link', { name: 'Notifications' }).click()
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
  await open.click()
  await drawer.getByRole('link', { name: 'Preferences' }).click()
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(picture).toHaveJSProperty('naturalWidth', 17)
  await open.click()
  await drawer.getByRole('button', { name: 'Back to app' }).click()
  await expect(page.getByRole('heading', { name: 'Good morning, International' })).toBeVisible()
  await open.click()
  await expect(drawer.getByRole('img', { name: replacement })).toHaveJSProperty('naturalWidth', 17)
  await drawer.getByRole('button', { name: replacement }).click()
  await expect(button).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Emir Karabeg', exact: true })).toBeVisible()
  await expect(picture).toHaveCount(0)
})

test('form titles start at their content edge and Cancel is consistent across routes', async ({
  page,
}) => {
  function cancelPaint(dialog: Locator) {
    return dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate((button) => {
      const css = getComputedStyle(button)
      return [css.borderWidth, css.backgroundColor, css.borderRadius, css.paddingInline]
    })
  }
  async function expectTitleAtStart(dialog: Locator) {
    const offset = await dialog.getByRole('heading').evaluate((heading) => {
      const ink = new Range()
      ink.selectNodeContents(heading)
      return ink.getBoundingClientRect().left - heading.getBoundingClientRect().left
    })
    expect(Math.abs(offset)).toBeLessThan(1)
  }
  await page.goto(`${base}/home?state=full`)
  await page.getByRole('button', { name: 'Organization menu', exact: true }).click()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const invite = page.getByRole('dialog', { name: 'Invite people' })
  await expectTitleAtStart(invite)
  const cancel = await cancelPaint(invite)
  await page.goto(`${base}/settings?state=full`)
  await page.getByRole('button', { name: 'Emir Karabeg', exact: true }).last().click()
  const edit = page.getByRole('dialog', { name: 'Edit display name' })
  await expect(edit.getByRole('textbox', { name: 'Display name' })).toBeFocused()
  await expectTitleAtStart(edit)
  expect(await cancelPaint(edit)).toEqual(cancel)
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(edit).toBeHidden()
})

test('invite recipients can be typed, pasted, corrected and removed by keyboard or pointer', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto(`${base}/home?state=full`)
  const expand = page.getByRole('button', { name: 'Expand sidebar' })
  await expand.click()
  const organization = page.getByRole('button', { name: 'Organization menu', exact: true })
  await organization.click()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Invite people' })
  const input = modal.getByRole('textbox', { name: 'Email addresses' })
  const remove = (address: string) => modal.getByRole('button', { name: `Remove ${address}` })
  await expect(input).toBeFocused()
  await page.keyboard.type('first@example.test,second@example.test')
  await page.keyboard.press('Enter')
  await expect(remove('second@example.test')).toBeAttached()
  await page.keyboard.press('Backspace')
  await expect(remove('second@example.test')).toHaveCount(0)
  const longAddress = 'warehouse-reconciliation-and-customer-operations@example.test'
  await page.evaluate(
    (address) =>
      navigator.clipboard.writeText(`first@example.test;${address}\nthird@example.test,typo`),
    longAddress
  )
  await page.keyboard.press('ControlOrMeta+v')
  await expect(modal.getByRole('button', { name: /^Remove / })).toHaveCount(4)
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Backspace')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  const longRemove = remove(longAddress)
  await longRemove.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  const firstRowBottom = await remove('first@example.test').evaluate(
    (button) => button.getBoundingClientRect().bottom
  )
  for (const hover of [false, true]) {
    if (hover) await longRemove.hover()
    const bounds = await longRemove.evaluate((button, address) => {
      let tag = button.parentElement
      while (tag && !tag.textContent?.includes(address)) tag = tag.parentElement
      if (!tag) throw new Error('Missing tag around the address and its remove button')
      const hit = button.getBoundingClientRect()
      const box = tag.getBoundingClientRect()
      return {
        top: hit.top,
        insideTag:
          hit.left >= box.left &&
          hit.right <= box.right &&
          hit.top >= box.top &&
          hit.bottom <= box.bottom,
        visible: button
          .querySelector('svg')
          ?.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      }
    }, longAddress)
    expect(bounds.top).toBeGreaterThanOrEqual(firstRowBottom)
    expect(bounds, hover ? 'Hovered remove action' : 'Resting remove action').toMatchObject({
      insideTag: true,
      visible: true,
    })
  }
  await longRemove.click()
  await expect(longRemove).toHaveCount(0)
  await expect(input).toBeFocused()
  await page.keyboard.type('draft')
  await page.keyboard.press('Backspace')
  await expect(input).toHaveValue('draf')
  await expect(remove('third@example.test')).toBeAttached()
  await input.fill('')
  await page.evaluate(() =>
    navigator.clipboard.writeText(
      Array.from({ length: 50 }, (_, index) => `member${index}@example.test`).join('\n')
    )
  )
  await page.keyboard.press('ControlOrMeta+v')
  await expect(remove('member49@example.test')).toBeAttached()
  await expect(input).toBeInViewport({ ratio: 1 })
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()
  await expect(organization).toBeFocused()
  await organization.click()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(modal.getByRole('button', { name: /^Remove / })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(expand).toBeFocused()
})
