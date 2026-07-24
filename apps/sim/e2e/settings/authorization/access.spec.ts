import type { Page } from '@playwright/test'
import { expect, test } from '../../fixtures/persona-test'
import {
  absoluteE2eUrl,
  readinessLocator,
  resolveBoundResourceId,
  resolveContractPath,
} from '../navigation/contract-resolver'
import type { AccessGateCase } from './contracts'
import { accessGateCases } from './contracts'

for (const literalCase of accessGateCases) {
  const accessCase: AccessGateCase = literalCase

  test(`${accessCase.caseId} matches its authorization contract`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const context = await contextForPersona(accessCase.driver.personaKey)
    const page = await context.newPage()

    if (
      accessCase.sidebar.state !== 'absent-shell' &&
      accessCase.sidebar.existingProofId === undefined
    ) {
      await gotoAccessibleNeutral(page, accessCase, personaManifest)
      await assertSidebarState(page, accessCase)
    }

    const targetPath = resolveContractPath(
      personaManifest,
      accessCase.pathTemplate,
      accessCase.driver
    )
    const responseProof =
      accessCase.outcome.kind === 'render' ? accessCase.outcome.successfulResponse : undefined
    const proofPromise = responseProof
      ? page.waitForResponse((response) => {
          const responseUrl = new URL(response.url())
          const baseUrl = new URL(absoluteE2eUrl('/'))
          return (
            responseUrl.origin === baseUrl.origin &&
            responseUrl.pathname === responseProof.path &&
            response.status() === 200
          )
        })
      : null

    const navigationResponse = await page.goto(absoluteE2eUrl(targetPath))
    const proofResponse = proofPromise ? await proofPromise : null
    if (proofResponse && responseProof?.expectedJson !== undefined) {
      await expect(proofResponse.json()).resolves.toEqual(responseProof.expectedJson)
    }

    await expect(page).toHaveURL(absoluteE2eUrl(targetPath))
    switch (accessCase.outcome.kind) {
      case 'render': {
        expect(navigationResponse?.ok(), `${accessCase.caseId} document response`).toBe(true)
        await expect(
          page.getByRole('heading', {
            name: accessCase.outcome.heading,
            level: 1,
            exact: true,
          })
        ).toBeVisible()
        const readiness = readinessLocator(page, accessCase.outcome.readiness)
        await expect(readiness).toBeVisible()
        if (accessCase.outcome.readinessState === 'enabled') await expect(readiness).toBeEnabled()
        if (accessCase.outcome.readinessState === 'disabled') await expect(readiness).toBeDisabled()
        break
      }
      case 'not-found':
        expect(
          navigationResponse?.status(),
          `${accessCase.caseId} must use the real route 404 boundary`
        ).toBe(404)
        break
      case 'workspace-access-denied':
        await expect(
          page.getByRole('heading', {
            name: 'Workspace access denied',
            level: 1,
            exact: true,
          })
        ).toBeVisible()
        await expect(
          page.getByText(
            'You do not have access to this workspace. Ask a workspace administrator for access or choose another workspace.',
            { exact: true }
          )
        ).toBeVisible()
        await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toHaveCount(0)
        break
      case 'organization-unavailable':
        expect(navigationResponse?.ok(), `${accessCase.caseId} embedded denial response`).toBe(true)
        await expect(
          page.getByRole('heading', {
            name: accessCase.outcome.title,
            level: 1,
            exact: true,
          })
        ).toBeVisible()
        await expect(
          page.getByText(
            'You do not have access to manage this organization. Contact an organization owner or admin for help.',
            { exact: true }
          )
        ).toBeVisible()
        await expect(
          page.getByRole('complementary', {
            name: 'Organization settings navigation',
          })
        ).toBeVisible()
        break
      case 'organization-plan-unavailable':
        expect(navigationResponse?.ok(), `${accessCase.caseId} embedded denial response`).toBe(true)
        await expect(
          page.getByRole('heading', {
            name: accessCase.outcome.title,
            level: 1,
            exact: true,
          })
        ).toBeVisible()
        await expect(
          page.getByText('This setting is not enabled for this organization.', { exact: true })
        ).toBeVisible()
        await expect(
          page.getByRole('complementary', {
            name: 'Organization settings navigation',
          })
        ).toBeVisible()
        break
      case 'locked-render': {
        expect(navigationResponse?.ok(), `${accessCase.caseId} locked document response`).toBe(true)
        await expect(
          page.getByRole('heading', {
            name: accessCase.outcome.heading,
            level: accessCase.outcome.headingLevel ?? 1,
            exact: true,
          })
        ).toBeVisible()
        const readiness = readinessLocator(page, accessCase.outcome.readiness)
        await expect(readiness).toBeVisible()
        if (accessCase.outcome.readinessState === 'enabled') await expect(readiness).toBeEnabled()
        if (accessCase.outcome.readinessState === 'disabled') await expect(readiness).toBeDisabled()
        break
      }
    }
  })
}

async function gotoAccessibleNeutral(
  page: Page,
  accessCase: AccessGateCase,
  manifest: Parameters<typeof resolveContractPath>[0]
): Promise<void> {
  if (accessCase.plane === 'account') {
    await page.goto(absoluteE2eUrl('/account/settings/general'))
    await expect(
      page.getByRole('complementary', { name: 'Account settings navigation' })
    ).toBeVisible()
    return
  }

  if (accessCase.plane === 'organization') {
    const path = resolveContractPath(
      manifest,
      '/organization/{organizationId}/settings/members',
      accessCase.driver
    )
    await page.goto(absoluteE2eUrl(path))
    await expect(
      page.getByRole('complementary', { name: 'Organization settings navigation' })
    ).toBeVisible()
    return
  }

  const binding = accessCase.driver.binding
  if (!binding || binding.resourceKind !== 'workspace') {
    throw new Error(`${accessCase.caseId} requires a workspace binding`)
  }
  const workspaceId = resolveBoundResourceId(manifest, binding)
  const readiness = [
    waitForSuccessfulPath(page, '/api/permission-groups/user'),
    waitForSuccessfulPath(page, '/api/settings/allowed-integrations'),
    waitForSuccessfulPath(page, `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox`),
    waitForSuccessfulPath(
      page,
      `/api/workspaces/${encodeURIComponent(workspaceId)}/fork/availability`
    ),
  ]
  const path = resolveContractPath(
    manifest,
    '/workspace/{workspaceId}/settings/general',
    accessCase.driver
  )
  await Promise.all([page.goto(absoluteE2eUrl(path)), ...readiness])
  await expect(page.getByRole('complementary', { name: 'Workspace sidebar' })).toBeVisible()
}

async function assertSidebarState(page: Page, accessCase: AccessGateCase): Promise<void> {
  const label = accessCase.sidebar.label
  if (!label) throw new Error(`${accessCase.caseId} is missing its sidebar label`)

  const sidebar = page.getByRole('complementary', {
    name:
      accessCase.plane === 'account'
        ? 'Account settings navigation'
        : accessCase.plane === 'organization'
          ? 'Organization settings navigation'
          : 'Workspace sidebar',
  })
  const navigation =
    accessCase.plane === 'workspace'
      ? sidebar.getByRole('navigation', { name: 'Workspace settings sections' })
      : sidebar
  const item = navigation.getByRole('button', { name: label, exact: true })

  if (accessCase.sidebar.state === 'hidden') {
    await expect(item).toHaveCount(0)
    return
  }
  await expect(item).toBeVisible()
  if (accessCase.sidebar.state === 'locked') {
    await expect(item.getByText('Max', { exact: true })).toBeVisible()
  }
}

function waitForSuccessfulPath(page: Page, pathname: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.origin === new URL(absoluteE2eUrl('/')).origin &&
      url.pathname === pathname &&
      response.status() === 200
    )
  })
}
