/**
 * Sim Enterprise Edition
 *
 * This module contains enterprise features that require a valid
 * Sim Enterprise license for production use.
 *
 * See LICENSE in this directory for terms.
 */

export type { PermissionGroupConfig } from './access-control'
// Access Control (Permission Groups)
export {
  AccessControl,
  type BulkAddMembersData,
  type CreatePermissionGroupData,
  type DeletePermissionGroupParams,
  type PermissionGroup,
  type PermissionGroupMember,
  permissionGroupKeys,
  type UpdatePermissionGroupData,
  type UserPermissionConfig,
  useAddPermissionGroupMember,
  useBulkAddPermissionGroupMembers,
  useCreatePermissionGroup,
  useDeletePermissionGroup,
  usePermissionGroup,
  usePermissionGroupMembers,
  usePermissionGroups,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
  useUserPermissionConfig,
} from './access-control'
// SSO (Single Sign-On)
export { SSO, ssoKeys, useConfigureSSO, useDeleteSSO, useSSOProviders } from './sso'
