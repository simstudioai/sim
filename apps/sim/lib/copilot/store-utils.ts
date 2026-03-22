import { createLogger } from '@sim/logger'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bug,
  Cloud,
  Code,
  FileText,
  Folder,
  Globe,
  HelpCircle,
  Key,
  Loader2,
  Lock,
  Pencil,
  Play,
  Plus,
  Rocket,
  Search,
  Server,
  Settings,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react'
import {
  ClientToolCallState,
  type ClientToolDisplay,
  TOOL_DISPLAY_REGISTRY,
} from '@/lib/copilot/tools/client/tool-display-registry'

const logger = createLogger('CopilotStoreUtils')

/** Respond tools are internal to copilot subagents and should never be shown in the UI */
const HIDDEN_TOOL_SUFFIX = '_respond'

/** UI metadata sent by the copilot on SSE tool_call events. */
export interface ServerToolUI {
  title?: string
  phaseLabel?: string
  icon?: string
}

/** Maps copilot icon name strings to Lucide icon components. */
const ICON_MAP: Record<string, LucideIcon> = {
  search: Search,
  globe: Globe,
  hammer: Wrench,
  rocket: Rocket,
  lock: Lock,
  book: BookOpen,
  wrench: Wrench,
  zap: Zap,
  play: Play,
  cloud: Cloud,
  key: Key,
  pencil: Pencil,
  terminal: Terminal,
  workflow: Settings,
  settings: Settings,
  server: Server,
  bug: Bug,
  brain: BookOpen,
  code: Code,
  help: HelpCircle,
  plus: Plus,
  file: FileText,
  folder: Folder,
}

function resolveIcon(iconName: string | undefined): LucideIcon {
  if (!iconName) return Loader2
  return ICON_MAP[iconName] || Loader2
}

export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  _toolCallId?: string,
  params?: Record<string, unknown>,
  serverUI?: ServerToolUI
): ClientToolDisplay | undefined {
  if (!toolName) return undefined
  if (toolName.endsWith(HIDDEN_TOOL_SUFFIX)) return undefined
  const entry = TOOL_DISPLAY_REGISTRY[toolName]
  if (!entry) {
    // Use copilot-provided UI as a better fallback than humanized name
    if (serverUI?.title) {
      return serverUIFallback(serverUI, state)
    }
    return humanizedFallback(toolName, state)
  }

  if (entry.uiConfig?.dynamicText && params) {
    const dynamicText = entry.uiConfig.dynamicText(params, state)
    const stateDisplay = entry.displayNames[state]
    if (dynamicText && stateDisplay?.icon) {
      return { text: dynamicText, icon: stateDisplay.icon }
    }
  }

  const display = entry.displayNames[state]
  if (display?.text || display?.icon) return display

  const fallbackOrder = [
    ClientToolCallState.generating,
    ClientToolCallState.executing,
    ClientToolCallState.success,
  ]
  for (const fallbackState of fallbackOrder) {
    const fallback = entry.displayNames[fallbackState]
    if (fallback?.text || fallback?.icon) return fallback
  }

  return humanizedFallback(toolName, state)
}

/** Generates display from copilot-provided UI metadata. */
function serverUIFallback(serverUI: ServerToolUI, state: ClientToolCallState): ClientToolDisplay {
  const icon = resolveIcon(serverUI.icon)
  const title = serverUI.title!

  switch (state) {
    case ClientToolCallState.success:
      return { text: `Completed ${title.toLowerCase()}`, icon }
    case ClientToolCallState.error:
      return { text: `Failed ${title.toLowerCase()}`, icon }
    case ClientToolCallState.rejected:
      return { text: `Skipped ${title.toLowerCase()}`, icon }
    case ClientToolCallState.aborted:
      return { text: `Aborted ${title.toLowerCase()}`, icon }
    default:
      return { text: title, icon: Loader2 }
  }
}

export function humanizedFallback(
  toolName: string,
  state: ClientToolCallState
): ClientToolDisplay | undefined {
  const formattedName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const stateVerb =
    state === ClientToolCallState.success
      ? 'Executed'
      : state === ClientToolCallState.error
        ? 'Failed'
        : state === ClientToolCallState.rejected || state === ClientToolCallState.aborted
          ? 'Skipped'
          : 'Executing'
  return { text: `${stateVerb} ${formattedName}`, icon: Loader2 }
}

export function isRejectedState(state: string): boolean {
  return state === 'rejected'
}

export function isReviewState(state: string): boolean {
  return state === 'review'
}

export function isBackgroundState(state: string): boolean {
  return state === 'background'
}

export function isTerminalState(state: string): boolean {
  return (
    state === ClientToolCallState.success ||
    state === ClientToolCallState.error ||
    state === ClientToolCallState.rejected ||
    state === ClientToolCallState.aborted ||
    isReviewState(state) ||
    isBackgroundState(state)
  )
}

export function stripTodoTags(text: string): string {
  if (!text) return text
  return text
    .replace(/<marktodo>[\s\S]*?<\/marktodo>/g, '')
    .replace(/<checkofftodo>[\s\S]*?<\/checkofftodo>/g, '')
    .replace(/<design_workflow>[\s\S]*?<\/design_workflow>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
}
