/**
 * What the editor's pickers read beyond the main seam: selector lists, credentials and their OAuth
 * flow, MCP servers and tools, tables, knowledge bases, folders, sandboxes and workflow outputs.
 */

export { getMcpTargetOptions } from '@/components/mcp/target-options'
export {
  CLI_TOOL_GROUPS,
  DEPENDENCY_PLACEHOLDERS,
  LANGUAGE_OPTIONS,
  SANDBOX_UPGRADE_DESCRIPTION,
  SANDBOX_UPGRADE_TITLE,
  type SandboxLanguage,
  SYSTEM_PACKAGE_PLACEHOLDER,
} from '@/components/settings/sections/sandboxes/utils'
export { shouldClearMissingOption } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/combobox/missing-option'
export { resolveMicrosoftDataverseCredentialPolicy } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/credential-selector/microsoft-dataverse-policy'
export { staleSelectionOptions } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/dropdown/stale-selections'
export type { FolderResourceType } from '@/lib/api/contracts/folders'
export type { SandboxCliToolId } from '@/lib/api/contracts/sandboxes'
export { useDeploymentShape } from '@/lib/core/config/deployment-shape'
export { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
export { parseFolderPath } from '@/lib/folders/paths'
export { readFolderPath, readFolderPaths } from '@/lib/folders/selection'
export type { KnowledgeBaseData } from '@/lib/knowledge/types'
export {
  createMcpToolOutputSnapshot,
  MCP_TOOL_OUTPUT_SCHEMA_SUBBLOCK,
} from '@/lib/mcp/output-schema'
export {
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  type OAuthProvider,
} from '@/lib/oauth'
export { getMissingRequiredScopes } from '@/lib/oauth/utils'
export {
  NO_DENIED_OPERATIONS,
  OPERATION_SUBBLOCK_ID,
} from '@/lib/permission-groups/operation-access'
export { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
export { DELETED_WORKFLOW_LABEL } from '@/lib/workflows/labels'
export { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
export { withCanonicalModes } from '@/lib/workflows/subblocks/visibility'
export { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
export { useMcpTools } from '@/hooks/mcp/use-mcp-tools'
export { useWorkspaceCredential, useWorkspaceCredentials } from '@/hooks/queries/credentials'
export { useMcpToolServers } from '@/hooks/queries/mcp'
export { useOAuthCredentials } from '@/hooks/queries/oauth/credentials'
export { useWorkspaceOrganizationAccounts } from '@/hooks/queries/organization-accounts'
export type { Sandbox } from '@/hooks/queries/sandboxes'
export {
  type SelectorClientContext,
  useSelectorOptionDetail,
  useSelectorOptionDetails,
  useSelectorOptionMap,
  useSelectorOptions,
} from '@/hooks/queries/selectors'
export { useTablesList } from '@/hooks/queries/tables'
export {
  collectDuplicateNames,
  disambiguateLabelByFolder,
} from '@/hooks/queries/utils/folder-tree'
export { useCredentialRefreshTriggers } from '@/hooks/use-credential-refresh-triggers'
export { useOperationAccess } from '@/hooks/use-operation-access'
export { usePermissionConfig } from '@/hooks/use-permission-config'
export { useReactiveConditions } from '@/hooks/use-reactive-conditions'
export { checkEnvVarTrigger } from '@/platform/lib/data/credentials'
export {
  getOAuthProviderIcon,
  getOAuthProviderName,
} from './credential-providers'
export { useDataModeSync } from './use-data-mode-sync'
export { useSandboxCreate } from './use-sandbox-create'
export { useSelectedKnowledgeBases } from './use-selected-knowledge-bases'
export { type SelectorSearch, useSelectorSearch } from './use-selector-search'
export { useServiceAccountTarget } from './use-service-account-target'
export { publicOutputValue, useWorkflowOutputOptions } from './use-workflow-output-options'
