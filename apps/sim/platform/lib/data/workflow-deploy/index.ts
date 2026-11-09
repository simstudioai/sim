/**
 * The workflow editor's deploy seam. Deploy, redeploy, undeploy, versions, the public API, chat and
 * MCP deployments run the legacy deploy hooks, query hooks and comparison logic unchanged; only the
 * views are rebuilt in the zone. The Terminal and Variables tabs keep their own subfolders.
 */

export { ApiClientError } from '@/lib/api/client/errors'
export type {
  DeploymentOperationSummary,
  DeploymentVersion,
} from '@/lib/api/contracts/deployments'
export { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'
export {
  extractDescriptionOverrides,
  extractInputFormatFromBlocks,
  generateToolInputSchema,
  getMeaningfulWorkflowDescription,
  sanitizeToolName,
} from '@/lib/mcp/workflow-tool-schema'
export { validateAllowlistEntry } from '@/lib/messaging/email/validation'
export {
  buildWorkflowDiffOverlay,
  generateWorkflowDiffSummary,
  omitPresentationChanges,
  type WorkflowDiffSummary,
} from '@/lib/workflows/comparison'
export type { EdgeChange } from '@/lib/workflows/comparison/compare'
export { formatValueForDisplay, resolveFieldLabel } from '@/lib/workflows/comparison/resolve-values'
export { normalizeInputFormatValue } from '@/lib/workflows/input-format'
export { getInputFormatExample } from '@/lib/workflows/operations/deployment-utils'
export {
  AGENT_STREAM_PROTOCOL_HEADER_LABEL,
  AGENT_STREAM_PROTOCOL_V1,
} from '@/lib/workflows/streaming/agent-stream-protocol'
export { formatInternalOutputSelector } from '@/lib/workflows/streaming/output-selector'
export { buildSubBlockValues } from '@/lib/workflows/subblocks/visibility'
export type { InputFormatField } from '@/lib/workflows/types'
export { useIdentifierValidation } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/chat/hooks/use-identifier-validation'
export {
  getPasswordHelperText,
  hasExistingPassword,
  isPasswordRequired,
  isWhitespaceOnlyPassword,
  shouldConfirmPasswordChange,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/chat/utils'
export {
  type ComparePair,
  resolveComparePair,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/compare-pair'
export { formatVersionLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/format-version-label'
export {
  releaseDeployAction,
  tryAcquireDeployAction,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/deploy-action-lock'
export { runPreDeployChecks } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/predeploy-checks'
export {
  type DeployReadiness,
  useDeployReadiness,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deploy-readiness'
export { useDeployment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deployment'
export {
  type DeploymentViewState,
  useDeploymentViewState,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-deployment-view-state'
export { useDraftWorkflowState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-draft-workflow-state'
export { diffOrderedRows } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/ordered-row-diff'
export {
  buildDiffRows,
  type DiffLine,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff-lines'
export {
  getStructuredValuePresentation,
  mappingPresentation,
  type StructuredValuePresentation,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/value-presentation'
export {
  type BlockChangeEntry,
  classifyChange,
  containerFieldLabel,
  findSubBlockConfig,
  formatScalar,
  isBlankValue,
  isSentenceLike,
  listBlockChanges,
  maskSecretsDeep,
  toDiffText,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
export { normalizeName, startsWithUuid } from '@/executor/constants'
export { apiKeysQueryOptions } from '@/hooks/queries/api-key-list'
export { useApiKeys } from '@/hooks/queries/api-keys'
export {
  type AuthType,
  type ChatFormData,
  useCreateChat,
  useDeleteChat,
  useRevealChatPassword,
  useUpdateChat,
} from '@/hooks/queries/chats'
export {
  type ChatDetail,
  useActivateDeploymentVersion,
  useChatDeploymentInfo,
  useDeploymentInfo,
  useDeploymentVersions,
  useDeployWorkflow,
  useGenerateVersionDescription,
  useUndeployWorkflow,
  useUpdateDeploymentVersion,
  useUpdatePublicApi,
} from '@/hooks/queries/deployments'
export { invalidateDeploymentQueries } from '@/hooks/queries/utils/deployment-keys'
export {
  useAddWorkflowMcpTool,
  useDeleteWorkflowMcpTool,
  useUpdateWorkflowMcpTool,
  useWorkflowMcpServers,
  useWorkflowMcpTools,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
  workflowMcpServersQueryOptions,
} from '@/hooks/queries/workflow-mcp-servers'
export { useDeploymentVersionState, useRevertToVersion } from '@/hooks/queries/workflows'
export { useWorkspaceSettings, workspaceSettingsQueryOptions } from '@/hooks/queries/workspace'
export { useSettingsNavigation } from '@/hooks/use-settings-navigation'
export { EMPTY_SUBBLOCK_VALUES } from '@/stores/workflows/subblock/store'
export { syncLocalDraftFromServer } from '@/stores/workflows/sync-local-draft'
export { mergeSubblockState } from '@/stores/workflows/utils'
