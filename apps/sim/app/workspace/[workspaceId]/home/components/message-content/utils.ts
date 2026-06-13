import type { ComponentType, SVGProps } from 'react'
import {
  Asterisk,
  Blimp,
  Bug,
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
import { Calendar, Table as TableIcon } from '@/components/emcn/icons'
import { AgentIcon, ImageIcon, TTSIcon, VideoIcon } from '@/components/icons'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_ICONS: Record<string, IconComponent> = {
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
  edit_content: File,
  create_workflow: Layout,
  edit_workflow: Pencil,
  workflow: Hammer,
  debug: Bug,
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
  context_compaction: Asterisk,
  open_resource: Eye,
  file: File,
  media: VideoIcon,
  generate_image: ImageIcon,
  generate_video: VideoIcon,
  generate_audio: TTSIcon,
  ffmpeg: Wrench,
}

export function getAgentIcon(name: string): IconComponent {
  return TOOL_ICONS[name as keyof typeof TOOL_ICONS] ?? Blimp
}

export function getToolIcon(name: string): IconComponent | undefined {
  const icon = TOOL_ICONS[name as keyof typeof TOOL_ICONS]
  return icon === Blimp ? undefined : icon
}
