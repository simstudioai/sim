import type { ComponentType, SVGProps } from 'react'
import {
  Asterisk,
  Blimp,
  Bug,
  Calendar,
  ClipboardList,
  Database,
  Eye,
  File,
  FolderCode,
  Hammer,
  Integration,
  Layout,
  Library,
  Pencil,
  PlayOutline,
  Rocket,
  Search,
  Settings,
  TerminalWindow,
  Wrench,
} from '@/components/emcn'
import { Table as TableIcon } from '@/components/emcn/icons'
import { AgentIcon } from '@/components/icons'
import type { MothershipToolName, SubagentName } from '@/app/workspace/[workspaceId]/home/types'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_ICONS: Record<MothershipToolName | SubagentName | 'mothership', IconComponent> = {
  mothership: Blimp,
  // Workspace
  glob: FolderCode,
  grep: Search,
  read: File,
  // Search
  search_online: Search,
  scrape_page: Search,
  get_page_contents: Search,
  search_library_docs: Library,
  crawl_website: Search,
  // Execution
  function_execute: TerminalWindow,
  superagent: Blimp,
  run_workflow: PlayOutline,
  run_block: PlayOutline,
  run_from_block: PlayOutline,
  run_workflow_until_block: PlayOutline,
  complete_job: PlayOutline,
  get_execution_summary: ClipboardList,
  get_job_logs: ClipboardList,
  get_workflow_logs: ClipboardList,
  get_workflow_data: Layout,
  get_block_outputs: ClipboardList,
  get_block_upstream_references: ClipboardList,
  get_deployed_workflow_state: Rocket,
  check_deployment_status: Rocket,
  // Workflows & folders
  create_workflow: Layout,
  delete_workflow: Layout,
  edit_workflow: Pencil,
  rename_workflow: Pencil,
  move_workflow: Layout,
  create_folder: FolderCode,
  delete_folder: FolderCode,
  move_folder: FolderCode,
  list_folders: FolderCode,
  list_user_workspaces: Layout,
  revert_to_version: Rocket,
  get_deployment_version: Rocket,
  open_resource: Eye,
  // Files
  workspace_file: File,
  download_to_workspace_file: File,
  materialize_file: File,
  generate_image: File,
  generate_visualization: File,
  // Tables & knowledge
  user_table: TableIcon,
  knowledge_base: Database,
  // Jobs
  create_job: Calendar,
  manage_job: Calendar,
  update_job_history: Calendar,
  // Management
  manage_mcp_tool: Settings,
  manage_skill: Asterisk,
  manage_credential: Integration,
  manage_custom_tool: Wrench,
  update_workspace_mcp_server: Settings,
  delete_workspace_mcp_server: Settings,
  create_workspace_mcp_server: Settings,
  list_workspace_mcp_servers: Settings,
  oauth_get_auth_link: Integration,
  oauth_request_access: Integration,
  set_environment_variables: Settings,
  set_global_workflow_variables: Settings,
  get_platform_actions: Settings,
  search_documentation: Library,
  search_patterns: Search,
  deploy_api: Rocket,
  deploy_chat: Rocket,
  deploy_mcp: Rocket,
  redeploy: Rocket,
  generate_api_key: Asterisk,
  user_memory: Database,
  context_write: Pencil,
  context_compaction: Asterisk,
  // Subagents
  build: Hammer,
  run: PlayOutline,
  deploy: Rocket,
  auth: Integration,
  knowledge: Database,
  table: TableIcon,
  job: Calendar,
  agent: AgentIcon,
  custom_tool: Wrench,
  research: Search,
  plan: ClipboardList,
  debug: Bug,
  edit: Pencil,
  fast_edit: Pencil,
  file_write: File,
}

export function getAgentIcon(name: string): IconComponent {
  return TOOL_ICONS[name as keyof typeof TOOL_ICONS] ?? Blimp
}

export function getToolIcon(name: string): IconComponent | undefined {
  const icon = TOOL_ICONS[name as keyof typeof TOOL_ICONS]
  return icon === Blimp ? undefined : icon
}
