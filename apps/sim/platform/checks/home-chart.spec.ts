import { expect, test } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'

test('a day without activity keeps its place within the selected calendar window', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=stress'))
  const chart = page.getByRole('region', { name: 'Tasks run', exact: true })
  await chart.getByRole('group', { name: 'Tasks run data' }).focus()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  const tip = chart.getByRole('tooltip')
  await expect(tip).toContainText('Oct 11, 2026')
  await expect(tip.getByText('0', { exact: true })).toBeVisible()
  await page.keyboard.press('Home')
  await expect(tip).toContainText('Oct 7, 2026')
})

test('Home switches the activity metric while keeping its date window and widget visibility', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full'))
  const build = page.getByRole('region', { name: 'Tasks run', exact: true })
  const search = page.getByRole('region', { name: 'Searches', exact: true })
  await build.getByRole('button', { name: 'Range: Last 7 days' }).click()
  await page.getByRole('menuitemradio', { name: 'Last 90 days' }).click()
  const buildData = build.getByRole('group', { name: 'Tasks run data' })
  await buildData.focus()
  await page.keyboard.press('End')
  const lastBuildPoint = await build.getByRole('tooltip').innerText()

  await page.getByRole('radio', { name: 'Search', exact: true }).click()
  await expect(search.getByRole('button', { name: 'Range: Last 90 days' })).toBeVisible()
  await expect(build).toHaveCount(0)
  await expect(
    search.getByRole('list', { name: 'Chart periods' }).getByRole('listitem')
  ).toHaveText(['Jul 16', 'Aug 29', 'Oct 13'])
  const searchData = search.getByRole('group', { name: 'Searches data' })
  await searchData.focus()
  await page.keyboard.press('Home')
  await expect(search.getByRole('tooltip')).toContainText('Jul 16, 2026')
  await page.keyboard.press('End')
  const searchTip = search.getByRole('tooltip')
  await expect(searchTip).toContainText('Oct 13, 2026')
  expect((await searchTip.innerText()).replace('Searches', 'Tasks run')).not.toBe(lastBuildPoint)

  const customize = page.getByRole('button', { name: 'Customize Home' })
  await customize.click()
  await page.getByRole('menuitemcheckbox', { name: 'Searches' }).click()
  await page.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
  await page.getByRole('radio', { name: 'Build', exact: true }).click()
  await expect(build).toHaveCount(0)
  await customize.click()
  const tasks = page.getByRole('menuitemcheckbox', { name: 'Tasks run' })
  await expect(tasks).not.toBeChecked()
  await tasks.click()
  await page.keyboard.press('Escape')
  await expect(build.getByRole('button', { name: 'Range: Last 90 days' })).toBeVisible()
})
