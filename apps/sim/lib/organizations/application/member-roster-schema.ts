import { z } from 'zod'

export const rosterWorkspaceAccessSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  permission: z.enum(['admin', 'write', 'read']),
  /**
   * Why this role is fixed, when it is. Carried so the roster can disable the
   * controls the workspace-permissions route refuses, the way the teammates list
   * already does — without them it offers an edit that can only fail.
   */
  roleSource: z.enum(['owner', 'explicit', 'org-admin']),
  isBilledAccount: z.boolean(),
})

export const rosterMemberSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'external']),
  createdAt: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  /** Set while a directory deactivation blocks the member's sign-in; access is otherwise intact. */
  suspendedAt: z.string().nullable(),
  workspaces: z.array(rosterWorkspaceAccessSchema),
})

export const rosterPendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  kind: z.enum(['organization', 'workspace']),
  membershipIntent: z.enum(['internal', 'external']).optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  inviteeName: z.string().nullable(),
  inviteeImage: z.string().nullable(),
  workspaces: z.array(rosterWorkspaceAccessSchema),
})

export const organizationRosterSchema = z.object({
  members: z.array(rosterMemberSchema),
  pendingInvitations: z.array(rosterPendingInvitationSchema),
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
})

export type OrganizationRoster = z.infer<typeof organizationRosterSchema>
export type RosterWorkspaceAccess = z.infer<typeof rosterWorkspaceAccessSchema>
export type RosterMember = z.infer<typeof rosterMemberSchema>
