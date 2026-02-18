/**
 * Typed parameter interfaces for tool executor functions.
 * Replaces Record<string, any> with specific shapes based on actual property access.
 */

// === Workflow Query Params ===

export interface GetWorkflowDataParams {
  workflowId?: string
  data_type?: string
  dataType?: string
}

export interface GetBlockOutputsParams {
  workflowId?: string
  blockIds?: string[]
}

export interface GetBlockUpstreamReferencesParams {
  workflowId?: string
  blockIds: string[]
}

export interface ListFoldersParams {
  workspaceId?: string
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
  /** When true, runs the deployed version instead of the draft. Default: false (draft). */
  useDeployedState?: boolean
}

export interface RunWorkflowUntilBlockParams {
  workflowId?: string
  workflow_input?: unknown
  input?: unknown
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

// === Deployment Params ===

export interface DeployApiParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy'
}

export interface DeployChatParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy' | 'update'
  identifier?: string
  title?: string
  description?: string
  customizations?: {
    primaryColor?: string
    secondaryColor?: string
    welcomeMessage?: string
    iconUrl?: string
  }
  authType?: 'none' | 'password' | 'public' | 'email' | 'sso'
  password?: string
  subdomain?: string
  allowedEmails?: string[]
  outputConfigs?: unknown[]
}

export interface DeployMcpParams {
  workflowId?: string
  action?: 'deploy' | 'undeploy'
  toolName?: string
  toolDescription?: string
  serverId?: string
  parameterSchema?: Record<string, unknown>
}

export interface CheckDeploymentStatusParams {
  workflowId?: string
}

export interface ListWorkspaceMcpServersParams {
  workspaceId?: string
  workflowId?: string
}

export interface CreateWorkspaceMcpServerParams {
  workflowId?: string
  name?: string
  description?: string
  toolName?: string
  toolDescription?: string
  serverName?: string
  isPublic?: boolean
  workflowIds?: string[]
}

// === Workflow Organization Params ===

export interface RenameWorkflowParams {
  workflowId: string
  name: string
}

export interface MoveWorkflowParams {
  workflowId: string
  folderId: string | null
}

export interface MoveFolderParams {
  folderId: string
  parentId: string | null
}
