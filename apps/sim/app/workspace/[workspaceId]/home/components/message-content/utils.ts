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
import { Calendar, Clock, Cursor, Globe, Table as TableIcon } from '@sim/emcn/icons'
import { AgentIcon, ImageIcon, TTSIcon, VideoIcon } from '@/components/icons'
import type { ToolCallStatus } from '@/app/workspace/[workspaceId]/home/types'

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

const TOOL_ICONS: Record<string, IconComponent> = {
  mothership: Blimp,
  glob: FolderCode,
  grep: Search,
  read: File,
  mv: FolderCode,
  cp: Layout,
  mkdir: FolderCode,
  web_search: Search,
  web_scrape: Search,
  web_fetch: Search,
  search_library_docs: Library,
  manage_mcp_connection: Settings,
  manage_skill: Asterisk,
  user_memory: Database,
  run_function: TerminalWindow,
  run_code: TerminalWindow,
  superagent: Blimp,
  user_table: TableIcon,
  prepare_file_edit: File,
  apply_file_edit: File,
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
  job: Calendar,
  agent: AgentIcon,
  custom_tool: Wrench,
  research: Search,
  scout: Search,
  search: Search,
  platform: Library,
  context_compaction: Asterisk,
  open_resource: Eye,
  file: File,
  media: VideoIcon,
  generate_image: ImageIcon,
  generate_video: VideoIcon,
  generate_audio: TTSIcon,
  ffmpeg: Wrench,
  browser: Globe,
  browser_navigate: Cursor,
  browser_go_back: Cursor,
  browser_go_forward: Cursor,
  browser_reload: Cursor,
  browser_open_tab: Cursor,
  browser_switch_tab: Cursor,
  browser_close_tab: Cursor,
  browser_list_tabs: Cursor,
  browser_list_sessions: Globe,
  browser_list_downloads: File,
  browser_wait_for: Cursor,
  browser_snapshot: Eye,
  browser_find: Search,
  browser_read_text: File,
  browser_screenshot: Eye,
  browser_extract: Search,
  browser_click: Cursor,
  browser_type: Pencil,
  browser_press_key: Cursor,
  browser_scroll: Cursor,
  browser_select_option: Cursor,
  browser_set_checked: Cursor,
  browser_hover: Cursor,
  browser_zoom: Eye,
  browser_request_takeover: Cursor,
  terminal: TerminalWindow,
  terminal_run: TerminalWindow,
  terminal_input: TerminalWindow,
  terminal_read: TerminalWindow,
  terminal_kill: TerminalWindow,
  terminal_cwd: TerminalWindow,
  wait: Clock,
}

export function getAgentIcon(name: string): IconComponent {
  return TOOL_ICONS[name as keyof typeof TOOL_ICONS] ?? Blimp
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

type ToolDisplayState = 'spinner' | 'awaiting_approval' | 'cancelled' | 'interrupted' | 'icon'

export function resolveToolDisplayState(status: ToolCallStatus): ToolDisplayState {
  // Pure projection of the tool's own status. A row spins iff it is genuinely
  // executing; every terminal status maps to a glyph. No transport/turn-live
  // gating — deterministic terminals (tool `result`, turn propagation) guarantee
  // a row never lingers `executing` after its work is done.
  if (status === 'executing') return 'spinner'
  // Waiting on a person, not on work: the row renders a permission card rather
  // than a spinner, so it must not read as in-progress.
  if (status === 'awaiting_approval') return 'awaiting_approval'
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
