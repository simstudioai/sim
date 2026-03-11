import type { ComponentType, SVGProps } from 'react'
import {
  Asterisk,
  Blimp,
  BubbleChatPreview,
  Bug,
  Calendar,
  ClipboardList,
  Connections,
  Database,
  File,
  FolderCode,
  Hammer,
  Integration,
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
  create_workflow: Connections,
  edit_workflow: Pencil,
  build: Hammer,
  run: PlayOutline,
  deploy: Rocket,
  auth: Integration,
  knowledge: Database,
  table: TableIcon,
  job: Calendar,
  agent: BubbleChatPreview,
  custom_tool: Wrench,
  research: Search,
  plan: ClipboardList,
  debug: Bug,
  edit: Pencil,
}

export function getAgentIcon(name: string): IconComponent {
  return TOOL_ICONS[name as keyof typeof TOOL_ICONS] ?? Blimp
}

export function getToolIcon(name: string): IconComponent | undefined {
  const icon = TOOL_ICONS[name as keyof typeof TOOL_ICONS]
  return icon === Blimp ? undefined : icon
}
