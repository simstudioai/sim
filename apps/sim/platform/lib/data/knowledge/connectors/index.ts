export type {
  ConnectorAccessMode,
  ConnectorData,
  ConnectorDocumentFilter,
  MemberSyncLogData,
  SyncLogData,
  ViewerConnectorMembership,
} from '@/lib/api/contracts/knowledge/connectors'
export {
  CONNECTOR_SYNC_STALE_LOCK_TTL_MS,
  CREDENTIAL_REMOVED_SYNC_ERROR,
  CREDENTIAL_REVOKED_SYNC_ERROR,
  MEMBER_SYNC_STALE_LOCK_TTL_MS,
} from '@/lib/knowledge/connectors/sync-limits'
export { getCanonicalScopesForProvider, getProviderIdFromServiceId } from '@/lib/oauth'
export { getMissingRequiredScopes } from '@/lib/oauth/utils'
export type { SourceSelectionLabel } from '@/lib/sim-search/source-identity'
export { describeSearchSource } from '@/lib/sim-search/source-identity'
export { isConnectorFieldRequired } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
export { useConnectorAccessField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/use-connector-access-field'
export { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
export { useConnectorActions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
export {
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
export type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-config-fields'
export { getConnectorRequiredScopes, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
export {
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
} from '@/connectors/gitlab/permission-config/csv-files'
export type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
export { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
export type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
export {
  isConnectorSyncingOrPending,
  useConnectorDetail,
  useConnectorDocuments,
  useConnectorList,
  useExcludeConnectorDocument,
  useRestoreConnectorDocument,
  useStartConnectorMemberEnrollment,
} from '@/hooks/queries/kb/connectors'
export { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'
export { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
export { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
export { useAddConnectorForm } from '@/platform/lib/data/knowledge/connectors/add-form'
export { useConnectorScope } from '@/platform/lib/data/knowledge/connectors/scope'
export {
  CONNECTOR_SWITCH_NOTICE,
  useConnectorSettingsForm,
} from '@/platform/lib/data/knowledge/connectors/settings-form'
