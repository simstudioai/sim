import type { Page } from '@playwright/test'
import { expect, test } from '../../fixtures/persona-test'
import { absoluteE2eUrl, resolveBoundResourceId, resolveContractPath } from './contract-resolver'
import { type PersonaVisibilityCase, personaVisibilityCases } from './contracts'

for (const visibilityCase of personaVisibilityCases) {
  test(`${visibilityCase.caseId} exposes its complete sidebar set`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const context = await contextForPersona(visibilityCase.driver.personaKey)
    const page = await context.newPage()
    const initialPath = initialVisibilityPath(visibilityCase, personaManifest)

    if (visibilityCase.plane === 'workspace') {
      const workspaceId = resolveBoundResourceId(personaManifest, requiredBinding(visibilityCase))
      const gateResponses = [
        waitForSuccessfulPath(page, '/api/permission-groups/user'),
        waitForSuccessfulPath(page, '/api/settings/allowed-integrations'),
        waitForSuccessfulPath(page, `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox`),
        waitForSuccessfulPath(
          page,
          `/api/workspaces/${encodeURIComponent(workspaceId)}/fork/availability`
        ),
      ]
      await Promise.all([page.goto(absoluteE2eUrl(initialPath)), ...gateResponses])
    } else {
      await page.goto(absoluteE2eUrl(initialPath))
    }

    const sidebar = page.getByRole('complementary', {
      name:
        visibilityCase.plane === 'account'
          ? 'Account settings navigation'
          : visibilityCase.plane === 'organization'
            ? 'Organization settings navigation'
            : 'Workspace sidebar',
    })
    await expect(sidebar).toBeVisible()
    const sectionNavigation =
      visibilityCase.plane === 'workspace'
        ? sidebar.getByRole('navigation', { name: 'Workspace settings sections' })
        : sidebar
    await expect(sectionNavigation).toBeVisible()
    await expect
      .poll(
        async () => {
          const buttons = await sectionNavigation.getByRole('button').all()
          const labels = await Promise.all(
            buttons.map((button) => button.getAttribute('aria-label'))
          )
          return labels.filter((label): label is string => label !== null)
        },
        { message: `${visibilityCase.caseId} visible sidebar order` }
      )
      .toEqual([...visibilityCase.expectedVisibleLabels])

    for (const hiddenLabel of visibilityCase.importantHiddenLabels) {
      await expect(sidebar.getByRole('button', { name: hiddenLabel, exact: true })).toHaveCount(0)
    }

    const representative = sidebar.getByRole('button', {
      name: visibilityCase.representativeLabel,
      exact: true,
    })
    await expect(representative).toBeVisible()
    const expectedUrl = absoluteE2eUrl(representativePath(visibilityCase, personaManifest))
    if (page.url() !== expectedUrl) await representative.click()
    await expect(page).toHaveURL(expectedUrl)
  })
}

function waitForSuccessfulPath(page: Page, pathname: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === pathname && response.status() === 200
  })
}

function initialVisibilityPath(
  visibilityCase: PersonaVisibilityCase,
  manifest: Parameters<typeof resolveContractPath>[0]
): string {
  if (visibilityCase.plane === 'account') return '/account/settings/general'
  if (visibilityCase.plane === 'organization') {
    return resolveContractPath(
      manifest,
      '/organization/{organizationId}/settings/members',
      visibilityCase.driver
    )
  }
  return resolveContractPath(
    manifest,
    '/workspace/{workspaceId}/settings/general',
    visibilityCase.driver
  )
}

function representativePath(
  visibilityCase: PersonaVisibilityCase,
  manifest: Parameters<typeof resolveContractPath>[0]
): string {
  if (visibilityCase.plane === 'account') {
    return `/account/settings/${visibilityCase.representativeSectionId}`
  }
  if (visibilityCase.plane === 'organization') {
    return resolveContractPath(
      manifest,
      `/organization/{organizationId}/settings/${visibilityCase.representativeSectionId}`,
      visibilityCase.driver
    )
  }
  return resolveContractPath(
    manifest,
    `/workspace/{workspaceId}/settings/${visibilityCase.representativeSectionId}`,
    visibilityCase.driver
  )
}

function requiredBinding(visibilityCase: PersonaVisibilityCase) {
  const binding = visibilityCase.driver.binding
  if (!binding) throw new Error(`${visibilityCase.caseId} requires a dynamic resource binding`)
  return binding
}
