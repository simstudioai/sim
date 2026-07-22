import { expect, test } from '../../fixtures/persona-test'
import { absoluteE2eUrl, resolveBoundResourceId } from './contract-resolver'

const PLATFORM_WORKSPACE_BINDING = {
  worldKey: 'settings-primary',
  resourceKind: 'workspace',
  resourceKey: 'platform-admin-workspace',
} as const

test('workspace section replacement keeps browser Back pointed at the pre-settings page', async ({
  contextForPersona,
  personaManifest,
}) => {
  const context = await contextForPersona('platformAdmin')
  const page = await context.newPage()
  const workspaceId = resolveBoundResourceId(personaManifest, PLATFORM_WORKSPACE_BINDING)
  const homePath = `/workspace/${encodeURIComponent(workspaceId)}/home`

  await page.goto(absoluteE2eUrl(`${homePath}?from=navigation-history`))
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(
    absoluteE2eUrl(`/workspace/${encodeURIComponent(workspaceId)}/settings/general`)
  )
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('settings-return-url')))
    .toBe(homePath)

  await page.getByRole('button', { name: 'Secrets', exact: true }).click()
  await expect(page).toHaveURL(
    absoluteE2eUrl(`/workspace/${encodeURIComponent(workspaceId)}/settings/secrets`)
  )
  await page.getByRole('button', { name: 'Sim API keys', exact: true }).click()
  await expect(page).toHaveURL(
    absoluteE2eUrl(`/workspace/${encodeURIComponent(workspaceId)}/settings/apikeys`)
  )

  await page.goBack()
  await expect(page).toHaveURL(absoluteE2eUrl(`${homePath}?from=navigation-history`))
})

test('workspace app Back consumes the pathname-only return target', async ({
  contextForPersona,
  personaManifest,
}) => {
  const context = await contextForPersona('platformAdmin')
  const page = await context.newPage()
  const workspaceId = resolveBoundResourceId(personaManifest, PLATFORM_WORKSPACE_BINDING)
  const homePath = `/workspace/${encodeURIComponent(workspaceId)}/home`

  await page.goto(absoluteE2eUrl(`${homePath}?ignored=query`))
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Secrets', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()

  await expect(page).toHaveURL(absoluteE2eUrl(homePath))
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('settings-return-url')))
    .toBeNull()
})

test('direct workspace settings entry falls back to workspace home', async ({
  contextForPersona,
  personaManifest,
}) => {
  const context = await contextForPersona('platformAdmin')
  const page = await context.newPage()
  const workspaceId = resolveBoundResourceId(personaManifest, PLATFORM_WORKSPACE_BINDING)
  const workspacePrefix = `/workspace/${encodeURIComponent(workspaceId)}`

  await page.goto(absoluteE2eUrl(`${workspacePrefix}/settings/general`))
  await page.getByRole('button', { name: 'Back', exact: true }).click()

  await expect(page).toHaveURL(absoluteE2eUrl(`${workspacePrefix}/home`))
})

for (const standaloneCase of [
  {
    name: 'account',
    personaKey: 'platformAdmin',
    entryPath: '/account/settings/general',
    binding: PLATFORM_WORKSPACE_BINDING,
  },
  {
    name: 'organization',
    personaKey: 'enterpriseOrganizationAdmin',
    entryPath: '/organization/{organizationId}/settings/members',
    binding: {
      worldKey: 'settings-primary',
      resourceKind: 'workspace',
      resourceKey: 'enterprise-workspace',
    } as const,
    organizationBinding: {
      worldKey: 'settings-primary',
      resourceKind: 'organization',
      resourceKey: 'enterprise-organization',
    } as const,
  },
] as const) {
  test(`${standaloneCase.name} Back reaches the resolved workspace destination`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const context = await contextForPersona(standaloneCase.personaKey)
    const page = await context.newPage()
    const workspaceId = resolveBoundResourceId(personaManifest, standaloneCase.binding)
    let entryPath: string = standaloneCase.entryPath
    if ('organizationBinding' in standaloneCase && standaloneCase.organizationBinding) {
      entryPath = entryPath.replace(
        '{organizationId}',
        encodeURIComponent(
          resolveBoundResourceId(personaManifest, standaloneCase.organizationBinding)
        )
      )
    }

    await page.goto(absoluteE2eUrl(entryPath))
    const expectedUrl = absoluteE2eUrl(`/workspace/${encodeURIComponent(workspaceId)}/home`)
    const backButton = page.getByRole('button', { name: 'Back', exact: true })
    await backButton.click()
    await expect(page).toHaveURL(expectedUrl)
  })
}
