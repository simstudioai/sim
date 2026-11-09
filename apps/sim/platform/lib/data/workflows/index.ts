/**
 * The Workflows tab's logic seam. The workflow canvas runs the legacy editor's own stores, socket
 * provider, collaborative hook, execution and layout logic unchanged; only its views are ported into
 * the zone. This barrel names every module they read, so `check:platform-design` can walk the
 * closure (blocks and tools registry included, by the exception scoped to this folder).
 */

/** The canvas's own glyphs, from the set block configs name their icons from, so blocks paint as in legacy. */
export {
  ArrowLeftRight,
  ArrowUpDown,
  Ban,
  Box,
  ChevronsDownUp,
  Circle,
  Clock,
  Duplicate,
  Expand,
  Globe,
  Key,
  ListFilter,
  Lock,
  LogOut,
  MessageSquareText,
  Palette,
  Paperclip,
  PlayOutline,
  Repeat,
  Search,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Split,
  Square,
  ToggleLeft,
  Trash,
  TypeJson,
  TypeNumber,
  Unlock,
  Wrench,
  X,
} from '@sim/emcn-legacy/icons'
export { createLogger } from '@sim/logger'
export {
  BLOCK_DIMENSIONS,
  CONTAINER_DIMENSIONS,
  clampNoteBlockHeight,
  estimateNoteBlockHeight,
  getNoteBlockHeight,
  HANDLE_POSITIONS,
} from '@sim/workflow-renderer/dimensions'
export {
  DEFAULT_NOTE_COLOR,
  getNoteColorOption,
  isNoteColor,
  NOTE_COLOR_OPTIONS,
  type NoteColor,
} from '@sim/workflow-renderer/note-colors'
export { getNoteStringValue } from '@sim/workflow-renderer/note-content'
export { isLightTileColor } from '@sim/workflow-renderer/tile-icon-color'
export type { WorkflowCardSide, WorkflowConnectionSide } from '@sim/workflow-types/workflow'
export {
  getWorkflowSubflowHandleIds,
  isWorkflowBlockProtected,
  normalizeWorkflowEdgeHandles,
  normalizeWorkflowEdgeSourceHandle,
  normalizeWorkflowEdgeTargetHandle,
  WORKFLOW_ERROR_HANDLE_ID,
  WORKFLOW_SOURCE_HANDLE_ID,
  WORKFLOW_TARGET_HANDLE_ID,
  wouldCreateCycle,
} from '@sim/workflow-types/workflow'
/** The canvas Note's raw-source fallback: when to use it, and its paste limit. */
export { assessRawMarkdownPaste } from '@/components/file-viewer/rich-markdown-editor/paste-admission'
export { isRoundTripSafe } from '@/components/file-viewer/rich-markdown-editor/round-trip-safety'
export { useWorkflowResourceReplacementOptions } from '@/components/workflow-editor/components/search-replace/hooks/use-workflow-resource-replacement-options'
export {
  type HydratedWorkflowSearchMatch,
  useWorkflowSearchReferenceHydration,
} from '@/components/workflow-editor/components/search-replace/hooks/use-workflow-search-reference-hydration'
/** The Loop and Parallel tiles the Toolbar tab lists beside the registry's core blocks. */
export { LoopTool } from '@/components/workflow-editor/components/subflows/loop/loop-config'
export { ParallelTool } from '@/components/workflow-editor/components/subflows/parallel/parallel-config'
export { useBlockProperties } from '@/components/workflow-editor/components/workflow-block/hooks/use-block-properties'
export { useBlockState } from '@/components/workflow-editor/components/workflow-block/hooks/use-block-state'
/** What the block card's container reads: summary-row hydration, sunset badges, child deploys. */
export { useChildWorkflow } from '@/components/workflow-editor/components/workflow-block/hooks/use-child-workflow'
export { useWebhookInfo } from '@/components/workflow-editor/components/workflow-block/hooks/use-webhook-info'
export type { WorkflowBlockProps } from '@/components/workflow-editor/components/workflow-block/types'
export {
  getProviderName,
  shouldSkipBlockRender,
} from '@/components/workflow-editor/components/workflow-block/utils'
export {
  useFloatBoundarySync,
  useFloatDrag,
  useFloatLayout,
} from '@/components/workflow-editor/hooks/float'
export { useAutoLayout } from '@/components/workflow-editor/hooks/use-auto-layout'
export { useBlockCurrentWorkflow } from '@/components/workflow-editor/hooks/use-block-current-workflow'
export { useBlockDimensions } from '@/components/workflow-editor/hooks/use-block-dimensions'
export { useCanvasContextMenu } from '@/components/workflow-editor/hooks/use-canvas-context-menu'
export { useCurrentWorkflow } from '@/components/workflow-editor/hooks/use-current-workflow'
export { useDynamicHandleRefresh } from '@/components/workflow-editor/hooks/use-dynamic-handle-refresh'
export { useIsBlockInActiveExecutionHandoff } from '@/components/workflow-editor/hooks/use-execution-handoff'
export { useNodeUtilities } from '@/components/workflow-editor/hooks/use-node-utilities'
export { usePreventZoom } from '@/components/workflow-editor/hooks/use-prevent-zoom'
export { useShiftSelectionLock } from '@/components/workflow-editor/hooks/use-shift-selection-lock'
export { useWorkflowExecution } from '@/components/workflow-editor/hooks/use-workflow-execution'
export { focusBlockParam } from '@/components/workflow-editor/search-params'
export {
  filterProtectedBlocks,
  getWorkflowLockToggleIds,
  isEdgeProtected,
} from '@/components/workflow-editor/utils/block-protection'
export {
  isEdgeConnectedToEditor,
  isEdgeHighlighted,
} from '@/components/workflow-editor/utils/edge-highlight'
export {
  calculateContainerDimensions,
  clampPositionToContainer,
  estimateBlockDimensions,
} from '@/components/workflow-editor/utils/node-position'
export { getRunFromBlockDependencyState } from '@/components/workflow-editor/utils/run-from-block'
export {
  clearDragHighlights,
  computeClampedPositionUpdates,
  getArrowNavigationDirection,
  getClampedPositionForNode,
  getDescendantBlockIds,
  getEdgeSelectionContextId,
  getNodeDataDimension,
  getNodeSelectionContextId,
  isInEditableElement,
  isPositionalTriggerBlock,
  reconcileCanvasEdges,
  reconcileCanvasNodes,
  resolveSelectionConflicts,
  SUBFLOW_CHILD_NODE_CLASS,
  SUBFLOW_DROP_TARGET_CLASS,
  shouldHighlightContainerDropTarget,
  validateTriggerPaste,
} from '@/components/workflow-editor/utils/workflow-canvas-helpers'
export { useSocket } from '@/components/workspace-providers/socket-provider'
export {
  useOptionalWorkflowScope,
  useScopedWorkflowId,
  useWorkflowScope,
  WorkflowScopeProvider,
} from '@/components/workspace-providers/workflow-scope-provider'
/** The read-only preview's last workspace fallback; nothing in the zone provides it yet. */
export { useOptionalWorkspaceHostContext } from '@/components/workspace-providers/workspace-host-context'
export {
  useUserPermissionsContext,
  useWorkspacePermissionsContext,
} from '@/components/workspace-providers/workspace-permissions-provider'
export { filterAndCap } from '@/components/workspace-sidebar/components/search-modal/utils'
export { useSession } from '@/lib/auth/client'
export { getWorkspaceUsageLimitAction } from '@/lib/billing/workspace-permissions'
export { useDeploymentShape } from '@/lib/core/config/deployment-shape'
export { isMacPlatform } from '@/lib/core/utils/platform'
export { getBaseUrl } from '@/lib/core/utils/urls'
export { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
/** The canvas chrome's shortcut definitions and the search panel's resource hooks. */
export { createCommand } from '@/lib/global-commands/commands'
export { createMcpToolId } from '@/lib/mcp/shared'
export { sendMothershipMessage } from '@/lib/mothership/events'
export type { OAuthConnectEventDetail } from '@/lib/mothership/tools/client/base-tool'
export type { OAuthProvider } from '@/lib/oauth'
export { getProviderIdFromServiceId } from '@/lib/oauth'
export { usesCredentialConfiguredOAuthClient } from '@/lib/oauth/utils'
export { OPERATION_SUBBLOCK_ID } from '@/lib/permission-groups/operation-access'
export { captureClientEvent, captureClientException, captureEvent } from '@/lib/posthog/client'
export { createSortParams } from '@/lib/url-state'
export {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
export { getCardSubBlocks } from '@/lib/workflows/blocks/canvas-card-fields'
export { type CanvasPort, getCanvasPorts } from '@/lib/workflows/blocks/canvas-ports'
export {
  getDefaultBlockName,
  resolveCanvasBlockPresentation,
} from '@/lib/workflows/blocks/canvas-presentation'
export {
  showsCanvasDefaultHandles,
  showsCanvasErrorRow,
  splitCanvasChipBlocks,
} from '@/lib/workflows/blocks/canvas-rows'
export type { CardSelector } from '@/lib/workflows/blocks/canvas-sentence'
export {
  estimateSentenceLines,
  getOperationSubBlockId,
  resolveCanvasSentence,
} from '@/lib/workflows/blocks/canvas-sentence'
export { resolveSelectedTriggerId } from '@/lib/workflows/blocks/canvas-trigger-sentence'
export { resolveCanvasCodePreview } from '@/lib/workflows/blocks/code-preview'
export { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'
/** A version comparison's per-block and per-edge status, as the read-only preview paints them. */
export type {
  BlockDiffStatus,
  EdgeDiffStatus as VersionEdgeDiffStatus,
} from '@/lib/workflows/comparison'
export type { DiffStatus } from '@/lib/workflows/diff/types'
export { hasDiffStatus } from '@/lib/workflows/diff/types'
export {
  getConditionRows,
  getDynamicHandleRows,
  getRouterRows,
} from '@/lib/workflows/dynamic-handle-topology'
export { getPanelWidth, getTerminalHeight } from '@/lib/workflows/layout'
export { appendNoteImageMarkdown } from '@/lib/workflows/notes/add-image'
export type { NoteBlockRequestDetail } from '@/lib/workflows/notes/canvas-requests'
export {
  NOTE_ADD_IMAGE_EVENT,
  NOTE_RENAME_EVENT,
  requestNoteImage,
  requestNoteRename,
} from '@/lib/workflows/notes/canvas-requests'
export {
  downloadFile,
  exportFolderToZip,
  extractWorkflowsFromFiles,
  extractWorkflowsFromZip,
  type FolderExportData,
  fetchWorkflowForExport,
  generateWorkflowJson,
  persistImportedWorkflow,
  sanitizePathSegment,
  type WorkflowExportData,
} from '@/lib/workflows/operations/import-export'
export { indexWorkflowSearchMatches } from '@/lib/workflows/search-replace/indexer'
export { buildWorkflowSearchReplacePlan } from '@/lib/workflows/search-replace/replacements'
export {
  dedupeOverlappingWorkflowSearchMatches,
  getCompatibleResourceReplacementOptions,
  getWorkflowSearchCompatibleResourceMatches,
  getWorkflowSearchMatchResourceGroupKey,
  getWorkflowSearchReplacementIssue,
  isConstrainedResourceMatch,
  workflowSearchMatchMatchesQuery,
} from '@/lib/workflows/search-replace/resources'
export { getWorkflowSearchBlocks } from '@/lib/workflows/search-replace/state'
export { WORKFLOW_SEARCH_SUBFLOW_FIELD_IDS } from '@/lib/workflows/search-replace/subflow-fields'
export type {
  WorkflowSearchReplacementOption,
  WorkflowSearchReplaceSubflowUpdate,
} from '@/lib/workflows/search-replace/types'
export {
  getDependsOnFields,
  getTransitiveSubBlockDependents,
} from '@/lib/workflows/subblocks/dependencies'
export {
  getDisplayValue,
  hasDisplayableRowValue,
  resolveDropdownLabel,
  resolveFallbackModelsLabel,
  resolveFilterFieldLabel,
  resolveFolderPathLabel,
  resolveSandboxLabel,
  resolveSkillsLabel,
  resolveToolsLabel,
  resolveVariablesLabel,
  resolveWorkflowMultiSelectLabel,
  resolveWorkflowSelectionLabel,
} from '@/lib/workflows/subblocks/display'
export {
  buildCanonicalIndex,
  buildCanonicalIndexForSurface,
  evaluateSubBlockCondition,
  hasAdvancedValues,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
  isToolInputOnlySubBlock,
  resolveDependencyValue,
} from '@/lib/workflows/subblocks/visibility'
export { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
export { TriggerUtils } from '@/lib/workflows/triggers/triggers'
export { getTriggersForSidebar, hasTriggerCapability } from '@/lib/workflows/triggers/utils'
export { getUserColor } from '@/lib/workspaces/colors'
/** The Workflows list's create, delete and export commands: legacy's own naming and hooks. */
export { generateFolderName, generateSubfolderName } from '@/lib/workspaces/naming'
/** The legacy document face the canvas's block and note text is set in. */
export { season } from '@/app/_styles/fonts/season/season'
export { getBlock } from '@/blocks'
export {
  buildCustomBlockConfig,
  CUSTOM_BLOCK_IMAGE_TILE_COLOR,
  CUSTOM_BLOCK_TILE_COLOR,
  isCustomBlockType,
} from '@/blocks/custom/build-config'
export {
  hydrateClientCustomBlocks,
  useCustomBlockOverlayVersion,
} from '@/blocks/custom/client-overlay'
export { getCanonicalBlocksByCategory } from '@/blocks/registry'
export type { BlockConfig, BlockIcon, SubBlockConfig } from '@/blocks/types'
export { SELECTOR_TYPES_HYDRATION_REQUIRED } from '@/blocks/types'
export { isAnnotationOnlyBlock } from '@/executor/constants'
export { useKnowledgeBase } from '@/hooks/kb/use-knowledge'
export { useMcpTools } from '@/hooks/mcp/use-mcp-tools'
export { useWorkspaceCredentials } from '@/hooks/queries/credentials'
export { useCustomBlocks } from '@/hooks/queries/custom-blocks'
export { useCustomTools } from '@/hooks/queries/custom-tools'
export { useDeployWorkflow } from '@/hooks/queries/deployments'
export { useDynamicSubBlockOptionDisplayName } from '@/hooks/queries/dynamic-subblock-options'
export { useWorkspaceEnvironment } from '@/hooks/queries/environment'
export { useFolderMap } from '@/hooks/queries/folders'
export {
  useAutoConnect,
  useAutoFocusOnClick,
  useShowActionBar,
  useSnapToGridSize,
  useUpdateGeneralSetting,
} from '@/hooks/queries/general-settings'
export { useMcpToolServers, useMcpToolsQuery } from '@/hooks/queries/mcp'
export { useCredentialName } from '@/hooks/queries/oauth/credentials'
export { useSandboxes } from '@/hooks/queries/sandboxes'
export { useReactivateSchedule, useScheduleInfo } from '@/hooks/queries/schedules'
export { useSkills } from '@/hooks/queries/skills'
export { useTablesList } from '@/hooks/queries/tables'
export { getFolderMap } from '@/hooks/queries/utils/folder-cache'
export { folderKeys } from '@/hooks/queries/utils/folder-keys'
export {
  findLockedAncestorFolder,
  isFolderEffectivelyLocked,
  isFolderOrAncestorLocked,
  isWorkflowEffectivelyLocked,
} from '@/hooks/queries/utils/folder-tree'
export { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
export { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
export {
  useCreateWorkflow,
  useDeleteWorkflowMutation,
  useDuplicateWorkflowMutation,
  useReorderWorkflows,
  useUpdateWorkflow,
  useWorkflowMap,
  useWorkflows,
} from '@/hooks/queries/workflows'
export { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'
export { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'
export { useWorkspaceUsageGate } from '@/hooks/queries/workspace-usage'
export { useCanvasViewport } from '@/hooks/use-canvas-viewport'
export { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
export { useIsMobile } from '@/hooks/use-is-mobile'
export { useOAuthReturnForWorkflow } from '@/hooks/use-oauth-return'
export { useOperationAccess } from '@/hooks/use-operation-access'
export { usePermissionConfig } from '@/hooks/use-permission-config'
export { useReactiveConditions } from '@/hooks/use-reactive-conditions'
export { useSandboxBlockConstraints } from '@/hooks/use-sandbox-block-constraints'
export { useSelectorDisplayName } from '@/hooks/use-selector-display-name'
export { useCanDelete } from '@/hooks/workflow-actions/use-can-delete'
export { useDeleteSelection } from '@/hooks/workflow-actions/use-delete-selection'
export { useExportSelection } from '@/hooks/workflow-actions/use-export-selection'
export { useExportWorkflow } from '@/hooks/workflow-actions/use-export-workflow'
export { getModelSunsetStatus } from '@/providers/models'
export { useCanvasModeStore } from '@/stores/canvas-mode'
export { useChatStore } from '@/stores/chat/store'
export { PANEL_WIDTH, TERMINAL_HEIGHT } from '@/stores/constants'
export {
  defaultWorkflowExecutionState,
  useExecutionStore,
  useIsBlockActive,
  useIsCurrentWorkflowExecuting,
  useLastExecutionSnapshot,
  useLastRunEdges,
  useLastRunPath,
} from '@/stores/execution'
export type { WorkflowFolder } from '@/stores/folders/types'
export { useSearchModalStore } from '@/stores/modals/search/store'
export type {
  PendingConnect,
  SearchBlockItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'
export { useVariablesModalStore } from '@/stores/modals/variables/store'
export {
  usePanelEditorSearchStore,
  usePanelEditorStore,
  usePanelStore,
  useToolbarStore,
} from '@/stores/panel'
export type { ActiveSearchTarget } from '@/stores/panel/editor/store'
export type { ToolbarSectionKey } from '@/stores/panel/toolbar/store'
export { usePresenceStore } from '@/stores/presence/store'
export { useUndoRedoStore } from '@/stores/undo-redo'
export { useVariablesStore } from '@/stores/variables/store'
export { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
export { useWorkflowSearchReplaceStore } from '@/stores/workflow-search-replace/store'
export { getWorkflowWithValues } from '@/stores/workflows'
export { prepareBlockState } from '@/stores/workflows/prepare-block-state'
export { useWorkflowRegistry } from '@/stores/workflows/registry/store'
export type { WorkflowMetadata } from '@/stores/workflows/registry/types'
export { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'
export { useSubBlockStore } from '@/stores/workflows/subblock/store'
export { getUniqueBlockName } from '@/stores/workflows/utils'
export { useWorkflowStore } from '@/stores/workflows/workflow/store'
export type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
export { formatParameterLabel } from '@/tools/params'
export { TRIGGER_REGISTRY } from '@/triggers/registry'
