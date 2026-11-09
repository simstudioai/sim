export type {
  ConnectorAccessMode,
  ConnectorData,
  ConnectorDocumentFilter,
  MemberSyncLogData,
  SyncLogData,
  ViewerConnectorMembership,
} from '@/lib/api/contracts/knowledge/connectors'
export { isConnectorFieldRequired } from '@/lib/knowledge/connectors/access-fields'
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
export {
  connectorSyncFrequencyHint,
  SYNC_INTERVALS,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/consts'
export { getConnectorRequiredScopes, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
export {
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
} from '@/connectors/gitlab/permission-config/csv-files'
export type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
export { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
export type { ConnectorConfigField, ConnectorMeta } from '@/connectors/types'
export { getConnectorSyncState } from '@/hooks/kb/connectors/sync-state'
export { useConnectorAccessField } from '@/hooks/kb/connectors/use-connector-access-field'
export { useConnectorActions } from '@/hooks/kb/connectors/use-connector-actions'
export type {
  ConfigFieldMap,
  ConfigFieldValue,
} from '@/hooks/kb/connectors/use-connector-config-fields'
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
