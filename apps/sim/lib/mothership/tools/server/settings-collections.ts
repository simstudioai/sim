import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'
import { settingsOrganizationId } from '@/lib/mothership/tools/server/settings-operation'
import { readOrganizationRoster } from '@/lib/organizations/application/member-roster'
import { listPermissionGroups } from '@/lib/permission-groups/application/management'

export const settingsPageSchema = z.strictObject({
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
})
export type SettingsPage = z.output<typeof settingsPageSchema>
export const initialSettingsPage: SettingsPage = { offset: 0, limit: 25 }
const label = (value: string | null | undefined) => value?.slice(0, 300) ?? null

/** Stable ordering makes every entry reachable without returning an unbounded model result. */
export function settingsPage<T>(rows: readonly T[], page: SettingsPage, key: (row: T) => string) {
  const ordered = [...rows].sort((a, b) => key(a).localeCompare(key(b)))
  const items = ordered.slice(page.offset, page.offset + page.limit)
  const nextOffset = page.offset + items.length < rows.length ? page.offset + items.length : null
  return {
    items,
    total: rows.length,
    offset: page.offset,
    limit: page.limit,
    truncated: page.offset > 0 || nextOffset !== null,
    nextOffset,
  }
}

type Roster = Awaited<ReturnType<typeof readOrganizationRoster.execute>>
export function projectSettingsRoster(roster: Roster, page = initialSettingsPage) {
  return {
    members: settingsPage(
      roster.members.map(({ workspaces, image: _image, ...member }) => ({
        ...member,
        name: label(member.name),
        email: label(member.email),
        workspaceCount: workspaces.length,
      })),
      page,
      (row) => row.userId
    ),
    pendingInvitations: settingsPage(
      roster.pendingInvitations.map(({ workspaces, inviteeImage: _image, ...invitation }) => ({
        ...invitation,
        email: label(invitation.email),
        inviteeName: label(invitation.inviteeName),
        workspaceCount: workspaces.length,
      })),
      page,
      (row) => row.id
    ),
    workspaces: settingsPage(
      roster.workspaces.map((row) => ({ id: row.id, name: label(row.name) })),
      page,
      (row) => row.id
    ),
    workspaceAccess:
      'Use list_member_workspaces or list_invitation_workspaces for paginated access details.',
  }
}
export async function readSettingsRoster(context: SettingsContext, page = initialSettingsPage) {
  return projectSettingsRoster(
    await readOrganizationRoster.execute({
      principal: context.principal,
      input: { organizationId: settingsOrganizationId(context) },
    }),
    page
  )
}
export async function readSettingsRosterAccess(
  context: SettingsContext,
  input: SettingsPage & { userId?: string; invitationId?: string }
) {
  const roster = await readOrganizationRoster.execute({
    principal: context.principal,
    input: { organizationId: settingsOrganizationId(context) },
  })
  const row = input.userId
    ? roster.members.find((row) => row.userId === input.userId)
    : roster.pendingInvitations.find((row) => row.id === input.invitationId)
  if (!row) throw new OrchestrationError('not_found', 'Member or invitation not found')
  return settingsPage(
    row.workspaces.map((row) => ({ ...row, workspaceName: label(row.workspaceName) })),
    input,
    (row) => row.workspaceId
  )
}
export function projectSettingsGroup<
  T extends {
    id: string
    name: string
    description?: string | null
    workspaces: readonly unknown[]
    config: unknown
  },
>(group: T) {
  const { workspaces, config: _config, ...metadata } = group
  return {
    ...metadata,
    name: label(group.name),
    description: label(group.description),
    workspaceCount: workspaces.length,
  }
}
export async function readSettingsGroups(context: SettingsContext, page = initialSettingsPage) {
  const result = await listPermissionGroups.execute({
    principal: context.principal,
    input: { organizationId: settingsOrganizationId(context) },
  })
  return settingsPage(result.permissionGroups.map(projectSettingsGroup), page, (row) => row.id)
}
export function projectSettingsWorkspace<T extends { id: string; name: string }>(row: T) {
  return { id: row.id, name: label(row.name) }
}
export function projectSettingsGroupMember<
  T extends {
    id: string
    userName: string | null
    userEmail: string | null
    userImage: string | null
  },
>(row: T) {
  const { userImage: _image, ...member } = row
  return { ...member, userName: label(row.userName), userEmail: label(row.userEmail) }
}
