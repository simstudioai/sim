import type { ComponentType, SVGProps } from 'react'
import {
  Asterisk,
  BubbleChatPreview,
  Connections,
  Database,
  Eye,
  File,
  FolderCode,
  Key,
  Library,
  ListFilter,
  Loader,
  Pencil,
  Play,
  Rocket,
  Rows3,
  Search,
  Settings,
  TerminalWindow,
} from '@/components/emcn'
import type { MothershipToolName, SubagentName } from '../../types'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_ICONS: Record<MothershipToolName | SubagentName, IconComponent> = {
  glob: FolderCode,
  grep: Search,
  read: File,
  search_online: Search,
  scrape_page: Search,
  get_page_contents: Search,
  search_library_docs: Library,
  manage_mcp_tool: Settings,
  manage_skill: Asterisk,
  user_memory: Database,
  function_execute: TerminalWindow,
  superagent: Play,
  user_table: Rows3,
  workspace_file: File,
  create_workflow: Connections,
  edit_workflow: Pencil,
  build: Connections,
  run: Play,
  deploy: Rocket,
  auth: Key,
  knowledge: Database,
  table: Rows3,
  job: Loader,
  agent: BubbleChatPreview,
  custom_tool: Settings,
  research: Search,
  plan: ListFilter,
  debug: Eye,
  edit: Pencil,
}

export function getToolIcon(name: string): IconComponent | undefined {
  return TOOL_ICONS[name as MothershipToolName | SubagentName]
}
