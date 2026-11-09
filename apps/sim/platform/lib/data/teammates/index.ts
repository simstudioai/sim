export type { WorkspacePermission } from '@/lib/api/contracts/workspaces'
export { useSession } from '@/lib/auth/client'
export { isEnterprise } from '@/lib/billing/plan-helpers'
export { useDeploymentShape } from '@/lib/core/config/deployment-shape'
export { buildInviteFailureMessage } from '@/lib/invitations/error-messages'
export { quickValidateEmail } from '@/lib/messaging/email/validation'
export { workspaceRoleLockReason } from '@/lib/workspaces/permissions/role-lock'
export {
  useCancelWorkspaceInvitation,
  usePendingInvitations,
  useRemoveWorkspaceMember,
  useResendWorkspaceInvitation,
  useSendWorkspaceInvitations,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
export { useOrganizationPlanSeats } from '@/hooks/queries/organization-plan-seats'
export {
  useAdminWorkspaces,
  useWorkspacePermissionsQuery,
  useWorkspacesQuery,
} from '@/hooks/queries/workspace'
export { useSettingsSearch } from '@/hooks/use-settings-search'
export { useWorkspaceInvitePolicy } from '@/platform/lib/data/teammates/invite-policy'
