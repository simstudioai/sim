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
} from '@sim/emcn'
import { Calendar, Table as TableIcon } from '@sim/emcn/icons'
import { AgentIcon, ImageIcon, TTSIcon, VideoIcon } from '@/components/icons'
import type { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

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
  run_code: TerminalWindow,
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
  search_knowledge_base: Database,
  table: TableIcon,
  query_user_table: TableIcon,
  scheduled_task: Calendar,
  job: Calendar,
  agent: AgentIcon,
  custom_tool: Wrench,
  research: Search,
  scout: Search,
  search: Search,
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

export type MessagePhase = 'streaming' | 'revealing' | 'settled'

interface DeriveMessagePhaseArgs {
  isStreaming: boolean
  isRevealing: boolean
}

export function deriveMessagePhase({
  isStreaming,
  isRevealing,
}: DeriveMessagePhaseArgs): MessagePhase {
  if (isStreaming) return 'streaming'
  if (isRevealing) return 'revealing'
  return 'settled'
}

type ToolDisplayState = 'spinner' | 'cancelled' | 'interrupted' | 'icon'

export function resolveToolDisplayState(status: ToolCallStatus): ToolDisplayState {
  // Pure projection of the tool's own status. A row spins iff it is genuinely
  // executing; every terminal status maps to a glyph. No transport/turn-live
  // gating — deterministic terminals (tool `result`, turn propagation) guarantee
  // a row never lingers `executing` after its work is done.
  if (status === 'executing') return 'spinner'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'interrupted') return 'interrupted'
  return 'icon'
}

export function isToolDone(status: ToolCallStatus): boolean {
  return (
    status === 'success' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'rejected' ||
    status === 'interrupted'
  )
}
