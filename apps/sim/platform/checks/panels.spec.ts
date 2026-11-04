import { expect, test } from '@playwright/test'

const base = 'http://127.0.0.1:3181'

test('a chat panel preserves its file, tabs and focus across resize, collapse and restore', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${base}/chat/weekly-review?theme=light&state=full`)
  const open = page.getByRole('button', { name: 'Open chat panel' })
  await open.click()
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
  await page.setViewportSize({ width: 673, height: 823 })
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
