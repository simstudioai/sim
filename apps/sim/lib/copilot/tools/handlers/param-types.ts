/**
 * Typed parameter interfaces for tool executor functions.
 * Replaces Record<string, any> with specific shapes based on actual property access.
 */

import type { MothershipResourceType } from '@/lib/copilot/resources/types'

// === Workflow Query Params ===

export interface GetWorkflowDataParams {
  workflowId?: string
  data_type?: string
  dataType?: string
}

export interface GetWorkflowRunOptionsParams {
  workflowId?: string
}

export interface GetBlockOutputsParams {
  workflowId?: string
  blockIds?: string[]
}

export interface GetBlockUpstreamReferencesParams {
  workflowId?: string
  blockIds: string[]
}

// === Workflow Mutation Params ===

export interface CreateWorkflowParams {
  name?: string
  workspaceId?: string
  folderId?: string
  description?: string
}

export interface CreateFolderParams {
  name?: string
  workspaceId?: string
  parentId?: string
}

export interface RunWorkflowParams {
  workflowId?: string
  workflow_input?: unknown
  input?: unknown
  /** Optional trigger block ID when the workflow has multiple entrypoints and the caller wants a specific one. */
  triggerBlockId?: string
  /** When true, run with the resolved trigger's generated mock payload instead of workflow_input. */
  useMockPayload?: boolean
  /** Reuse the recorded input from a past execution of this workflow instead of supplying workflow_input. */
  inputFromExecutionId?: string
  /** When true, runs the deployed version instead of the draft. Default: false (draft). */
  useDeployedState?: boolean
}

export interface RunWorkflowUntilBlockParams {
  workflowId?: string
  workflow_input?: unknown
  input?: unknown
  /** Optional trigger block ID when the workflow has multiple entrypoints and the caller wants a specific one. */
  triggerBlockId?: string
  /** When true, run with the resolved trigger's generated mock payload instead of workflow_input. */
  useMockPayload?: boolean
  /** Reuse the recorded input from a past execution of this workflow instead of supplying workflow_input. */
  inputFromExecutionId?: string
  /** The block ID to stop after. Execution halts once this block completes. */
  stopAfterBlockId: string
  /** When true, runs the deployed version instead of the draft. Default: false (draft). */
  useDeployedState?: boolean
}

export interface RunFromBlockParams {
  workflowId?: string
  /** The block ID to start execution from. */
  startBlockId: string
  /** Optional execution ID to load the snapshot from. If omitted, uses the latest execution. */
  executionId?: string
  workflow_input?: unknown
  input?: unknown
  useDeployedState?: boolean
}

export interface RunBlockParams {
  workflowId?: string
  /** The block ID to run. Only this block executes using cached upstream outputs. */
  blockId: string
  /** Optional execution ID to load the snapshot from. If omitted, uses the latest execution. */
  executionId?: string
  workflow_input?: unknown
  input?: unknown
  useDeployedState?: boolean
}

export interface GetDeployedWorkflowStateParams {
  workflowId?: string
}

export interface GenerateApiKeyParams {
  name: string
  workspaceId?: string
}

export interface VariableOperation {
  name: string
  operation: 'add' | 'edit' | 'delete'
  value?: unknown
  type?: string
}

export interface SetGlobalWorkflowVariablesParams {
  workflowId?: string
  operations?: VariableOperation[]
}

export interface SetBlockEnabledParams {
  workflowId?: string
  blockId: string
  enabled: boolean
}

// === Deployment Params ===

export interface DeployApiParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy'
  /** Description of what changed in this deployment version. Required when action is 'deploy'. */
  versionDescription?: string
  /** Short human-readable name/label for this deployment version. Required when action is 'deploy'. */
  versionName?: string
}

export interface DeployChatParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy' | 'update'
  identifier?: string
  title?: string
  description?: string
  /** Description of what changed in this deployment version (distinct from the chat-facing `description`). Required when action is 'deploy'. */
  versionDescription?: string
  /** Short human-readable name/label for this deployment version. Required when action is 'deploy'. */
  versionName?: string
  welcomeMessage?: string
  customizations?: {
    primaryColor?: string
    secondaryColor?: string
    welcomeMessage?: string
    imageUrl?: string
    /** @deprecated Prefer imageUrl for compatibility with chat deploy APIs. */
    iconUrl?: string
  }
  authType?: 'password' | 'public' | 'email' | 'sso'
  password?: string
  subdomain?: string
  allowedEmails?: string[]
  outputConfigs?: unknown[]
  includeThinking?: boolean
}

export interface DeployMcpParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy'
  toolName?: string
  toolDescription?: string
  serverId?: string
  /**
   * Per-parameter descriptions as `[{ name, description }]`. Overlaid onto the
   * workflow's input format before generating the tool schema — the same path
   * the deploy modal uses. Parameter names/types/required come from the
   * workflow's input trigger, not from this tool.
   */
  parameterDescriptions?: Array<{ name: string; description: string }>
}

export interface DeployCustomBlockParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy'
  /** Block display name (max 60 chars). Required on first publish. */
  name?: string
  /** Block-picker description (max 280 chars). */
  description?: string
  /** Icon image URL; omit for the organization's default icon. */
  iconUrl?: string
  /**
   * Per-input placeholder overrides keyed by the input trigger field's stable id.
   * The field set itself is always derived from the workflow's deployment.
   */
  inputs?: Array<{ id: string; placeholder?: string }>
  /** Curated outputs; omit to expose the terminal block's whole result. */
  exposedOutputs?: Array<{ blockId: string; path: string; name: string }>
}

export interface CheckDeploymentStatusParams {
  workflowId?: string
}

export interface UpdateDeploymentVersionParams {
  workflowId?: string
  version: number | string
  /** New name/label for the version. Provide name and/or description. */
  name?: string
  /** New description for the version. Provide name and/or description. */
  description?: string
}

export interface GetDeploymentLogParams {
  workflowId?: string
}

export interface DiffWorkflowsParams {
  workflowId?: string
  /** Base/previous side: a version number, "live", or "draft". */
  ref1: number | string
  /** Target/current side: a version number, "live", or "draft". */
  ref2: number | string
}

export interface LoadDeploymentParams {
  workflowId?: string
  /** Version number to load, or "live" for the active deployment. */
  version: number | string
}

export interface PromoteToLiveParams {
  workflowId?: string
  /** Version number to promote to live. */
  version: number
}

export interface ListWorkspaceMcpServersParams {
  workspaceId?: string
}

export interface CreateWorkspaceMcpServerParams {
  workspaceId?: string
  name?: string
  description?: string
  isPublic?: boolean
  workflowIds?: string[]
}

// === Workflow Organization Params ===

export interface RenameWorkflowParams {
  workflowId: string
  name: string
}

export interface UpdateWorkflowParams {
  workflowId: string
  name?: string
  description?: string
}

export interface DeleteWorkflowParams {
  workflowIds: string[]
}

export interface MoveWorkflowParams {
  workflowIds: string[]
  folderId: string | null
}

export interface MoveFolderParams {
  folderId: string
  parentId: string | null
}

export interface RenameFolderParams {
  folderId: string
  name: string
}

export interface DeleteFolderParams {
  folderIds: string[]
}

export interface ManageFolderParams {
  operation: string
  path?: string
  folderId?: string
  name?: string
  destinationPath?: string
  parentId?: string | null
}

export interface UpdateWorkspaceMcpServerParams {
  serverId: string
  name?: string
  description?: string
  isPublic?: boolean
}

export interface DeleteWorkspaceMcpServerParams {
  serverId: string
}

export type OpenResourceType = MothershipResourceType

export interface OpenResourceItem {
  type?: OpenResourceType
  id?: string
  path?: string
}

export interface OpenResourceParams {
  resources?: OpenResourceItem[]
  type?: OpenResourceType
  id?: string
  path?: string
}

export interface ValidOpenResourceParams {
  type: OpenResourceType
  id?: string
  path?: string
}
