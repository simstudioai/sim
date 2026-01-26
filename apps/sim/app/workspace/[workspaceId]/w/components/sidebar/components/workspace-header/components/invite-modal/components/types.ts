import type { PermissionType } from '@/lib/workspaces/permissions/utils'

export type { PermissionType }

export interface UserPermissions {
  userId?: string
  email: string
  permissionKind: PermissionType
  isCurrentUser?: boolean
  isPendingInvitation?: boolean
  invitationId?: string
}
