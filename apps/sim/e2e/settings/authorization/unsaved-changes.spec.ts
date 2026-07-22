import type { Locator } from '@playwright/test'
import { expect, test } from '../../fixtures/persona-test'
import { absoluteE2eUrl, resolveContractPath } from '../navigation/contract-resolver'

const enterpriseOrganizationDriver = {
  personaKey: 'enterpriseOrganizationAdmin',
  binding: {
    worldKey: 'settings-primary',
    resourceKind: 'organization',
    resourceKey: 'enterprise-organization',
  },
} as const

const enterpriseWorkspaceDriver = {
  personaKey: 'enterpriseOrganizationAdmin',
  binding: {
    worldKey: 'settings-primary',
    resourceKind: 'workspace',
    resourceKey: 'enterprise-workspace',
  },
} as const

test('organization section navigation keeps or discards Whitelabeling edits', async ({
  contextForPersona,
  personaManifest,
}) => {
  const context = await contextForPersona(enterpriseOrganizationDriver.personaKey)
  const page = await context.newPage()
  const whitelabelPath = resolveContractPath(
    personaManifest,
    '/organization/{organizationId}/settings/whitelabeling',
    enterpriseOrganizationDriver
  )
  const membersPath = resolveContractPath(
    personaManifest,
    '/organization/{organizationId}/settings/members',
    enterpriseOrganizationDriver
  )
  await page.goto(absoluteE2eUrl(whitelabelPath))

  const brandName = page.getByRole('textbox', { name: 'Brand name', exact: true })
  const dirtyValue = await dirtyBrandName(brandName)
  await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  const sidebar = page.getByRole('complementary', {
    name: 'Organization settings navigation',
  })
  const members = sidebar.getByRole('button', { name: 'Members', exact: true })

  await members.click()
  const dialog = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page).toHaveURL(absoluteE2eUrl(whitelabelPath))
  await expect(brandName).toHaveValue(dirtyValue)

  await members.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page).toHaveURL(absoluteE2eUrl(membersPath))
  await expect(page.getByRole('heading', { name: 'Members', level: 1, exact: true })).toBeVisible()
})

test('workspace app Back returns to the real entry route after keep then discard', async ({
  contextForPersona,
  personaManifest,
}) => {
  const context = await contextForPersona(enterpriseWorkspaceDriver.personaKey)
  const page = await context.newPage()
  const workspaceId =
    personaManifest.worlds['settings-primary'].workspaceIds['enterprise-workspace']
  if (!workspaceId) throw new Error('Missing enterprise-workspace binding')

  const homePath = `/workspace/${encodeURIComponent(workspaceId)}/home`
  const generalPath = resolveContractPath(
    personaManifest,
    '/workspace/{workspaceId}/settings/general',
    enterpriseWorkspaceDriver
  )
  const whitelabelPath = resolveContractPath(
    personaManifest,
    '/workspace/{workspaceId}/settings/whitelabeling',
    enterpriseWorkspaceDriver
  )

  await page.goto(absoluteE2eUrl(homePath))
  const settingsEntry = page.getByRole('link', { name: 'Settings', exact: true })
  await expect(settingsEntry).toBeVisible()
  await settingsEntry.click()
  await expect(page).toHaveURL(absoluteE2eUrl(generalPath))

  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
  await sidebar.getByRole('button', { name: 'Whitelabeling', exact: true }).click()
  await expect(page).toHaveURL(absoluteE2eUrl(whitelabelPath))

  const brandName = page.getByRole('textbox', { name: 'Brand name', exact: true })
  const dirtyValue = await dirtyBrandName(brandName)
  await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  const back = sidebar.getByRole('button', { name: 'Back', exact: true })

  await back.click()
  const dialog = page.getByRole('dialog', { name: 'Unsaved changes', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(page).toHaveURL(absoluteE2eUrl(whitelabelPath))
  await expect(brandName).toHaveValue(dirtyValue)

  await back.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(page).toHaveURL(absoluteE2eUrl(homePath))
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('settings-return-url')))
    .toBeNull()
})

test('native beforeunload dismissal keeps the dirty page open', async ({
  contextForPersona,
  personaManifest,
}) => {
  const context = await contextForPersona(enterpriseOrganizationDriver.personaKey)
  const page = await context.newPage()
  const whitelabelPath = resolveContractPath(
    personaManifest,
    '/organization/{organizationId}/settings/whitelabeling',
    enterpriseOrganizationDriver
  )
  await page.goto(absoluteE2eUrl(whitelabelPath))

  const brandName = page.getByRole('textbox', { name: 'Brand name', exact: true })
  const dirtyValue = await dirtyBrandName(brandName)
  await expect(page.getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toHaveCount(0)

  const dialogPromise = page.waitForEvent('dialog')
  const closePromise = page.close({ runBeforeUnload: true })
  const dialog = await dialogPromise
  expect(dialog.type()).toBe('beforeunload')
  await dialog.dismiss()
  await closePromise

  expect(page.isClosed()).toBe(false)
  await expect(page).toHaveURL(absoluteE2eUrl(whitelabelPath))
  await expect(brandName).toHaveValue(dirtyValue)
})

async function dirtyBrandName(brandName: Locator): Promise<string> {
  await expect(brandName).toBeVisible()
  const original = await brandName.inputValue()
  const dirtyValue = original ? `${original.slice(0, 48)}-unsaved` : 'E2E unsaved brand'
  await brandName.fill(dirtyValue)
  await expect(brandName).toHaveValue(dirtyValue)
  return dirtyValue
}
