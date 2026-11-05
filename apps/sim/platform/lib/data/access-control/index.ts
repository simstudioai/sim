export { isApiClientError } from '@/lib/api/client/errors'
export {
  isFeatureInertForGroup,
  ORGANIZATION_SCOPED_FEATURE_NOTE,
  type PermissionGroupPlatformFeature,
} from '@/lib/permission-groups/features'
export type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
export {
  type PermissionGroup,
  type PermissionGroupWorkspaceRef,
  useBulkAddPermissionGroupMembers,
  useCreatePermissionGroup,
  useDeletePermissionGroup,
  useOrganizationWorkspaces,
  usePermissionGroupMembers,
  usePermissionGroups,
  useRemovePermissionGroupMember,
  useUpdatePermissionGroup,
} from '@/ee/access-control/hooks/permission-groups'
export {
  accessStateOptions,
  agentDefaultModelIds,
  applyPermissionAccess,
  bulkAccessOptions,
  CHAT_DEPLOY_AUTH_TYPE_OPTIONS,
  createPermissionResolvers,
  FEATURE_PERMISSION_GRIDS,
  FILE_SHARE_AUTH_TYPE_OPTIONS,
  hasPermissionConfigChanges,
  inheritedPermissionResolvers,
  isAgentDefaultUsable,
  matchesStatusFilter,
  type PermissionResolvers,
  type PermissionStatusFilter,
  PLATFORM_DEFAULT_MODEL,
  platformFeatureSections,
  searchPlatformFeatures,
  statusFilterOptions,
} from '@/ee/access-control/lib/editor'
export type {
  AccessRequestTarget,
  PermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'
export { useOrganizationRoster } from '@/hooks/queries/organization'
export { useProjectList } from '@/hooks/queries/project-list'
export { useProviderModelLists, useProviderModels } from '@/hooks/queries/providers'
export { SIM_AUTO_MODEL_ID } from '@/providers/model-lookup'
export type { EditorBlock, EditorModel } from './editor'
export { useAccessControlParams, useGroupDetailParams, usePermissionEditorModel } from './editor'
