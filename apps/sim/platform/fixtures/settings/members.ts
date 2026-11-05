import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { fixtureSeats } from '@/platform/fixtures/settings/billing'
import { settingsWorkspaces } from '@/platform/fixtures/settings/organization'
import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'
import type { SettingsRoster } from '@/platform/lib/data/members'

type Member = SettingsRoster['members'][number]
type Access = Member['workspaces'][number]
type Invitation = SettingsRoster['pendingInvitations'][number]

const JOINED = '2026-10-01T09:00:00Z'
const EXPIRES = '2026-11-15T09:00:00Z'

function access(
  workspace: SettingsRoster['workspaces'][number],
  permission: Access['permission'],
  roleSource: Access['roleSource'] = 'explicit'
): Access {
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    permission,
    roleSource,
    isBilledAccount: roleSource === 'owner',
  }
}

function makeInvitation(email: string, role: string): Invitation {
  return {
    id: generateId(),
    email,
    role,
    kind: 'organization',
    membershipIntent: 'internal',
    createdAt: JOINED,
    expiresAt: EXPIRES,
    inviteeName: null,
    inviteeImage: null,
    workspaces: [],
  }
}

function createRoster(state: SettingsFixtureState): SettingsRoster {
  const { profile } = state.general
  const [operations, finance] = settingsWorkspaces
  const members: Member[] = []
  function add(
    id: string,
    name: string,
    email: string,
    role: Member['role'],
    workspaces: Access[],
    suspended = false
  ) {
    members.push({
      memberId: id,
      userId: id,
      name,
      email,
      role,
      workspaces,
      createdAt: JOINED,
      image: null,
      suspendedAt: suspended ? JOINED : null,
    })
  }
  add(
    profile.id,
    profile.name,
    profile.email,
    'owner',
    settingsWorkspaces.map((workspace) => access(workspace, 'admin', 'owner'))
  )
  const pendingInvitations: Invitation[] = []
  if (state.scenario !== 'empty') {
    add('jo', 'Jo Bell', 'jo@example.test', 'member', [
      access(operations, 'write'),
      access(finance, 'read'),
    ])
    add(
      'mina',
      'Mina Kim',
      'mina@example.test',
      'admin',
      settingsWorkspaces.map((workspace) => access(workspace, 'admin', 'org-admin'))
    )
    add('alex', 'Alex Rowan', 'alex@example.test', 'external', [access(operations, 'read')])
    add('remy', 'Remy Chen', 'remy@example.test', 'member', [access(finance, 'write')], true)
    const pending = makeInvitation('nina@example.test', 'member')
    pendingInvitations.push(pending, {
      ...makeInvitation('partner@example.test', 'member'),
      kind: 'workspace',
      membershipIntent: 'external',
      workspaces: [access(operations, 'read')],
    })
  }
  if (state.scenario === 'stress') {
    for (let index = members.length; index < 178; index++) {
      add(
        `member-${index}`,
        `Customer operations and research member ${index}`,
        `customer-operations-${index}@example.test`,
        'member',
        [access(settingsWorkspaces[index % settingsWorkspaces.length], 'write')]
      )
    }
  }
  return { members, pendingInvitations, workspaces: settingsWorkspaces }
}

function getRoster(state: SettingsFixtureState): SettingsRoster {
  const existing = state.records.get('members/roster') as SettingsRoster | undefined
  if (existing) return existing
  const roster = createRoster(state)
  state.records.set('members/roster', roster)
  return roster
}

export function settingsMembers(state: SettingsFixtureState) {
  return getRoster(state).members.map((member) => ({
    id: member.userId,
    name: member.name,
    email: member.email,
  }))
}

async function invitationsFixture(request: Request, path: string, roster: SettingsRoster) {
  if (path === '/api/workspaces/invitations/batch' && request.method === 'POST') {
    const body = toRecord(await request.json())
    const emails = Array.isArray(body.emails)
      ? body.emails.filter((email): email is string => typeof email === 'string')
      : []
    const successful: string[] = []
    const failed: { email: string; error: string }[] = []
    for (const email of emails) {
      if (
        roster.members.some((member) => member.email.toLowerCase() === email.toLowerCase()) ||
        roster.pendingInvitations.some(
          (invite) => invite.email.toLowerCase() === email.toLowerCase()
        )
      ) {
        failed.push({ email, error: 'This address is already a member or has an invitation.' })
      } else {
        roster.pendingInvitations.push(
          makeInvitation(email, body.membership === 'admin' ? 'admin' : 'member')
        )
        successful.push(email)
      }
    }
    return { success: !failed.length, successful, failed, added: [], invitations: [] }
  }
  const match = /^\/api\/invitations\/([^/]+)(\/resend)?$/.exec(path)
  if (!match) return
  const invite = roster.pendingInvitations.find((item) => item.id === match[1])
  if (!invite) return
  if (request.method === 'DELETE') {
    roster.pendingInvitations = roster.pendingInvitations.filter((item) => item !== invite)
    return { success: true, invitationCancelled: true }
  }
  if (match[2] && request.method === 'POST') return { success: true }
  if (request.method !== 'PATCH') return
  const body = toRecord(await request.json())
  if (typeof body.role === 'string') invite.role = body.role
  if (Array.isArray(body.grants)) {
    for (const input of body.grants) {
      const { workspaceId, permission } = toRecord(input)
      const grant = invite.workspaces.find((row) => row.workspaceId === workspaceId)
      if (grant && (permission === 'write' || permission === 'read' || permission === 'admin'))
        grant.permission = permission
    }
  }
  return { success: true }
}

export async function membersFixture(
  request: Request,
  path: string,
  state: SettingsFixtureState
): Promise<unknown> {
  const scope = `/api/organizations/${state.organizationId}`
  const roster = getRoster(state)
  if (path === `${scope}/roster`) return { success: true, data: roster }
  if (path === `${scope}/billing-plan`) {
    const { plan } = state
    const used = roster.members.filter((row) => row.role !== 'external').length
    const pending = roster.pendingInvitations.filter(
      (row) => row.membershipIntent !== 'external'
    ).length
    return {
      success: true,
      data: {
        organizationId: state.organizationId,
        subscriptionPlan: plan,
        subscriptionStatus: plan === 'free' ? null : 'active',
        totalSeats: fixtureSeats(state),
        usedSeats: used + pending,
        membersTotal: used,
        hasEnterprisePlan: plan === 'enterprise',
      },
    }
  }
  if (path === `${scope}/removal-impact`) {
    const userId = new URL(request.url).searchParams.get('userId')
    return {
      credentials:
        userId === 'jo'
          ? [
              {
                id: 'ops-mail',
                displayName: 'Gmail',
                type: 'oauth',
                workspaceId: settingsWorkspaces[0].id,
              },
            ]
          : [],
    }
  }
  if (path === `${scope}/transfer-ownership` && request.method === 'POST') {
    const { newOwnerUserId } = toRecord(await request.json())
    const selected = roster.members.find((row) => row.userId === newOwnerUserId)
    if (!selected) return
    selected.role = 'owner'
    roster.members = roster.members.filter((row) => row.userId !== state.general.profile.id)
    return { success: true, transferred: true, left: true }
  }
  if (path.startsWith(`${scope}/members/`)) {
    const [userId, action] = path.slice(`${scope}/members/`.length).split('/')
    const member = roster.members.find((row) => row.userId === userId)
    if (!member) return
    if (action === 'usage-limit') {
      if (request.method === 'PUT') {
        const { creditLimit } = toRecord(await request.json())
        state.records.set(path, creditLimit)
        return { success: true, data: { creditLimit } }
      }
      return {
        success: true,
        data: {
          creditLimit: state.records.get(path) ?? null,
          creditsUsed: 36,
          billingInterval: 'month',
        },
      }
    }
    if (request.method === 'DELETE') {
      roster.members = roster.members.filter((row) => row !== member)
      return { success: true }
    }
    if (request.method === 'PUT') {
      const { role } = toRecord(await request.json())
      if (role === 'member' || role === 'admin') {
        member.role = role
        for (const grant of member.workspaces) {
          if (grant.isBilledAccount) continue
          grant.roleSource = role === 'admin' ? 'org-admin' : 'explicit'
          if (role === 'admin') grant.permission = 'admin'
        }
      }
      return { success: true }
    }
  }
  if (path.startsWith('/api/workspaces/members/') && request.method === 'DELETE') {
    const { workspaceId } = toRecord(await request.json())
    const member = roster.members.find((row) => row.userId === path.split('/').at(-1))
    if (member)
      member.workspaces = member.workspaces.filter((grant) => grant.workspaceId !== workspaceId)
    return { success: true }
  }
  const match = /^\/api\/workspaces\/([^/]+)\/permissions$/.exec(path)
  if (match && request.method === 'PATCH') {
    const { updates } = toRecord(await request.json())
    if (Array.isArray(updates))
      for (const update of updates) {
        const { userId, permissions } = toRecord(update)
        const grant = roster.members
          .find((row) => row.userId === userId)
          ?.workspaces.find((item) => item.workspaceId === match[1])
        if (grant && (permissions === 'read' || permissions === 'write' || permissions === 'admin'))
          grant.permission = permissions
      }
    return { message: 'Workspace permissions updated' }
  }
  return invitationsFixture(request, path, roster)
}
