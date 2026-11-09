import { expect } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

for (const theme of ['light', 'dark']) {
  test(`disabled menu commands keep their paint and cannot remove protected access in ${theme}`, async ({
    page,
  }) => {
    await page.goto(fixtureUrl(`/integrations/gmail?state=full&theme=${theme}`))
    const main = page.getByRole('main')
    await main.getByRole('button', { name: /^Customer operations service account / }).click()
    await main.getByRole('tab', { name: 'Access', exact: true }).click()
    const lockedRole = main.getByRole('button', { name: /^Role for Nina Patel:/ })
    const editableRole = main.getByRole('button', { name: /^Role for Alex Chen:/ })
    const insets = await Promise.all(
      [lockedRole, editableRole].map((control) =>
        control.evaluate((node) => {
          const style = getComputedStyle(node)
          return [style.paddingInlineStart, style.paddingInlineEnd, style.height]
        })
      )
    )
    expect(insets[0]).toEqual(insets[1])
    await main.getByRole('button', { name: 'Manage access for Nina Patel', exact: true }).click()
    const remove = page.getByRole('menuitem', { name: 'Remove', exact: true })
    await expect(remove).toBeDisabled()
    await expect(remove).toHaveCSS('opacity', '1')
    await expect(remove).toHaveCSS('cursor', 'not-allowed')
    const paint = await remove.evaluate((node) => {
      const style = getComputedStyle(node)
      return [style.color, style.backgroundColor, style.borderColor]
    })
    await remove.hover()
    await expect(page.getByRole('tooltip')).toContainText('Make someone else an admin')
    expect(
      await remove.evaluate((node) => {
        const style = getComputedStyle(node)
        return [style.color, style.backgroundColor, style.borderColor]
      })
    ).toEqual(paint)
    await remove.click({ force: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await main.getByRole('button', { name: 'Manage access for Nina Patel', exact: true }).focus()
    await remove.focus()
    await expect(page.getByRole('tooltip')).toContainText('Make someone else an admin')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(main.getByRole('button', { name: /^Role for Nina Patel:/ })).toContainText('Admin')
  })

  test(`secret reveal stays inset and app choices dismiss without reopening in ${theme}`, async ({
    page,
  }) => {
    await page.goto(fixtureUrl(`/integrations?tab=credentials&state=full&theme=${theme}`))
    await page.getByRole('button', { name: 'Create credential', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Create credential', exact: true })
    const value = modal.getByLabel('Value', { exact: true })
    await value.fill('local-draft-secret')
    const reveal = modal.getByRole('button', { name: /^Show(?: Value)?$/ })
    const revealBox = await reveal.boundingBox()
    const valueBox = await value.boundingBox()
    expect(revealBox?.height).toBe(24)
    expect(
      revealBox &&
        valueBox &&
        Math.abs(revealBox.y + revealBox.height / 2 - valueBox.y - valueBox.height / 2)
    ).toBeLessThanOrEqual(0.5)
    expect(revealBox && valueBox && revealBox.y - valueBox.y).toBeGreaterThanOrEqual(2)
    await reveal.click()
    await expect(value).toHaveAttribute('type', 'text')
    await modal.getByRole('button', { name: /^Hide(?: Value)?$/ }).click()
    await expect(value).toHaveAttribute('type', 'password')
    await expect(value).toHaveValue('local-draft-secret')
    const app = modal.getByRole('combobox', { name: 'App', exact: true })
    await app.click()
    await page.getByRole('option', { name: 'Google Drive', exact: true }).click()
    await expect(app).toContainText('Google Drive')
    await app.click()
    await modal.getByText('App', { exact: true }).click()
    await expect(app).toHaveAttribute('aria-expanded', 'false')
    await expect(app).toBeFocused()
    await app.click()
    await modal.getByRole('heading', { name: 'Create credential', exact: true }).click()
    await expect(app).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await value.click()
    await expect(value).toBeFocused()
    await expect(app).toContainText('Google Drive')
    await expect(value).toHaveValue('local-draft-secret')
    await app.click()
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(app).toHaveAttribute('aria-expanded', 'false')
    await expect(modal).toBeVisible()
  })
}

test.describe('searchable picker dismissal', () => {
  test.use({ hasTouch: true })

  for (const theme of ['light', 'dark']) {
    test(`people selection dismisses from its label without reopening in ${theme}`, async ({
      page,
    }) => {
      for (const surface of ['page', 'modal']) {
        await page.goto(
          fixtureUrl(
            `/integrations${surface === 'page' ? '?tab=skills&' : '/fireflies?'}state=full&theme=${theme}`
          )
        )
        if (surface === 'page') {
          await page.getByRole('link', { name: /^Weekly customer review / }).click()
          await page.getByRole('tab', { name: 'Access', exact: true }).click()
        } else {
          await page
            .getByRole('region', { name: 'Skills', exact: true })
            .getByRole('button')
            .first()
            .click()
          await page.getByRole('combobox', { name: 'Access', exact: true }).click()
          await page.getByRole('option', { name: 'Shared', exact: true }).click()
        }
        const editor =
          surface === 'page'
            ? page.getByRole('form', { name: 'Skill details', exact: true })
            : page.getByRole('dialog').first()
        const people = editor.getByRole('combobox', { name: /^People with access/ })
        const label = editor.getByText('People with access', { exact: true }).first()
        await people.click()
        for (const name of ['Alex Chen', 'Daniel Kim']) {
          await page.getByRole('option', { name, exact: true }).click()
        }
        const selected = await people.innerText()
        await label.click()
        await expect(people).toHaveAttribute('aria-expanded', 'false')
        await expect(page.getByRole('listbox')).toHaveCount(0)
        await expect(people).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(page.getByRole('combobox', { name: 'Find people', exact: true })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(people).toHaveAttribute('aria-expanded', 'false')
        await expect(people).toBeFocused()
        await people.click()
        await people.click()
        await expect(people).toHaveAttribute('aria-expanded', 'false')
        await people.tap()
        if (surface === 'page') await label.tap()
        else await editor.getByRole('heading').first().tap()
        await expect(people).toHaveAttribute('aria-expanded', 'false')
        await expect(page.getByRole('listbox')).toHaveCount(0)
        await expect(people).toHaveText(selected)
        await expect(people).toHaveAccessibleDescription(selected)
        await people.tap()
        await editor
          .getByRole('tab', { name: 'Access', exact: true })
          .or(editor.getByRole('heading').first())
          .first()
          .tap()
        await expect(people).toHaveAttribute('aria-expanded', 'false')
        await expect(editor).toBeVisible()
      }
    })
  }
})

for (const theme of ['light', 'dark']) {
  test(`date captions dismiss their calendar without reopening in ${theme}`, async ({ page }) => {
    await page.goto(fixtureUrl(`/settings/mothership?state=stress&tab=licenses&theme=${theme}`))
    const expiration = page.getByRole('button', { name: /^Expiration/ })
    const calendar = page.getByRole('dialog', { name: 'Expiration', exact: true })
    await expiration.click()
    await expect(calendar).toBeVisible()
    await page.getByText('Expiration (optional)', { exact: true }).click()
    await expect(expiration).toHaveAttribute('aria-expanded', 'false')
    await expect(calendar).toHaveCount(0)
    await expiration.focus()
    await page.keyboard.press('Enter')
    await expect(calendar).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(expiration).toBeFocused()
    await expect(expiration).toHaveAttribute('aria-expanded', 'false')
  })
}

test('a searchable workspace picker preserves its selection when dismissed through its caption', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/settings/mothership?state=stress&tab=byok'))
  const workspace = page.getByRole('combobox', { name: 'Target workspace', exact: true })
  await workspace.click()
  await page.getByRole('option', { name: 'Workspace', exact: true }).click()
  await expect(workspace).toHaveAccessibleDescription('Workspace')
  await workspace.click()
  await page.getByText('Target workspace', { exact: true }).click()
  await expect(workspace).toHaveAttribute('aria-expanded', 'false')
  await expect(workspace).toBeFocused()
  await expect(workspace).toContainText('Workspace')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('combobox', { name: 'Search workspaces', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(workspace).toBeFocused()
  await page.getByRole('button', { name: 'View workspace BYOK keys', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Workspace' })).toContainText(
    'Anthropic · Workspace key'
  )
})
