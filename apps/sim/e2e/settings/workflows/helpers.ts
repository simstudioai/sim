import { randomUUID } from 'node:crypto'
import type { APIRequestContext, BrowserContext, Locator, Page, Response } from '@playwright/test'
import { z } from 'zod'
import {
  type OrganizationRoster,
  organizationRosterSchema,
  type RosterMember,
  type RosterPendingInvitation,
} from '@/lib/api/contracts/organization'
import type { ScenarioManifest } from '../../fixtures/e2e-world'
import { absoluteE2eUrl } from '../navigation/contract-resolver'
import { dynamicRestrictionCases } from './contracts'
import { expect } from './workflow-test'

const rosterEnvelopeSchema = z.object({
  success: z.boolean(),
  data: organizationRosterSchema,
})

const permissionGroupListSchema = z.object({
  permissionGroups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      memberCount: z.number(),
      isDefault: z.boolean(),
      workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
      config: z.record(z.string(), z.unknown()),
    })
  ),
})

export interface PrimaryWorldIds {
  teamOrganizationId: string
  enterpriseOrganizationId: string
  teamWorkspaceId: string
  teamInvitationWorkspaceId: string
  enterpriseWorkspaceId: string
}

export function primaryWorldIds(manifest: ScenarioManifest): PrimaryWorldIds {
  const world = manifest.worlds['settings-primary']
  if (!world) throw new Error('Missing settings-primary world')
  return {
    teamOrganizationId: required(world.organizationIds, 'team-organization', 'organization'),
    enterpriseOrganizationId: required(
      world.organizationIds,
      'enterprise-organization',
      'organization'
    ),
    teamWorkspaceId: required(world.workspaceIds, 'team-workspace', 'workspace'),
    teamInvitationWorkspaceId: required(
      world.workspaceIds,
      'team-invitation-workspace',
      'workspace'
    ),
    enterpriseWorkspaceId: required(world.workspaceIds, 'enterprise-workspace', 'workspace'),
  }
}

export function uniqueWorkflowEmail(label: string): string {
  return `e2e-${label}-${randomUUID()}@example.com`
}

export function uniqueWorkflowName(label: string): string {
  return `e2e-${label}-${randomUUID()}`
}

export async function newPersonaPage(
  contextForPersona: (personaKey: string) => Promise<BrowserContext>,
  personaKey: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await contextForPersona(personaKey)
  const page = await context.newPage()
  const response = await page.goto(absoluteE2eUrl('/account/settings/general'))
  if (!response?.ok()) throw new Error(`Unable to initialize workflow origin for ${personaKey}`)
  return { context, page }
}

export async function expectTeammatesReady(page: Page): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Workspace teammates' })
  await expect(region).toHaveAttribute('aria-busy', 'false')
  await expect(region).toHaveAttribute('data-teammates-state', 'ready')
  return region
}

export async function expectOrganizationMembersReady(page: Page): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Organization members' })
  await expect(region).toHaveAttribute('aria-busy', 'false')
  await expect(region).toHaveAttribute('data-members-state', 'ready')
  return region
}

export async function expectAccessControlReady(page: Page): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Access control' })
  await expect(region).toHaveAttribute('aria-busy', 'false')
  await expect(region).toHaveAttribute('data-access-control-state', 'ready')
  return region
}

export function waitForSameOriginResponse(
  page: Page,
  method: string,
  pathname: string
): Promise<Response> {
  const origin = new URL(absoluteE2eUrl('/')).origin
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.origin === origin && url.pathname === pathname && response.request().method() === method
    )
  })
}

export async function enterEmail(modal: Locator, email: string): Promise<void> {
  const input = modal.getByRole('textbox', { name: 'Emails' })
  await input.fill(email)
  await input.press('Enter')
  await expect(modal.getByText(email, { exact: true })).toBeVisible()
}

export async function selectDropdownOption(
  scope: Locator,
  currentLabel: string,
  nextLabel: string
): Promise<void> {
  await scope.getByRole('button', { name: currentLabel, exact: true }).click()
  await scope.page().getByRole('menuitem', { name: nextLabel, exact: true }).click()
}

export async function getOrganizationRoster(
  request: APIRequestContext,
  organizationId: string
): Promise<OrganizationRoster> {
  const response = await request.get(
    `/api/organizations/${encodeURIComponent(organizationId)}/roster`
  )
  expect(response.status()).toBe(200)
  return rosterEnvelopeSchema.parse(await response.json()).data
}

export function findRosterInvitation(
  roster: OrganizationRoster,
  email: string
): RosterPendingInvitation | undefined {
  return roster.pendingInvitations.find(
    (invitation) => invitation.email.toLowerCase() === email.toLowerCase()
  )
}

export function findRosterMember(
  roster: OrganizationRoster,
  email: string
): RosterMember | undefined {
  return roster.members.find((member) => member.email.toLowerCase() === email.toLowerCase())
}

export async function deleteInvitationByEmail(
  request: APIRequestContext,
  organizationId: string,
  email: string
): Promise<void> {
  let roster = await getOrganizationRoster(request, organizationId)
  for (const invitation of roster.pendingInvitations.filter(
    (candidate) => candidate.email.toLowerCase() === email.toLowerCase()
  )) {
    const response = await request.delete(`/api/invitations/${encodeURIComponent(invitation.id)}`)
    if (response.status() !== 200 && response.status() !== 404) {
      throw new Error(`Invitation cleanup failed with ${response.status()}`)
    }
  }
  roster = await getOrganizationRoster(request, organizationId)
  expect(findRosterInvitation(roster, email)).toBeUndefined()
}

export async function listPermissionGroups(
  request: APIRequestContext,
  organizationId: string
): Promise<z.infer<typeof permissionGroupListSchema>['permissionGroups']> {
  const response = await request.get(
    `/api/organizations/${encodeURIComponent(organizationId)}/permission-groups`
  )
  expect(response.status()).toBe(200)
  return permissionGroupListSchema.parse(await response.json()).permissionGroups
}

export async function deletePermissionGroupByName(
  request: APIRequestContext,
  organizationId: string,
  name: string
): Promise<void> {
  const matches = (await listPermissionGroups(request, organizationId)).filter(
    (group) => group.name === name
  )
  for (const group of matches) {
    const response = await request.delete(
      `/api/organizations/${encodeURIComponent(organizationId)}/permission-groups/${encodeURIComponent(group.id)}`
    )
    if (response.status() !== 200 && response.status() !== 404) {
      throw new Error(`Permission-group cleanup failed with ${response.status()}`)
    }
  }
  expect(
    (await listPermissionGroups(request, organizationId)).some((group) => group.name === name)
  ).toBe(false)
}

export async function restoreTeamWorkflowMember(options: {
  adminRequest: APIRequestContext
  targetRequest: APIRequestContext
  organizationId: string
  anchorWorkspaceId: string
  invitationWorkspaceId: string
  targetUserId: string
  targetEmail: string
}): Promise<void> {
  const {
    adminRequest,
    targetRequest,
    organizationId,
    anchorWorkspaceId,
    invitationWorkspaceId,
    targetUserId,
    targetEmail,
  } = options

  await deleteInvitationByEmail(adminRequest, organizationId, targetEmail)
  let roster = await getOrganizationRoster(adminRequest, organizationId)
  let target = findRosterMember(roster, targetEmail)

  if (!target) {
    const invite = await adminRequest.post(
      `/api/organizations/${encodeURIComponent(organizationId)}/invitations`,
      { data: { email: targetEmail, role: 'member' } }
    )
    expect(invite.status()).toBe(200)
    roster = await getOrganizationRoster(adminRequest, organizationId)
    const invitation = findRosterInvitation(roster, targetEmail)
    if (!invitation) throw new Error('Unable to recover restoration invitation')
    const accepted = await targetRequest.post(
      `/api/invitations/${encodeURIComponent(invitation.id)}/accept`,
      { data: {} }
    )
    expect(accepted.status()).toBe(200)
    roster = await getOrganizationRoster(adminRequest, organizationId)
    target = findRosterMember(roster, targetEmail)
  }
  if (!target) throw new Error('Unable to restore workflow organization member')

  if (target.role !== 'member') {
    const demoted = await adminRequest.put(
      `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(
        targetUserId
      )}`,
      { data: { role: 'member' } }
    )
    expect(demoted.status()).toBe(200)
  }

  roster = await getOrganizationRoster(adminRequest, organizationId)
  target = findRosterMember(roster, targetEmail)
  if (target?.workspaces.some(({ workspaceId }) => workspaceId === invitationWorkspaceId)) {
    const removed = await adminRequest.delete(
      `/api/workspaces/members/${encodeURIComponent(targetUserId)}`,
      { data: { workspaceId: invitationWorkspaceId } }
    )
    expect(removed.status()).toBe(200)
  }

  roster = await getOrganizationRoster(adminRequest, organizationId)
  target = findRosterMember(roster, targetEmail)
  const anchor = target?.workspaces.find(({ workspaceId }) => workspaceId === anchorWorkspaceId)
  if (!anchor) {
    const granted = await adminRequest.post('/api/workspaces/invitations/batch', {
      data: {
        workspaceId: anchorWorkspaceId,
        invitations: [{ email: targetEmail, permission: 'read' }],
      },
    })
    expect(granted.status()).toBe(200)
  } else if (anchor.permission !== 'read') {
    const normalized = await adminRequest.patch(
      `/api/workspaces/${encodeURIComponent(anchorWorkspaceId)}/permissions`,
      { data: { updates: [{ userId: targetUserId, permissions: 'read' }] } }
    )
    expect(normalized.status()).toBe(200)
  }

  await setActiveOrganization(targetRequest, organizationId)
  await expectTeamWorkflowMemberBaseline({
    adminRequest,
    targetRequest,
    organizationId,
    anchorWorkspaceId,
    invitationWorkspaceId,
    targetEmail,
  })
}

export async function expectTeamWorkflowMemberBaseline(options: {
  adminRequest: APIRequestContext
  targetRequest: APIRequestContext
  organizationId: string
  anchorWorkspaceId: string
  invitationWorkspaceId: string
  targetEmail: string
}): Promise<void> {
  const {
    adminRequest,
    targetRequest,
    organizationId,
    anchorWorkspaceId,
    invitationWorkspaceId,
    targetEmail,
  } = options
  const roster = await getOrganizationRoster(adminRequest, organizationId)
  const target = findRosterMember(roster, targetEmail)
  expect(target?.role).toBe('member')
  expect(target?.workspaces).toEqual([
    expect.objectContaining({ workspaceId: anchorWorkspaceId, permission: 'read' }),
  ])
  expect(target?.workspaces.some(({ workspaceId }) => workspaceId === invitationWorkspaceId)).toBe(
    false
  )
  expect(findRosterInvitation(roster, targetEmail)).toBeUndefined()
  expect(roster.members.filter(({ role }) => role !== 'external')).toHaveLength(5)
  expect(roster.pendingInvitations).toHaveLength(1)
  expect(roster.pendingInvitations[0]).toMatchObject({
    kind: 'organization',
    membershipIntent: 'internal',
  })

  const billingResponse = await adminRequest.get(
    `/api/billing?context=organization&id=${encodeURIComponent(organizationId)}`
  )
  expect(billingResponse.status()).toBe(200)
  const billing = (await billingResponse.json()) as {
    data?: { totalSeats?: number; usedSeats?: number; members?: unknown[] }
  }
  expect(billing.data).toMatchObject({ totalSeats: 5, usedSeats: 6 })
  expect(billing.data?.members).toHaveLength(5)

  const sessionResponse = await targetRequest.get('/api/auth/get-session?disableCookieCache=true')
  expect(sessionResponse.status()).toBe(200)
  const session = (await sessionResponse.json()) as {
    session?: { activeOrganizationId?: string | null }
  }
  expect(session.session?.activeOrganizationId ?? null).toBe(organizationId)
}

export async function setActiveOrganization(
  request: APIRequestContext,
  organizationId: string
): Promise<void> {
  const currentSession = await request.get('/api/auth/get-session?disableCookieCache=true')
  expect(currentSession.status()).toBe(200)
  const current = (await currentSession.json()) as {
    session?: { activeOrganizationId?: string | null }
  }
  if ((current.session?.activeOrganizationId ?? null) === organizationId) return

  const response = await request.post('/api/auth/organization/set-active', {
    data: { organizationId },
    headers: { origin: new URL(absoluteE2eUrl('/')).origin },
  })
  expect(response.status()).toBe(200)
  const session = await request.get('/api/auth/get-session?disableCookieCache=true')
  expect(session.status()).toBe(200)
}

export async function expectRestrictedWorkspace(
  context: BrowserContext,
  workspaceId: string,
  expectedGroupId: string
): Promise<void> {
  const configResponse = await context.request.get(
    `/api/permission-groups/user?workspaceId=${encodeURIComponent(workspaceId)}`
  )
  expect(configResponse.status()).toBe(200)
  const config = (await configResponse.json()) as {
    permissionGroupId?: string | null
    config?: Record<string, unknown> | null
  }
  expect(config.permissionGroupId).toBe(expectedGroupId)
  for (const restriction of dynamicRestrictionCases) {
    expect(config.config?.[restriction.flag]).toBe(true)
  }

  const page = await context.newPage()
  await page.goto(absoluteE2eUrl(`/workspace/${encodeURIComponent(workspaceId)}/settings/general`))
  const navigation = page
    .getByRole('complementary', { name: 'Workspace sidebar' })
    .getByRole('navigation', { name: 'Workspace settings sections' })
  await expect(navigation).toHaveAttribute('aria-busy', 'false')
  for (const restriction of dynamicRestrictionCases) {
    await expect(
      navigation.getByRole('button', { name: restriction.label, exact: true })
    ).toHaveCount(0)
    const response = await page.goto(
      absoluteE2eUrl(
        `/workspace/${encodeURIComponent(workspaceId)}/settings/${restriction.sectionId}`
      )
    )
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  }
}

export async function expectUnrestrictedWorkspace(
  context: BrowserContext,
  workspaceId: string,
  authority: 'read' | 'organization-admin'
): Promise<void> {
  const configResponse = await context.request.get(
    `/api/permission-groups/user?workspaceId=${encodeURIComponent(workspaceId)}`
  )
  expect(configResponse.status()).toBe(200)
  const config = (await configResponse.json()) as {
    permissionGroupId?: string | null
    config?: Record<string, unknown> | null
  }
  expect(config.permissionGroupId ?? null).toBeNull()
  expect(config.config ?? null).toBeNull()

  const page = await context.newPage()
  await page.goto(absoluteE2eUrl(`/workspace/${encodeURIComponent(workspaceId)}/settings/general`))
  const navigation = page
    .getByRole('complementary', { name: 'Workspace sidebar' })
    .getByRole('navigation', { name: 'Workspace settings sections' })
  await expect(navigation).toHaveAttribute('aria-busy', 'false')
  for (const restriction of dynamicRestrictionCases) {
    await expect(
      navigation.getByRole('button', { name: restriction.label, exact: true })
    ).toBeVisible()
  }

  for (const restriction of dynamicRestrictionCases) {
    const apiResponses: Array<Promise<Response>> = []
    if (restriction.sectionId === 'secrets') {
      apiResponses.push(
        waitForSameOriginResponse(page, 'GET', '/api/environment'),
        waitForSameOriginResponse(
          page,
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/environment`
        )
      )
    } else if (restriction.sectionId === 'mcp') {
      apiResponses.push(waitForSameOriginResponse(page, 'GET', '/api/mcp/servers'))
    } else if (restriction.sectionId === 'custom-tools') {
      apiResponses.push(waitForSameOriginResponse(page, 'GET', '/api/tools/custom'))
    } else if (restriction.sectionId === 'inbox') {
      apiResponses.push(
        waitForSameOriginResponse(
          page,
          'GET',
          `/api/workspaces/${encodeURIComponent(workspaceId)}/inbox`
        )
      )
    }

    const documentResponse = await page.goto(
      absoluteE2eUrl(
        `/workspace/${encodeURIComponent(workspaceId)}/settings/${restriction.sectionId}`
      )
    )
    expect(documentResponse?.status()).toBe(200)
    const resolvedApiResponses = await Promise.all(apiResponses)
    for (const apiResponse of resolvedApiResponses) expect(apiResponse.status()).toBe(200)

    if (restriction.sectionId === 'secrets') {
      await expect(page.getByRole('region', { name: 'Workspace' })).toBeVisible()
    } else if (restriction.sectionId === 'apikeys') {
      const region = page.getByRole('region', { name: 'API keys data' })
      await expect(region).toHaveAttribute('data-api-keys-state', 'ready')
      const createButton = page.getByRole('button', { name: 'Create API key', exact: true })
      await expect(createButton).toBeEnabled()
      await createButton.click()
      const dialog = page.getByRole('dialog', { name: 'Create new API key' })
      await expect(dialog.getByPlaceholder('e.g., Development, Production')).toBeVisible()
      const workspaceType = dialog.getByRole('radio', { name: 'Workspace', exact: true })
      const personalType = dialog.getByRole('radio', { name: 'Personal', exact: true })
      if (authority === 'read') {
        await expect(workspaceType).toHaveCount(0)
        await expect(personalType).toHaveCount(0)
      } else {
        await expect(workspaceType).toBeVisible()
        await expect(personalType).toBeVisible()
      }
      await page.keyboard.press('Escape')
    } else if (restriction.sectionId === 'mcp') {
      await expect(
        page.getByText(
          authority === 'read'
            ? 'No MCP servers configured'
            : 'Click "Add server" above to get started',
          { exact: true }
        )
      ).toBeVisible()
    } else if (restriction.sectionId === 'custom-tools') {
      await expect(
        page.getByText(
          authority === 'read'
            ? 'No custom tools configured'
            : 'Click "Add tool" above to get started',
          { exact: true }
        )
      ).toBeVisible()
    } else {
      const config = (await resolvedApiResponses[0].json()) as {
        entitled?: boolean
        enabled?: boolean
      }
      expect(config).toMatchObject({ entitled: true, enabled: false })
      await expect(page.getByRole('heading', { name: 'Sim mailer' })).toBeVisible()
      await expect(page.getByText('Sim Mailer requires an active Max plan')).toHaveCount(0)
    }
  }
}

function required(values: Record<string, string>, key: string, label: string): string {
  const value = values[key]
  if (!value) throw new Error(`Missing ${label} binding: ${key}`)
  return value
}
