import type { Page } from '@playwright/test'
import { expect, test } from '../../fixtures/persona-test'
import { absoluteE2eUrl, readinessLocator, resolveContractPath } from './contract-resolver'
import { type SectionContract, sectionContracts } from './contracts'

for (const literalContract of sectionContracts) {
  const contract: SectionContract = literalContract
  test(`${contract.contractId} is reachable through its sidebar contract`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const context = await contextForPersona(contract.driver.personaKey)
    const page = await context.newPage()
    const targetPath = resolveContractPath(personaManifest, contract.pathTemplate, contract.driver)
    const startingPath = resolveStartingPath(contract, personaManifest)

    await page.goto(absoluteE2eUrl(startingPath))

    const targetButton = page.getByRole('button', { name: contract.label, exact: true })
    await expect(targetButton).toBeVisible()

    const successfulResponse = contract.successfulResponse
      ? page.waitForResponse((response) => {
          const url = new URL(response.url())
          return url.pathname === contract.successfulResponse?.path && response.status() === 200
        })
      : null
    await targetButton.click()
    await expect(page).toHaveURL(absoluteE2eUrl(targetPath))
    if (successfulResponse) {
      const response = await successfulResponse
      if (contract.successfulResponse?.expectedJson !== undefined) {
        await expect(response.json()).resolves.toEqual(contract.successfulResponse.expectedJson)
      }
    }

    await assertCanonicalSettingsPage(page, contract, targetPath)
  })
}

async function assertCanonicalSettingsPage(
  page: Page,
  contract: SectionContract,
  targetPath: string
): Promise<void> {
  await expect(page).toHaveURL(absoluteE2eUrl(targetPath))
  await expect(
    page.getByRole('heading', { name: contract.heading, level: 1, exact: true }),
    `${contract.contractId} heading changed; update the literal navigation contract intentionally`
  ).toBeVisible()
  await expect(
    page.getByText(contract.description, { exact: true }),
    `${contract.contractId} description changed; update the literal navigation contract intentionally`
  ).toBeVisible()
  await expect(readinessLocator(page, contract.readiness)).toBeVisible()
  await expect(page.getByRole('button', { name: contract.label, exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  )
  await expect(
    page.getByRole('heading', { name: 'Failed to load settings', exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Something went wrong', exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Settings unavailable', exact: true })
  ).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Setting unavailable', exact: true })).toHaveCount(
    0
  )
}

function resolveStartingPath(
  contract: SectionContract,
  manifest: Parameters<typeof resolveContractPath>[0]
): string {
  if (contract.plane === 'account') {
    return contract.sectionId === 'general'
      ? '/account/settings/api-keys'
      : '/account/settings/general'
  }

  if (contract.plane === 'organization') {
    const section = contract.sectionId === 'members' ? 'access-control' : 'members'
    return resolveContractPath(
      manifest,
      `/organization/{organizationId}/settings/${section}`,
      contract.driver
    )
  }

  const section = contract.sectionId === 'general' ? 'secrets' : 'general'
  return resolveContractPath(
    manifest,
    `/workspace/{workspaceId}/settings/${section}`,
    contract.driver
  )
}
