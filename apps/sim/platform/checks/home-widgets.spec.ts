import { expect, test } from '@playwright/test'
import { fixtureUrl } from '@/platform/checks/routes'

test('Home recent links scroll, open independently and share dismissals with Chat', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(fixtureUrl('/home?state=stress'))
  const lane = page.getByRole('region', { name: 'Recents', exact: true })
  await expect(lane).toHaveAttribute('data-edges', 'end')
  await page.getByRole('button', { name: 'Scroll Recents forward' }).click()
  await expect(lane).toHaveAttribute('data-edges', /both|start/)
  await lane.press('Home')
  const github = lane.getByRole('link', { name: 'GitHub', exact: true })
  await context.route('https://github.com/', (route) => route.fulfill({ body: 'GitHub' }))
  const popup = page.waitForEvent('popup')
  await github.click()
  const link = await popup
  await expect(link).toHaveURL('https://github.com/')
  await link.close()
  await github.hover()
  await lane.getByRole('button', { name: 'Remove GitHub from recents' }).click()
  await expect(github).toHaveCount(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('a[href*="/chat/weekly-review"]').first().click()
  await page.getByRole('button', { name: 'Open chat panel' }).click()
  const history = page
    .getByRole('complementary', { name: 'Chat panel' })
    .getByRole('list', { name: 'Recents' })
  await expect(history.getByRole('button', { name: 'GitHub', exact: true })).toHaveCount(0)
  await expect(history.getByRole('button', { name: 'Gmail', exact: true })).toBeVisible()
})

test('long Home lists scroll to the last item without moving their headings or growing the dashboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(fixtureUrl('/home?state=stress'))
  for (const [title, label] of [
    ['Email', 'Email messages'],
    ['Needs your attention', 'Attention requests'],
  ]) {
    const widget = page.getByRole('region', { name: title, exact: true })
    const viewport = widget.getByRole('region', { name: label })
    await widget.scrollIntoViewIfNeeded()
    const heading = widget.getByRole('heading', { name: title })
    const top = (await heading.boundingBox())?.y
    await expect(viewport).toHaveAttribute('data-edges', 'end')
    await viewport.focus()
    await viewport.press('End')
    await expect(viewport).toHaveAttribute('data-edges', 'start')
    await expect(viewport.getByRole('listitem').last()).toBeInViewport()
    expect((await heading.boundingBox())?.y).toBe(top)
  }
})
