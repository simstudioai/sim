export { isApiClientError } from '@/lib/api/client/errors'
export type { SearchIntegrationApproval } from '@/lib/api/contracts/knowledge/search-integrations'
export type { GenericSecretSource } from '@/lib/api/contracts/organization-secrets'
export { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
export { resourceScopeKey } from '@/lib/core/resource-scope'
export { assistantAccountOptions } from '@/lib/credential-groups/member-integrations'
export {
  getCredentialGroupProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
export { hasSlackSearchUserScopes } from '@/lib/credential-groups/slack-managed-user-scopes'
export { organizationRoutes } from '@/lib/navigation/paths'
export { getCanonicalScopesForProvider } from '@/lib/oauth'
export type { SecretSourceMode } from '@/lib/organization-secrets/validation'
export { getSearchConnectionLabels } from '@/lib/sim-search/connection-labels'
export { connectorDisplayName, getConnectorAccessAvailability } from '@/lib/sim-search/connectors'
export {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SCOPE_FIELDS,
  LIVE_SEARCH_SERVICE_PROVIDERS,
  type LiveSearchPolicy,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
export {
  getLiveSearchAccessAvailability,
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
} from '@/lib/sim-search/live/source-catalog'
export {
  searchSetupAccessParam,
  searchSetupParam,
  searchSetupReturnParam,
  serializeSearchSetup,
} from '@/lib/sim-search/params'
export { slackSearchSetupHref } from '@/lib/sim-search/setup-navigation'
export { describeSearchSource } from '@/lib/sim-search/source-identity'
export { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
export { connectedAccountsParam } from '@/app/o/[organizationId]/settings/components/integrations/search-params'
export { useSearchSourceSetup } from '@/app/o/[organizationId]/settings/components/integrations/use-search-source-setup'
export { useAddConnectorForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/add-connector-modal/use-add-connector-form'
export { isConnectorFieldRequired } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
export { useConnectorAccessField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/use-connector-access-field'
export type { ConnectorConfigFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-config-fields/connector-config-fields'
export { useConnectorSelector } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-selector-field/use-connector-selector'
export { getConnectorSyncState } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/connector-sync-state'
export { useConnectorActions } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connectors-section/use-connector-actions'
export type { ConnectorSettingsFieldsProps } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/connector-settings-fields'
export {
  CONNECTOR_SWITCH_NOTICE,
  useConnectorSettingsFields,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-fields'
export { useConnectorSettingsForm } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/edit-connector-modal/use-connector-settings-form'
export { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
export {
  GITLAB_CSV_FILES,
  GITLAB_TOKEN_TABS,
} from '@/connectors/gitlab/permission-config/csv-files'
export type { GitLabPermissionForm } from '@/connectors/gitlab/permission-config/use-permission-form'
export { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
export {
  isConnectorSyncingOrPending,
  useConnectorDetail,
  useSearchIndex,
  useSearchSources,
} from '@/hooks/queries/kb/connectors'
export {
  useConnectOrganizationAccount,
  useDisconnectPersonalOrganizationAccount,
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
  useReconnectPersonalOrganizationAccount,
  useUpdateOrganizationAccounts,
} from '@/hooks/queries/organization-accounts'
export {
  useConfigureOrganizationSecretSource,
  useOrganizationSecretSource,
  useOrganizationSecrets,
  useRemoveOrganizationSecretSource,
  useSaveOrganizationSecrets,
} from '@/hooks/queries/organization-secrets'
export {
  useSearchIntegrations,
  useUpdateSearchIntegration,
} from '@/hooks/queries/search-integrations'
export { useAvailableEnvVarKeys } from '@/hooks/use-available-env-vars'
export { useDebounce } from '@/hooks/use-debounce'
export { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
export { usePermissionConfig } from '@/hooks/use-permission-config'
