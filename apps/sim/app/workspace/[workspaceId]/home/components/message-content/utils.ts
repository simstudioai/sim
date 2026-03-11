import type { ComponentType, SVGProps } from 'react'
import {
  Asterisk,
  Blimp,
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
  Search,
  Settings,
  TerminalWindow,
} from '@/components/emcn'
import { Table as TableIcon } from '@/components/emcn/icons'
import type { MothershipToolName, SubagentName } from '../../types'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_ICONS: Record<MothershipToolName | SubagentName | 'mothership', IconComponent> = {
  mothership: Blimp,
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
  user_table: TableIcon,
  workspace_file: File,
  create_workflow: Connections,
  edit_workflow: Pencil,
  build: Connections,
  run: Play,
  deploy: Rocket,
  auth: Key,
  knowledge: Database,
  table: TableIcon,
  job: Loader,
  agent: BubbleChatPreview,
  custom_tool: Settings,
  research: Search,
  plan: ListFilter,
  debug: Eye,
  edit: Pencil,
}

export function getAgentIcon(name: string): IconComponent {
  return TOOL_ICONS[name as keyof typeof TOOL_ICONS] ?? Blimp
}

export function getToolIcon(name: string): IconComponent | undefined {
  const icon = TOOL_ICONS[name as keyof typeof TOOL_ICONS]
  return icon === Blimp ? undefined : icon
}
