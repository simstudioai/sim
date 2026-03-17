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
  superagent: Blimp,
  user_table: TableIcon,
  workspace_file: File,
  create_workflow: Layout,
  edit_workflow: Pencil,
  build: Hammer,
  run: PlayOutline,
  deploy: Rocket,
  auth: Integration,
  knowledge: Database,
  knowledge_base: Database,
  table: TableIcon,
  job: Calendar,
  agent: AgentIcon,
  custom_tool: Wrench,
  research: Search,
  plan: ClipboardList,
  debug: Bug,
  edit: Pencil,
  fast_edit: Pencil,
  open_resource: Eye,
}

export function getAgentIcon(name: string): IconComponent {
  return TOOL_ICONS[name as keyof typeof TOOL_ICONS] ?? Blimp
}

export function getToolIcon(name: string): IconComponent | undefined {
  const icon = TOOL_ICONS[name as keyof typeof TOOL_ICONS]
  return icon === Blimp ? undefined : icon
}
