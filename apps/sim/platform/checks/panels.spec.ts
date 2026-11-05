import { expect, test } from '@playwright/test'

const base = 'http://127.0.0.1:3181'

test('a chat panel preserves its file, tabs and focus across resize, collapse and restore', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${base}/chat/weekly-review?theme=light&state=full`)
  const open = page.getByRole('button', { name: 'Open chat panel' })
  const title = page.getByRole('heading', { level: 1, name: 'Review the renewal brief' })
  const titleBefore = await title.boundingBox()
  await open.click()
  const titleAfter = await title.boundingBox()
  if (!titleBefore || !titleAfter) throw new Error('The title must remain visible in split view')
  expect(titleAfter.x).toBe(titleBefore.x)
  expect(titleAfter.y).toBe(titleBefore.y)
  const panel = page.getByRole('complementary', { name: 'Chat panel' })
  await panel.getByRole('button', { name: 'Renewal brief', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'Aster Labs renewal brief' })).toBeVisible()
  await panel.getByRole('button', { name: 'New panel tab' }).click()
  await expect(panel.getByRole('tab', { selected: true })).toHaveAccessibleName('Workspaces')
  await panel.getByRole('tab', { name: 'Renewal brief' }).click()
  await panel.getByRole('button', { name: 'Expand panel' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Review the renewal brief' })
  ).toBeHidden()
  await panel.getByRole('button', { name: 'Restore split panel' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Review the renewal brief' })
  ).toBeVisible()
  await panel.getByRole('button', { name: 'New panel tab' }).click()
  const lastClose = panel.getByRole('button', { name: 'Close Workspaces tab' }).last()
  await lastClose.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('tab', { selected: true })).toBeFocused()
  await panel.getByRole('tab', { name: 'Renewal brief' }).click()
  await page.setViewportSize({ width: 673, height: 823 })
  const opener = await page.getByRole('button', { name: 'Expand sidebar' }).boundingBox()
  const add = await panel.getByRole('button', { name: 'New panel tab' }).boundingBox()
  if (!opener || !add) throw new Error('Both mobile navigation controls must be visible')
  expect(add.x).toBeGreaterThanOrEqual(opener.x + opener.width)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Review the renewal brief' })
  ).toBeHidden()
  await expect(panel.getByRole('heading', { name: 'Aster Labs renewal brief' })).toBeVisible()
  await panel.getByRole('button', { name: 'Close chat panel' }).click()
  await expect(open).toBeFocused()
  await open.click()
  await panel.getByRole('button', { name: 'Panel tabs' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Workspaces' }).click()
  await panel.getByRole('button', { name: 'Customer operations', exact: true }).last().click()
  await expect(page).toHaveURL(/\/home\?.*state=full/)
})

test('a disabled fixture gate serves no sample entity on any product route', async ({
  request,
}) => {
  for (const path of ['/home', '/chat/weekly-review', '/settings/members']) {
    const off = await request.get(`http://127.0.0.1:3180${path}?state=full`)
    expect(off.status()).toBe(200)
    expect(await off.text()).not.toMatch(
      /Sim Enterprise|Emir Karabeg|Aster Labs|linear-homepage\.[a-f0-9]+\.jpg/
    )
  }
})
