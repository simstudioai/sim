import {
  deletePermissionGroupByName,
  expectAccessControlReady,
  expectRestrictedWorkspace,
  expectUnrestrictedWorkspace,
  listPermissionGroups,
  newPersonaPage,
  primaryWorldIds,
  uniqueWorkflowName,
  waitForSameOriginResponse,
} from './helpers'
import { expect, test } from './workflow-test'

test('dynamic permission group denies five settings surfaces and deletion restores them', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const target = personaManifest.personas.enterpriseWorkflowMember
  const workspaceName =
    personaManifest.worlds['settings-primary'].workspaceIdentities['enterprise-workspace'].name
  const seededGroupId =
    personaManifest.worlds['settings-primary'].permissionGroupIds['restricted-enterprise-group']
  const groupName = uniqueWorkflowName('dynamic-restrictions')
  const { context: adminContext, page } = await newPersonaPage(
    contextForPersona,
    'enterpriseOrganizationAdmin'
  )
  const { context: baselineTargetContext } = await newPersonaPage(
    contextForPersona,
    'enterpriseWorkflowMember'
  )

  registerCleanup('remove dynamic permission group', () =>
    deletePermissionGroupByName(adminContext.request, ids.enterpriseOrganizationId, groupName)
  )
  await deletePermissionGroupByName(adminContext.request, ids.enterpriseOrganizationId, groupName)

  const seededGroupBefore = (
    await listPermissionGroups(adminContext.request, ids.enterpriseOrganizationId)
  ).find(({ id }) => id === seededGroupId)
  if (!seededGroupBefore) throw new Error('Missing seeded restricted Enterprise group')

  await expectUnrestrictedWorkspace(baselineTargetContext, ids.enterpriseWorkspaceId, 'read')

  await page.goto(
    `/workspace/${encodeURIComponent(ids.enterpriseWorkspaceId)}/settings/access-control`
  )
  let accessControl = await expectAccessControlReady(page)
  await page.getByRole('button', { name: 'Create group' }).click()
  const createModal = page.getByRole('dialog', { name: 'Create Permission Group' })
  await createModal.getByRole('textbox', { name: 'Name' }).fill(groupName)
  await createModal.getByRole('textbox', { name: 'Description (optional)' }).fill('Step 6 workflow')
  await createModal.getByRole('button', { name: 'Select workspaces…' }).click()
  await page.getByRole('menuitem', { name: workspaceName, exact: true }).click()
  await page.keyboard.press('Escape')

  const createResponse = waitForSameOriginResponse(
    page,
    'POST',
    `/api/organizations/${ids.enterpriseOrganizationId}/permission-groups`
  )
  await createModal.getByRole('button', { name: 'Create', exact: true }).click()
  expect((await createResponse).status()).toBe(201)

  const created = (
    await listPermissionGroups(adminContext.request, ids.enterpriseOrganizationId)
  ).find(({ name }) => name === groupName)
  expect(created).toMatchObject({
    name: groupName,
    memberCount: 0,
    isDefault: false,
    workspaces: [expect.objectContaining({ id: ids.enterpriseWorkspaceId })],
  })
  if (!created) throw new Error('Unable to recover created permission group')

  await accessControl.getByRole('button', { name: `Open permission group ${groupName}` }).click()
  accessControl = await expectAccessControlReady(page)
  const membersSection = accessControl.getByRole('region', { name: 'Members', exact: true })
  await membersSection.getByRole('button', { name: 'Add', exact: true }).click()
  const addMembersModal = page.getByRole('dialog', { name: 'Add Members' })
  await addMembersModal.getByRole('textbox', { name: 'Search members...' }).fill(target.email)
  await addMembersModal.getByRole('button', { name: new RegExp(target.email, 'i') }).click()

  const addMemberResponse = waitForSameOriginResponse(
    page,
    'POST',
    `/api/organizations/${ids.enterpriseOrganizationId}/permission-groups/${created.id}/members/bulk`
  )
  await addMembersModal.getByRole('button', { name: 'Add Members' }).click()
  expect((await addMemberResponse).status()).toBe(200)
  await expect(membersSection.getByRole('group', { name: target.email })).toBeVisible()

  await accessControl.getByRole('radio', { name: 'Platform' }).click()
  for (const label of ['Secrets', 'API Keys', 'Sim Mailer', 'MCP Tools', 'Custom Tools']) {
    const checkbox = accessControl.getByRole('checkbox', { name: label, exact: true })
    await expect(checkbox).toBeChecked()
    await checkbox.click()
    await expect(checkbox).not.toBeChecked()
  }

  const saveResponse = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${ids.enterpriseOrganizationId}/permission-groups/${created.id}`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await saveResponse).status()).toBe(200)

  const persisted = (
    await listPermissionGroups(adminContext.request, ids.enterpriseOrganizationId)
  ).find(({ id }) => id === created.id)
  expect(persisted?.memberCount).toBe(1)
  expect(persisted?.config).toMatchObject({
    hideSecretsTab: true,
    hideApiKeysTab: true,
    hideInboxTab: true,
    disableMcpTools: true,
    disableCustomTools: true,
  })
  expect(
    (await listPermissionGroups(adminContext.request, ids.enterpriseOrganizationId)).find(
      ({ id }) => id === seededGroupId
    )
  ).toEqual(seededGroupBefore)

  await expectUnrestrictedWorkspace(adminContext, ids.enterpriseWorkspaceId, 'organization-admin')
  const restrictedTargetContext = await contextForPersona('enterpriseWorkflowMember')
  await expectRestrictedWorkspace(restrictedTargetContext, ids.enterpriseWorkspaceId, created.id)

  await page.bringToFront()
  const deleteResponse = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/organizations/${ids.enterpriseOrganizationId}/permission-groups/${created.id}`
  )
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete Permission Group' })
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  expect((await deleteResponse).status()).toBe(200)
  expect(
    (await listPermissionGroups(adminContext.request, ids.enterpriseOrganizationId)).some(
      ({ id }) => id === created.id
    )
  ).toBe(false)

  const restoredTargetContext = await contextForPersona('enterpriseWorkflowMember')
  await expectUnrestrictedWorkspace(restoredTargetContext, ids.enterpriseWorkspaceId, 'read')
})
