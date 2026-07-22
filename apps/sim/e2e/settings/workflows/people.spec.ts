import type { Locator } from '@playwright/test'
import {
  deleteInvitationByEmail,
  enterEmail,
  expectOrganizationMembersReady,
  expectTeammatesReady,
  expectTeamWorkflowMemberBaseline,
  findRosterInvitation,
  findRosterMember,
  getOrganizationRoster,
  newPersonaPage,
  primaryWorldIds,
  restoreTeamWorkflowMember,
  selectDropdownOption,
  uniqueWorkflowEmail,
  waitForSameOriginResponse,
} from './helpers'
import { expect, test } from './workflow-test'

test('workspace invitation can be sent as Read and revoked without exposing its token', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const workspaceName =
    personaManifest.worlds['settings-primary'].workspaceIdentities['team-invitation-workspace'].name
  const email = uniqueWorkflowEmail('workspace-invite')
  const { context, page } = await newPersonaPage(contextForPersona, 'paidOrganizationOwner')

  registerCleanup('remove workspace invitation', () =>
    deleteInvitationByEmail(context.request, ids.teamOrganizationId, email)
  )

  await page.goto(
    `/workspace/${encodeURIComponent(ids.teamInvitationWorkspaceId)}/settings/teammates`
  )
  const teammates = await expectTeammatesReady(page)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const modal = page.getByRole('dialog', { name: `Invite teammates to ${workspaceName}` })
  await enterEmail(modal, email)
  await selectDropdownOption(modal, 'Admin', 'Read')

  const sendResponse = waitForSameOriginResponse(page, 'POST', '/api/workspaces/invitations/batch')
  await modal.getByRole('button', { name: 'Send invites' }).click()
  expect((await sendResponse).status()).toBe(200)

  const invitation = findRosterInvitation(
    await getOrganizationRoster(context.request, ids.teamOrganizationId),
    email
  )
  expect(invitation).toMatchObject({
    email,
    kind: 'workspace',
    membershipIntent: 'internal',
    role: 'member',
    workspaces: [
      expect.objectContaining({
        workspaceId: ids.teamInvitationWorkspaceId,
        permission: 'read',
      }),
    ],
  })

  const row = teammates
    .getByRole('region', { name: 'Teammates' })
    .getByRole('group', { name: email })
  await expect(row.getByText('Invite pending')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Read', exact: true })).toBeDisabled()

  if (!invitation) throw new Error('Workspace invitation was not recoverable from safe roster')
  await row.getByRole('button', { name: 'Teammate actions' }).click()
  const revokeResponse = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/invitations/${invitation.id}`
  )
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click()
  expect((await revokeResponse).status()).toBe(200)
  await expect(row).toHaveCount(0)
  expect(
    findRosterInvitation(
      await getOrganizationRoster(context.request, ids.teamOrganizationId),
      email
    )
  ).toBeUndefined()
})

test('organization invitation roles and workspace grants can be changed then revoked', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const workspaceName =
    personaManifest.worlds['settings-primary'].workspaceIdentities['team-invitation-workspace'].name
  const email = uniqueWorkflowEmail('organization-invite')
  const { context, page } = await newPersonaPage(contextForPersona, 'paidOrganizationOwner')

  registerCleanup('remove organization invitation', () =>
    deleteInvitationByEmail(context.request, ids.teamOrganizationId, email)
  )

  await page.goto(`/workspace/${encodeURIComponent(ids.teamWorkspaceId)}/settings/organization`)
  const membersRegion = await expectOrganizationMembersReady(page)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Invite teammates to organization' })
  await enterEmail(modal, email)
  await modal.getByRole('button', { name: 'Select workspaces', exact: true }).click()
  await page.getByRole('menuitem', { name: workspaceName, exact: true }).click()
  await page.keyboard.press('Escape')

  const sendResponse = waitForSameOriginResponse(
    page,
    'POST',
    `/api/organizations/${ids.teamOrganizationId}/invitations`
  )
  await modal.getByRole('button', { name: 'Send invites' }).click()
  expect((await sendResponse).status()).toBe(200)

  const invitation = findRosterInvitation(
    await getOrganizationRoster(context.request, ids.teamOrganizationId),
    email
  )
  expect(invitation).toMatchObject({
    kind: 'organization',
    membershipIntent: 'internal',
    role: 'member',
    workspaces: [
      expect.objectContaining({
        workspaceId: ids.teamInvitationWorkspaceId,
        permission: 'write',
      }),
    ],
  })
  if (!invitation) throw new Error('Organization invitation was not recoverable from safe roster')

  const memberRow = memberRowInSection(membersRegion, 'Members', email)
  const roleResponse = waitForSameOriginResponse(page, 'PATCH', `/api/invitations/${invitation.id}`)
  await selectDropdownOption(memberRow, 'Member', 'Admin')
  expect((await roleResponse).status()).toBe(200)
  await expect(memberRow.getByRole('button', { name: 'Admin', exact: true })).toBeVisible()

  const workspaceRow = memberRowInSection(membersRegion, workspaceName, email)
  const grantResponse = waitForSameOriginResponse(
    page,
    'PATCH',
    `/api/invitations/${invitation.id}`
  )
  await selectDropdownOption(workspaceRow, 'Write', 'Read')
  expect((await grantResponse).status()).toBe(200)
  await expect(workspaceRow.getByRole('button', { name: 'Read', exact: true })).toBeVisible()

  const updated = findRosterInvitation(
    await getOrganizationRoster(context.request, ids.teamOrganizationId),
    email
  )
  expect(updated).toMatchObject({
    role: 'admin',
    workspaces: [
      expect.objectContaining({
        workspaceId: ids.teamInvitationWorkspaceId,
        permission: 'read',
      }),
    ],
  })

  await memberRow.getByRole('button', { name: 'Member actions' }).click()
  const revokeResponse = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/invitations/${invitation.id}`
  )
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click()
  expect((await revokeResponse).status()).toBe(200)
  await expect(memberRow).toHaveCount(0)
})

test('existing member workspace and organization lifecycle restores its exact baseline', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const targetPersona = personaManifest.personas.teamWorkflowMember
  const invitationWorkspaceName =
    personaManifest.worlds['settings-primary'].workspaceIdentities['team-invitation-workspace'].name
  const anchorWorkspaceName =
    personaManifest.worlds['settings-primary'].workspaceIdentities['team-workspace'].name
  const { context: adminContext, page } = await newPersonaPage(
    contextForPersona,
    'paidOrganizationOwner'
  )
  const { context: targetContext } = await newPersonaPage(contextForPersona, 'teamWorkflowMember')

  const restore = () =>
    restoreTeamWorkflowMember({
      adminRequest: adminContext.request,
      targetRequest: targetContext.request,
      organizationId: ids.teamOrganizationId,
      anchorWorkspaceId: ids.teamWorkspaceId,
      invitationWorkspaceId: ids.teamInvitationWorkspaceId,
      targetUserId: targetPersona.userId,
      targetEmail: targetPersona.email,
    })
  registerCleanup('restore team workflow member', restore)
  await restore()

  await page.goto(
    `/workspace/${encodeURIComponent(ids.teamInvitationWorkspaceId)}/settings/teammates`
  )
  const teammates = await expectTeammatesReady(page)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const inviteModal = page.getByRole('dialog', {
    name: `Invite teammates to ${invitationWorkspaceName}`,
  })
  await enterEmail(inviteModal, targetPersona.email)
  await selectDropdownOption(inviteModal, 'Admin', 'Read')
  const directAddResponse = waitForSameOriginResponse(
    page,
    'POST',
    '/api/workspaces/invitations/batch'
  )
  await inviteModal.getByRole('button', { name: 'Send invites' }).click()
  const directAdd = await directAddResponse
  expect(directAdd.status()).toBe(200)
  const directAddBody = (await directAdd.json()) as {
    added?: string[]
    successful?: string[]
    invitations?: Array<Record<string, unknown>>
  }
  expect(directAddBody.added).toEqual([targetPersona.email])
  expect(directAddBody.successful).toEqual([])
  expect(directAddBody.invitations).toEqual([
    expect.objectContaining({
      email: targetPersona.email,
      workspaceId: ids.teamInvitationWorkspaceId,
      permission: 'read',
      outcome: 'added',
      instantAdd: true,
    }),
  ])
  expect(directAddBody.invitations?.some((invitation) => 'token' in invitation)).toBe(false)

  const row = teammates
    .getByRole('region', { name: 'Teammates' })
    .getByRole('group', { name: targetPersona.email })
  await expect(row.getByRole('button', { name: 'Read', exact: true })).toBeVisible()

  const roleResponse = waitForSameOriginResponse(
    page,
    'PATCH',
    `/api/workspaces/${ids.teamInvitationWorkspaceId}/permissions`
  )
  await selectDropdownOption(row, 'Read', 'Write')
  expect((await roleResponse).status()).toBe(200)
  await expect(row.getByRole('button', { name: 'Write', exact: true })).toBeVisible()

  await row.getByRole('button', { name: 'Teammate actions' }).click()
  const removeGrantResponse = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/workspaces/members/${targetPersona.userId}`
  )
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
  expect((await removeGrantResponse).status()).toBe(200)
  await expect(row).toHaveCount(0)

  await page.goto(`/workspace/${encodeURIComponent(ids.teamWorkspaceId)}/settings/organization`)
  let membersRegion = await expectOrganizationMembersReady(page)
  let memberRow = memberRowInSection(membersRegion, 'Members', targetPersona.email)
  const promoteResponse = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${ids.teamOrganizationId}/members/${targetPersona.userId}`
  )
  await selectDropdownOption(memberRow, 'Member', 'Admin')
  expect((await promoteResponse).status()).toBe(200)

  await page.reload()
  membersRegion = await expectOrganizationMembersReady(page)
  memberRow = memberRowInSection(membersRegion, 'Members', targetPersona.email)
  await expect(memberRow.getByRole('button', { name: 'Admin', exact: true })).toBeVisible()
  await expect(
    memberRowInSection(membersRegion, anchorWorkspaceName, targetPersona.email).getByRole(
      'button',
      {
        name: 'Admin',
        exact: true,
      }
    )
  ).toBeDisabled()
  await expect(
    memberRowInSection(membersRegion, invitationWorkspaceName, targetPersona.email).getByRole(
      'button',
      { name: 'Admin', exact: true }
    )
  ).toBeDisabled()

  const demoteResponse = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/organizations/${ids.teamOrganizationId}/members/${targetPersona.userId}`
  )
  await selectDropdownOption(memberRow, 'Admin', 'Member')
  expect((await demoteResponse).status()).toBe(200)
  await page.reload()
  membersRegion = await expectOrganizationMembersReady(page)
  await expect(
    memberRowInSection(membersRegion, anchorWorkspaceName, targetPersona.email).getByRole(
      'button',
      {
        name: 'Read',
        exact: true,
      }
    )
  ).toBeVisible()
  await expect(
    membersRegion
      .getByRole('region', { name: invitationWorkspaceName })
      .getByRole('group', { name: targetPersona.email })
  ).toHaveCount(0)

  memberRow = memberRowInSection(membersRegion, 'Members', targetPersona.email)
  await memberRow.getByRole('button', { name: 'Member actions' }).click()
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Remove Team Member' })
  const removeMemberResponse = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/organizations/${ids.teamOrganizationId}/members/${targetPersona.userId}`
  )
  await confirmation.getByRole('button', { name: 'Remove', exact: true }).click()
  expect((await removeMemberResponse).status()).toBe(200)

  const removedRoster = await getOrganizationRoster(adminContext.request, ids.teamOrganizationId)
  expect(findRosterMember(removedRoster, targetPersona.email)).toBeUndefined()
  expect(findRosterInvitation(removedRoster, targetPersona.email)).toBeUndefined()

  await restore()
  await expectTeamWorkflowMemberBaseline({
    adminRequest: adminContext.request,
    targetRequest: targetContext.request,
    organizationId: ids.teamOrganizationId,
    anchorWorkspaceId: ids.teamWorkspaceId,
    invitationWorkspaceId: ids.teamInvitationWorkspaceId,
    targetEmail: targetPersona.email,
  })
})

function memberRowInSection(membersRegion: Locator, sectionName: string, email: string): Locator {
  return membersRegion
    .getByRole('region', { name: sectionName, exact: true })
    .getByRole('group', { name: email, exact: true })
}
