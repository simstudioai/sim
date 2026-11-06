import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fullPageScreenshot } from '@/scripts/org-redesign-e2e/checks/walk'
import { ADMIN, MEMBER } from '@/scripts/org-redesign-e2e/fixture'
import {
  artifactDirectory,
  check,
  DESKTOP,
  expect,
  onHome,
  orgUrl,
  PHONE,
  section,
  withSession,
} from '@/scripts/org-redesign-e2e/harness'
import { navLabels } from '@/scripts/org-redesign-e2e/locators'

export async function peoplePhaseChecks() {
  section('People with its flag on')
  await check('nav: People sits after Search', async () => {
    await onHome(MEMBER, async ({ page }) => {
      assert.deepEqual(await navLabels(page), ['Home', 'Search', 'People', 'Integrations', 'Links'])
    })
  })
  await check(
    'a member reads that an organization admin connects the directory, and no name',
    async () => {
      await withSession(MEMBER, async ({ page }) => {
        await page.goto(orgUrl('/people'))
        await expect(page.getByRole('button', { name: 'Org chart' })).toBeVisible()
        await expect(page.getByText(/organization admin/i).first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Directory sync' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Connect Okta' })).toHaveCount(0)
      })
    }
  )
  await check('an admin can sync and import from the empty state', async () => {
    await withSession(ADMIN, async ({ page }) => {
      await page.goto(orgUrl('/people'))
      await expect(page.getByRole('button', { name: 'Connect Okta' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Import profiles' })).toBeVisible()
    })
  })
  await check('the directory lists the organization', async () => {
    await withSession(MEMBER, async ({ page }) => {
      await page.goto(orgUrl('/people?view=directory'))
      await expect(page.getByText(ADMIN.name).first()).toBeVisible()
    })
  })
  await walkPeopleRoutes()
}

async function walkPeopleRoutes() {
  for (const persona of [MEMBER, ADMIN]) {
    for (const theme of ['light', 'dark'] as const) {
      await check(`${persona.key} ${theme}: People screenshots`, async () => {
        await withSession(
          persona,
          async (session) => {
            for (const viewport of [DESKTOP, PHONE]) {
              await session.page.setViewportSize({ width: viewport.width, height: viewport.height })
              for (const [name, path] of [
                ['chart', 'people'],
                ['directory', 'people?view=directory'],
              ]) {
                await session.page.goto(orgUrl(`/${path}`))
                await session.settle()
                await fullPageScreenshot(
                  session.page,
                  resolve(
                    artifactDirectory,
                    `${persona.key}__people-${name}__${viewport.name}__${theme}.png`
                  ),
                  viewport
                )
              }
            }
          },
          { theme }
        )
      })
    }
  }
}
