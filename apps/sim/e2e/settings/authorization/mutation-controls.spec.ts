import { randomUUID } from 'node:crypto'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../../fixtures/persona-test'
import {
  absoluteE2eUrl,
  readinessLocator,
  resolveContractPath,
} from '../navigation/contract-resolver'
import type {
  AuthorizationReadiness,
  ControlScope,
  MutationControlCase,
  MutationControlProbe,
  SemanticControl,
} from './contracts'
import { mutationControlCases } from './contracts'

for (const literalCase of mutationControlCases.filter(
  ({ arrangement }) => arrangement !== 'archived-workflow'
)) {
  const mutationCase: MutationControlCase = literalCase

  test(`${mutationCase.caseId} exposes only its authorized mutation controls`, async ({
    contextForPersona,
    personaManifest,
  }) => {
    const context = await contextForPersona(mutationCase.driver.personaKey)
    const page = await context.newPage()
    const path = resolveContractPath(
      personaManifest,
      mutationCase.pathTemplate,
      mutationCase.driver
    )

    const response = await page.goto(absoluteE2eUrl(path))
    expect(response?.ok(), `${mutationCase.caseId} document response`).toBe(true)
    await expect(page).toHaveURL(absoluteE2eUrl(path))
    await expectMutationPermissionsReady(page, mutationCase.pathTemplate)
    await expectAuthorizationReadiness(page, mutationCase.readiness)

    for (const probe of mutationCase.controls.filter(({ scope }) => scope.kind !== 'dialog')) {
      await assertControlProbe(page, probe)
    }

    if (mutationCase.openDialogWith) {
      const trigger = controlLocator(page, mutationCase.openDialogWith)
      await expect(trigger).toBeVisible()
      await expect(trigger).toBeEnabled()
      await trigger.click()
    }

    for (const probe of mutationCase.controls.filter(({ scope }) => scope.kind === 'dialog')) {
      await assertControlProbe(page, probe)
    }
  })
}

test('Recently deleted scopes Restore to write and admin access', async ({
  contextForPersona,
  personaManifest,
}) => {
  const archivedCases = mutationControlCases.filter(
    ({ arrangement }) => arrangement === 'archived-workflow'
  )
  expect(archivedCases.map(({ driver }) => driver.personaKey)).toEqual([
    'workspaceReadMember',
    'workspaceWriteMember',
    'workspaceAdminMember',
  ])

  const ownerContext = await contextForPersona('paidOrganizationOwner')
  const workspaceId = personaManifest.worlds['settings-primary'].workspaceIds['team-workspace']
  if (!workspaceId) throw new Error('Missing team-workspace binding for archived workflow')

  const guardWorkflowName = `e2e-authorization-guard-${randomUUID()}`
  const guardResponse = await ownerContext.request.post('/api/workflows', {
    data: { name: guardWorkflowName, description: '', workspaceId },
  })
  expect(guardResponse.status(), 'workflow arrangement guard POST').toBe(200)
  await expect(guardResponse.json()).resolves.toMatchObject({
    id: expect.any(String),
    name: guardWorkflowName,
    workspaceId,
  })

  const workflowName = `e2e-authorization-archived-${randomUUID()}`
  const createResponse = await ownerContext.request.post('/api/workflows', {
    data: { name: workflowName, description: '', workspaceId },
  })
  expect(createResponse.status(), 'workflow arrangement POST').toBe(200)
  const created = (await createResponse.json()) as {
    id?: string
    name?: string
    workspaceId?: string
  }
  expect(created).toMatchObject({ name: workflowName, workspaceId })
  expect(created.id).toBeTruthy()

  const deleteResponse = await ownerContext.request.delete(
    `/api/workflows/${encodeURIComponent(created.id ?? '')}`
  )
  const deletePayload = await deleteResponse.json()
  expect(
    deleteResponse.status(),
    `workflow arrangement DELETE: ${JSON.stringify(deletePayload)}`
  ).toBe(200)
  expect(deletePayload).toEqual({ success: true })

  for (const archivedCase of archivedCases) {
    const context = await contextForPersona(archivedCase.driver.personaKey)
    const page = await context.newPage()
    const path = resolveContractPath(
      personaManifest,
      archivedCase.pathTemplate,
      archivedCase.driver
    )
    const response = await page.goto(absoluteE2eUrl(path))
    expect(response?.ok(), `${archivedCase.caseId} document response`).toBe(true)
    await expectMutationPermissionsReady(page, archivedCase.pathTemplate)
    await expectAuthorizationReadiness(page, archivedCase.readiness)
    await expect(page.getByText(workflowName, { exact: true })).toBeVisible()

    for (const probe of archivedCase.controls) {
      await assertControlProbe(page, {
        ...probe,
        scope: probe.scope.kind === 'row' ? { ...probe.scope, name: workflowName } : probe.scope,
      })
    }
  }
})

async function expectAuthorizationReadiness(
  page: Page,
  readiness: AuthorizationReadiness
): Promise<void> {
  if (readiness.kind === 'text-pattern') {
    await expect(page.getByText(new RegExp(readiness.source))).toBeVisible()
    return
  }
  await expect(readinessLocator(page, readiness)).toBeVisible()
}

async function expectMutationPermissionsReady(page: Page, pathTemplate: string): Promise<void> {
  if (pathTemplate.startsWith('/workspace/')) {
    const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
    const navigation = sidebar.getByRole('navigation', { name: 'Workspace settings sections' })
    await expect(navigation).toHaveAttribute('aria-busy', 'false')
    await expect(navigation).toHaveAttribute('data-authorization-state', 'granted')
    return
  }

  // Members is the only organization route with an absent-control probe; the
  // integrity spec requires any future organization absence case to add a barrier.
  if (pathTemplate.endsWith('/settings/members')) {
    await expect(page.getByRole('region', { name: 'Organization members' })).toHaveAttribute(
      'aria-busy',
      'false'
    )
  }
}

async function assertControlProbe(page: Page, probe: MutationControlProbe): Promise<void> {
  const scope = scopeLocator(page, probe.scope)
  if (probe.scope.kind === 'dialog') await expect(scope).toBeVisible()
  const control = controlLocator(scope, probe.control)

  switch (probe.expectation) {
    case 'absent':
      await expect(control, probe.probeId).toHaveCount(0)
      break
    case 'present':
      await expect(control, probe.probeId).toBeVisible()
      break
    case 'enabled':
      await expect(control, probe.probeId).toBeVisible()
      await expect(control, probe.probeId).toBeEnabled()
      break
    case 'disabled':
      await expect(control, probe.probeId).toBeVisible()
      await expect(control, probe.probeId).toBeDisabled()
      break
  }
}

function scopeLocator(page: Page, scope: ControlScope): Locator {
  switch (scope.kind) {
    case 'page':
      return page.locator('body')
    case 'dialog':
      return page.getByRole('dialog', { name: scope.name, exact: true })
    case 'section':
      return page.getByRole('region', { name: scope.name, exact: true })
    case 'row':
      return page.getByRole('group', { name: scope.name, exact: true })
  }
}

function controlLocator(scope: Page | Locator, control: SemanticControl): Locator {
  switch (control.kind) {
    case 'button':
      return scope.getByRole('button', { name: control.name, exact: true })
    case 'textbox':
      return scope.getByRole('textbox', { name: control.name, exact: true })
    case 'switch':
      return scope.getByRole('switch', { name: control.name, exact: true })
    case 'radio':
      return scope.getByRole('radio', { name: control.name, exact: true })
  }
}
