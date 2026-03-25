// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated from copilot/contracts/tool-catalog-v1.json
//

export interface ToolCatalogEntry {
  clientExecutable?: boolean
  executor: 'client' | 'go' | 'sim' | 'subagent'
  hidden?: boolean
  id:
    | 'agent'
    | 'agent_respond'
    | 'auth'
    | 'auth_respond'
    | 'build'
    | 'build_respond'
    | 'check_deployment_status'
    | 'complete_job'
    | 'context_write'
    | 'crawl_website'
    | 'create_folder'
    | 'create_job'
    | 'create_workflow'
    | 'create_workspace_mcp_server'
    | 'debug'
    | 'debug_respond'
    | 'delete_folder'
    | 'delete_workflow'
    | 'delete_workspace_mcp_server'
    | 'deploy'
    | 'deploy_api'
    | 'deploy_chat'
    | 'deploy_mcp'
    | 'deploy_respond'
    | 'download_to_workspace_file'
    | 'edit_respond'
    | 'edit_workflow'
    | 'fast_edit_respond'
    | 'file_write'
    | 'function_execute'
    | 'generate_api_key'
    | 'generate_image'
    | 'generate_visualization'
    | 'get_block_outputs'
    | 'get_block_upstream_references'
    | 'get_deployed_workflow_state'
    | 'get_deployment_version'
    | 'get_execution_summary'
    | 'get_job_logs'
    | 'get_page_contents'
    | 'get_platform_actions'
    | 'get_workflow_data'
    | 'get_workflow_logs'
    | 'glob'
    | 'grep'
    | 'job'
    | 'job_respond'
    | 'knowledge'
    | 'knowledge_base'
    | 'knowledge_respond'
    | 'list_folders'
    | 'list_user_workspaces'
    | 'list_workspace_mcp_servers'
    | 'manage_credential'
    | 'manage_custom_tool'
    | 'manage_job'
    | 'manage_mcp_tool'
    | 'manage_skill'
    | 'materialize_file'
    | 'oauth_get_auth_link'
    | 'oauth_request_access'
    | 'open_resource'
    | 'plan_respond'
    | 'read'
    | 'redeploy'
    | 'research'
    | 'research_respond'
    | 'revert_to_version'
    | 'run'
    | 'run_block'
    | 'run_from_block'
    | 'run_respond'
    | 'run_workflow'
    | 'run_workflow_until_block'
    | 'scrape_page'
    | 'search_documentation'
    | 'search_library_docs'
    | 'search_online'
    | 'search_patterns'
    | 'set_environment_variables'
    | 'set_global_workflow_variables'
    | 'superagent'
    | 'superagent_respond'
    | 'table'
    | 'table_respond'
    | 'tool_search_tool_regex'
    | 'update_job_history'
    | 'update_workspace_mcp_server'
    | 'user_memory'
    | 'user_table'
    | 'workspace_file'
  internal?: boolean
  mode: 'async' | 'sync'
  name:
    | 'agent'
    | 'agent_respond'
    | 'auth'
    | 'auth_respond'
    | 'build'
    | 'build_respond'
    | 'check_deployment_status'
    | 'complete_job'
    | 'context_write'
    | 'crawl_website'
    | 'create_folder'
    | 'create_job'
    | 'create_workflow'
    | 'create_workspace_mcp_server'
    | 'debug'
    | 'debug_respond'
    | 'delete_folder'
    | 'delete_workflow'
    | 'delete_workspace_mcp_server'
    | 'deploy'
    | 'deploy_api'
    | 'deploy_chat'
    | 'deploy_mcp'
    | 'deploy_respond'
    | 'download_to_workspace_file'
    | 'edit_respond'
    | 'edit_workflow'
    | 'fast_edit_respond'
    | 'file_write'
    | 'function_execute'
    | 'generate_api_key'
    | 'generate_image'
    | 'generate_visualization'
    | 'get_block_outputs'
    | 'get_block_upstream_references'
    | 'get_deployed_workflow_state'
    | 'get_deployment_version'
    | 'get_execution_summary'
    | 'get_job_logs'
    | 'get_page_contents'
    | 'get_platform_actions'
    | 'get_workflow_data'
    | 'get_workflow_logs'
    | 'glob'
    | 'grep'
    | 'job'
    | 'job_respond'
    | 'knowledge'
    | 'knowledge_base'
    | 'knowledge_respond'
    | 'list_folders'
    | 'list_user_workspaces'
    | 'list_workspace_mcp_servers'
    | 'manage_credential'
    | 'manage_custom_tool'
    | 'manage_job'
    | 'manage_mcp_tool'
    | 'manage_skill'
    | 'materialize_file'
    | 'oauth_get_auth_link'
    | 'oauth_request_access'
    | 'open_resource'
    | 'plan_respond'
    | 'read'
    | 'redeploy'
    | 'research'
    | 'research_respond'
    | 'revert_to_version'
    | 'run'
    | 'run_block'
    | 'run_from_block'
    | 'run_respond'
    | 'run_workflow'
    | 'run_workflow_until_block'
    | 'scrape_page'
    | 'search_documentation'
    | 'search_library_docs'
    | 'search_online'
    | 'search_patterns'
    | 'set_environment_variables'
    | 'set_global_workflow_variables'
    | 'superagent'
    | 'superagent_respond'
    | 'table'
    | 'table_respond'
    | 'tool_search_tool_regex'
    | 'update_job_history'
    | 'update_workspace_mcp_server'
    | 'user_memory'
    | 'user_table'
    | 'workspace_file'
  requiredPermission?: 'admin' | 'write'
  requiresConfirmation?: boolean
  subagentId?:
    | 'agent'
    | 'auth'
    | 'build'
    | 'debug'
    | 'deploy'
    | 'file_write'
    | 'job'
    | 'knowledge'
    | 'research'
    | 'run'
    | 'superagent'
    | 'table'
}

export const Agent: ToolCatalogEntry = {
  id: 'agent',
  name: 'agent',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'agent',
  internal: true,
  requiredPermission: 'write',
}

export const AgentRespond: ToolCatalogEntry = {
  id: 'agent_respond',
  name: 'agent_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const Auth: ToolCatalogEntry = {
  id: 'auth',
  name: 'auth',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'auth',
  internal: true,
}

export const AuthRespond: ToolCatalogEntry = {
  id: 'auth_respond',
  name: 'auth_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const Build: ToolCatalogEntry = {
  id: 'build',
  name: 'build',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'build',
  internal: true,
}

export const BuildRespond: ToolCatalogEntry = {
  id: 'build_respond',
  name: 'build_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const CheckDeploymentStatus: ToolCatalogEntry = {
  id: 'check_deployment_status',
  name: 'check_deployment_status',
  executor: 'sim',
  mode: 'async',
}

export const CompleteJob: ToolCatalogEntry = {
  id: 'complete_job',
  name: 'complete_job',
  executor: 'sim',
  mode: 'async',
}

export const ContextWrite: ToolCatalogEntry = {
  id: 'context_write',
  name: 'context_write',
  executor: 'go',
  mode: 'sync',
}

export const CrawlWebsite: ToolCatalogEntry = {
  id: 'crawl_website',
  name: 'crawl_website',
  executor: 'go',
  mode: 'sync',
}

export const CreateFolder: ToolCatalogEntry = {
  id: 'create_folder',
  name: 'create_folder',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const CreateJob: ToolCatalogEntry = {
  id: 'create_job',
  name: 'create_job',
  executor: 'sim',
  mode: 'async',
}

export const CreateWorkflow: ToolCatalogEntry = {
  id: 'create_workflow',
  name: 'create_workflow',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const CreateWorkspaceMcpServer: ToolCatalogEntry = {
  id: 'create_workspace_mcp_server',
  name: 'create_workspace_mcp_server',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const Debug: ToolCatalogEntry = {
  id: 'debug',
  name: 'debug',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'debug',
  internal: true,
}

export const DebugRespond: ToolCatalogEntry = {
  id: 'debug_respond',
  name: 'debug_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const DeleteFolder: ToolCatalogEntry = {
  id: 'delete_folder',
  name: 'delete_folder',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'write',
}

export const DeleteWorkflow: ToolCatalogEntry = {
  id: 'delete_workflow',
  name: 'delete_workflow',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'write',
}

export const DeleteWorkspaceMcpServer: ToolCatalogEntry = {
  id: 'delete_workspace_mcp_server',
  name: 'delete_workspace_mcp_server',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const Deploy: ToolCatalogEntry = {
  id: 'deploy',
  name: 'deploy',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'deploy',
  internal: true,
}

export const DeployApi: ToolCatalogEntry = {
  id: 'deploy_api',
  name: 'deploy_api',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const DeployChat: ToolCatalogEntry = {
  id: 'deploy_chat',
  name: 'deploy_chat',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const DeployMcp: ToolCatalogEntry = {
  id: 'deploy_mcp',
  name: 'deploy_mcp',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const DeployRespond: ToolCatalogEntry = {
  id: 'deploy_respond',
  name: 'deploy_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const DownloadToWorkspaceFile: ToolCatalogEntry = {
  id: 'download_to_workspace_file',
  name: 'download_to_workspace_file',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const EditRespond: ToolCatalogEntry = {
  id: 'edit_respond',
  name: 'edit_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const EditWorkflow: ToolCatalogEntry = {
  id: 'edit_workflow',
  name: 'edit_workflow',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const FastEditRespond: ToolCatalogEntry = {
  id: 'fast_edit_respond',
  name: 'fast_edit_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const FileWrite: ToolCatalogEntry = {
  id: 'file_write',
  name: 'file_write',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'file_write',
  internal: true,
}

export const FunctionExecute: ToolCatalogEntry = {
  id: 'function_execute',
  name: 'function_execute',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const GenerateApiKey: ToolCatalogEntry = {
  id: 'generate_api_key',
  name: 'generate_api_key',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const GenerateImage: ToolCatalogEntry = {
  id: 'generate_image',
  name: 'generate_image',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const GenerateVisualization: ToolCatalogEntry = {
  id: 'generate_visualization',
  name: 'generate_visualization',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const GetBlockOutputs: ToolCatalogEntry = {
  id: 'get_block_outputs',
  name: 'get_block_outputs',
  executor: 'sim',
  mode: 'async',
}

export const GetBlockUpstreamReferences: ToolCatalogEntry = {
  id: 'get_block_upstream_references',
  name: 'get_block_upstream_references',
  executor: 'sim',
  mode: 'async',
}

export const GetDeployedWorkflowState: ToolCatalogEntry = {
  id: 'get_deployed_workflow_state',
  name: 'get_deployed_workflow_state',
  executor: 'sim',
  mode: 'async',
}

export const GetDeploymentVersion: ToolCatalogEntry = {
  id: 'get_deployment_version',
  name: 'get_deployment_version',
  executor: 'sim',
  mode: 'async',
}

export const GetExecutionSummary: ToolCatalogEntry = {
  id: 'get_execution_summary',
  name: 'get_execution_summary',
  executor: 'sim',
  mode: 'async',
}

export const GetJobLogs: ToolCatalogEntry = {
  id: 'get_job_logs',
  name: 'get_job_logs',
  executor: 'sim',
  mode: 'async',
}

export const GetPageContents: ToolCatalogEntry = {
  id: 'get_page_contents',
  name: 'get_page_contents',
  executor: 'go',
  mode: 'sync',
}

export const GetPlatformActions: ToolCatalogEntry = {
  id: 'get_platform_actions',
  name: 'get_platform_actions',
  executor: 'sim',
  mode: 'async',
}

export const GetWorkflowData: ToolCatalogEntry = {
  id: 'get_workflow_data',
  name: 'get_workflow_data',
  executor: 'sim',
  mode: 'async',
}

export const GetWorkflowLogs: ToolCatalogEntry = {
  id: 'get_workflow_logs',
  name: 'get_workflow_logs',
  executor: 'sim',
  mode: 'async',
}

export const Glob: ToolCatalogEntry = {
  id: 'glob',
  name: 'glob',
  executor: 'sim',
  mode: 'async',
}

export const Grep: ToolCatalogEntry = {
  id: 'grep',
  name: 'grep',
  executor: 'sim',
  mode: 'async',
}

export const Job: ToolCatalogEntry = {
  id: 'job',
  name: 'job',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'job',
  internal: true,
}

export const JobRespond: ToolCatalogEntry = {
  id: 'job_respond',
  name: 'job_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const Knowledge: ToolCatalogEntry = {
  id: 'knowledge',
  name: 'knowledge',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'knowledge',
  internal: true,
}

export const KnowledgeBase: ToolCatalogEntry = {
  id: 'knowledge_base',
  name: 'knowledge_base',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
}

export const KnowledgeRespond: ToolCatalogEntry = {
  id: 'knowledge_respond',
  name: 'knowledge_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const ListFolders: ToolCatalogEntry = {
  id: 'list_folders',
  name: 'list_folders',
  executor: 'sim',
  mode: 'async',
}

export const ListUserWorkspaces: ToolCatalogEntry = {
  id: 'list_user_workspaces',
  name: 'list_user_workspaces',
  executor: 'sim',
  mode: 'async',
}

export const ListWorkspaceMcpServers: ToolCatalogEntry = {
  id: 'list_workspace_mcp_servers',
  name: 'list_workspace_mcp_servers',
  executor: 'sim',
  mode: 'async',
}

export const ManageCredential: ToolCatalogEntry = {
  id: 'manage_credential',
  name: 'manage_credential',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const ManageCustomTool: ToolCatalogEntry = {
  id: 'manage_custom_tool',
  name: 'manage_custom_tool',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
}

export const ManageJob: ToolCatalogEntry = {
  id: 'manage_job',
  name: 'manage_job',
  executor: 'sim',
  mode: 'async',
}

export const ManageMcpTool: ToolCatalogEntry = {
  id: 'manage_mcp_tool',
  name: 'manage_mcp_tool',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'write',
}

export const ManageSkill: ToolCatalogEntry = {
  id: 'manage_skill',
  name: 'manage_skill',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'write',
}

export const MaterializeFile: ToolCatalogEntry = {
  id: 'materialize_file',
  name: 'materialize_file',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const OauthGetAuthLink: ToolCatalogEntry = {
  id: 'oauth_get_auth_link',
  name: 'oauth_get_auth_link',
  executor: 'sim',
  mode: 'async',
}

export const OauthRequestAccess: ToolCatalogEntry = {
  id: 'oauth_request_access',
  name: 'oauth_request_access',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
}

export const OpenResource: ToolCatalogEntry = {
  id: 'open_resource',
  name: 'open_resource',
  executor: 'sim',
  mode: 'async',
}

export const PlanRespond: ToolCatalogEntry = {
  id: 'plan_respond',
  name: 'plan_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const Read: ToolCatalogEntry = {
  id: 'read',
  name: 'read',
  executor: 'sim',
  mode: 'async',
}

export const Redeploy: ToolCatalogEntry = {
  id: 'redeploy',
  name: 'redeploy',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const Research: ToolCatalogEntry = {
  id: 'research',
  name: 'research',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'research',
  internal: true,
}

export const ResearchRespond: ToolCatalogEntry = {
  id: 'research_respond',
  name: 'research_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const RevertToVersion: ToolCatalogEntry = {
  id: 'revert_to_version',
  name: 'revert_to_version',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const Run: ToolCatalogEntry = {
  id: 'run',
  name: 'run',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'run',
  internal: true,
}

export const RunBlock: ToolCatalogEntry = {
  id: 'run_block',
  name: 'run_block',
  executor: 'client',
  mode: 'async',
  clientExecutable: true,
  requiresConfirmation: true,
}

export const RunFromBlock: ToolCatalogEntry = {
  id: 'run_from_block',
  name: 'run_from_block',
  executor: 'client',
  mode: 'async',
  clientExecutable: true,
  requiresConfirmation: true,
}

export const RunRespond: ToolCatalogEntry = {
  id: 'run_respond',
  name: 'run_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const RunWorkflow: ToolCatalogEntry = {
  id: 'run_workflow',
  name: 'run_workflow',
  executor: 'client',
  mode: 'async',
  clientExecutable: true,
  requiresConfirmation: true,
}

export const RunWorkflowUntilBlock: ToolCatalogEntry = {
  id: 'run_workflow_until_block',
  name: 'run_workflow_until_block',
  executor: 'client',
  mode: 'async',
  clientExecutable: true,
  requiresConfirmation: true,
}

export const ScrapePage: ToolCatalogEntry = {
  id: 'scrape_page',
  name: 'scrape_page',
  executor: 'go',
  mode: 'sync',
}

export const SearchDocumentation: ToolCatalogEntry = {
  id: 'search_documentation',
  name: 'search_documentation',
  executor: 'sim',
  mode: 'async',
}

export const SearchLibraryDocs: ToolCatalogEntry = {
  id: 'search_library_docs',
  name: 'search_library_docs',
  executor: 'go',
  mode: 'sync',
}

export const SearchOnline: ToolCatalogEntry = {
  id: 'search_online',
  name: 'search_online',
  executor: 'go',
  mode: 'sync',
}

export const SearchPatterns: ToolCatalogEntry = {
  id: 'search_patterns',
  name: 'search_patterns',
  executor: 'go',
  mode: 'sync',
}

export const SetEnvironmentVariables: ToolCatalogEntry = {
  id: 'set_environment_variables',
  name: 'set_environment_variables',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'write',
}

export const SetGlobalWorkflowVariables: ToolCatalogEntry = {
  id: 'set_global_workflow_variables',
  name: 'set_global_workflow_variables',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'write',
}

export const Superagent: ToolCatalogEntry = {
  id: 'superagent',
  name: 'superagent',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'superagent',
  internal: true,
}

export const SuperagentRespond: ToolCatalogEntry = {
  id: 'superagent_respond',
  name: 'superagent_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const Table: ToolCatalogEntry = {
  id: 'table',
  name: 'table',
  executor: 'subagent',
  mode: 'async',
  subagentId: 'table',
  internal: true,
}

export const TableRespond: ToolCatalogEntry = {
  id: 'table_respond',
  name: 'table_respond',
  executor: 'sim',
  mode: 'async',
  internal: true,
  hidden: true,
}

export const ToolSearchToolRegex: ToolCatalogEntry = {
  id: 'tool_search_tool_regex',
  name: 'tool_search_tool_regex',
  executor: 'sim',
  mode: 'async',
}

export const UpdateJobHistory: ToolCatalogEntry = {
  id: 'update_job_history',
  name: 'update_job_history',
  executor: 'sim',
  mode: 'async',
}

export const UpdateWorkspaceMcpServer: ToolCatalogEntry = {
  id: 'update_workspace_mcp_server',
  name: 'update_workspace_mcp_server',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
  requiredPermission: 'admin',
}

export const UserMemory: ToolCatalogEntry = {
  id: 'user_memory',
  name: 'user_memory',
  executor: 'go',
  mode: 'sync',
}

export const UserTable: ToolCatalogEntry = {
  id: 'user_table',
  name: 'user_table',
  executor: 'sim',
  mode: 'async',
  requiresConfirmation: true,
}

export const WorkspaceFile: ToolCatalogEntry = {
  id: 'workspace_file',
  name: 'workspace_file',
  executor: 'sim',
  mode: 'async',
  requiredPermission: 'write',
}

export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {
  [Agent.id]: Agent,
  [AgentRespond.id]: AgentRespond,
  [Auth.id]: Auth,
  [AuthRespond.id]: AuthRespond,
  [Build.id]: Build,
  [BuildRespond.id]: BuildRespond,
  [CheckDeploymentStatus.id]: CheckDeploymentStatus,
  [CompleteJob.id]: CompleteJob,
  [ContextWrite.id]: ContextWrite,
  [CrawlWebsite.id]: CrawlWebsite,
  [CreateFolder.id]: CreateFolder,
  [CreateJob.id]: CreateJob,
  [CreateWorkflow.id]: CreateWorkflow,
  [CreateWorkspaceMcpServer.id]: CreateWorkspaceMcpServer,
  [Debug.id]: Debug,
  [DebugRespond.id]: DebugRespond,
  [DeleteFolder.id]: DeleteFolder,
  [DeleteWorkflow.id]: DeleteWorkflow,
  [DeleteWorkspaceMcpServer.id]: DeleteWorkspaceMcpServer,
  [Deploy.id]: Deploy,
  [DeployApi.id]: DeployApi,
  [DeployChat.id]: DeployChat,
  [DeployMcp.id]: DeployMcp,
  [DeployRespond.id]: DeployRespond,
  [DownloadToWorkspaceFile.id]: DownloadToWorkspaceFile,
  [EditRespond.id]: EditRespond,
  [EditWorkflow.id]: EditWorkflow,
  [FastEditRespond.id]: FastEditRespond,
  [FileWrite.id]: FileWrite,
  [FunctionExecute.id]: FunctionExecute,
  [GenerateApiKey.id]: GenerateApiKey,
  [GenerateImage.id]: GenerateImage,
  [GenerateVisualization.id]: GenerateVisualization,
  [GetBlockOutputs.id]: GetBlockOutputs,
  [GetBlockUpstreamReferences.id]: GetBlockUpstreamReferences,
  [GetDeployedWorkflowState.id]: GetDeployedWorkflowState,
  [GetDeploymentVersion.id]: GetDeploymentVersion,
  [GetExecutionSummary.id]: GetExecutionSummary,
  [GetJobLogs.id]: GetJobLogs,
  [GetPageContents.id]: GetPageContents,
  [GetPlatformActions.id]: GetPlatformActions,
  [GetWorkflowData.id]: GetWorkflowData,
  [GetWorkflowLogs.id]: GetWorkflowLogs,
  [Glob.id]: Glob,
  [Grep.id]: Grep,
  [Job.id]: Job,
  [JobRespond.id]: JobRespond,
  [Knowledge.id]: Knowledge,
  [KnowledgeBase.id]: KnowledgeBase,
  [KnowledgeRespond.id]: KnowledgeRespond,
  [ListFolders.id]: ListFolders,
  [ListUserWorkspaces.id]: ListUserWorkspaces,
  [ListWorkspaceMcpServers.id]: ListWorkspaceMcpServers,
  [ManageCredential.id]: ManageCredential,
  [ManageCustomTool.id]: ManageCustomTool,
  [ManageJob.id]: ManageJob,
  [ManageMcpTool.id]: ManageMcpTool,
  [ManageSkill.id]: ManageSkill,
  [MaterializeFile.id]: MaterializeFile,
  [OauthGetAuthLink.id]: OauthGetAuthLink,
  [OauthRequestAccess.id]: OauthRequestAccess,
  [OpenResource.id]: OpenResource,
  [PlanRespond.id]: PlanRespond,
  [Read.id]: Read,
  [Redeploy.id]: Redeploy,
  [Research.id]: Research,
  [ResearchRespond.id]: ResearchRespond,
  [RevertToVersion.id]: RevertToVersion,
  [Run.id]: Run,
  [RunBlock.id]: RunBlock,
  [RunFromBlock.id]: RunFromBlock,
  [RunRespond.id]: RunRespond,
  [RunWorkflow.id]: RunWorkflow,
  [RunWorkflowUntilBlock.id]: RunWorkflowUntilBlock,
  [ScrapePage.id]: ScrapePage,
  [SearchDocumentation.id]: SearchDocumentation,
  [SearchLibraryDocs.id]: SearchLibraryDocs,
  [SearchOnline.id]: SearchOnline,
  [SearchPatterns.id]: SearchPatterns,
  [SetEnvironmentVariables.id]: SetEnvironmentVariables,
  [SetGlobalWorkflowVariables.id]: SetGlobalWorkflowVariables,
  [Superagent.id]: Superagent,
  [SuperagentRespond.id]: SuperagentRespond,
  [Table.id]: Table,
  [TableRespond.id]: TableRespond,
  [ToolSearchToolRegex.id]: ToolSearchToolRegex,
  [UpdateJobHistory.id]: UpdateJobHistory,
  [UpdateWorkspaceMcpServer.id]: UpdateWorkspaceMcpServer,
  [UserMemory.id]: UserMemory,
  [UserTable.id]: UserTable,
  [WorkspaceFile.id]: WorkspaceFile,
}
