/**
 * Typed parameter interfaces for tool executor functions.
 * Replaces Record<string, any> with specific shapes based on actual property access.
 */

// === Workflow Query Params ===

export interface GetUserWorkflowParams {
  workflowId?: string
}

export interface GetWorkflowFromNameParams {
  workflow_name?: string
}

export interface ListUserWorkflowsParams {
  workspaceId?: string
  folderId?: string
}

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
