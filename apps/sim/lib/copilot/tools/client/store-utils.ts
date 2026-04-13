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
import { Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import {
  ClientToolCallState,
  type ClientToolDisplay,
  TOOL_DISPLAY_REGISTRY,
} from '@/lib/copilot/tools/client/tool-display-registry'

const logger = createLogger('CopilotStoreUtils')

/** Respond tools are internal handoff tools shown with a friendly generic label. */
const HIDDEN_TOOL_SUFFIX = '_respond'
const INTERNAL_RESPOND_TOOL = 'respond'
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
  if (isToolHiddenInUi(toolName)) return undefined

  const specialDisplay = specialToolDisplay(toolName, state, params)
  if (specialDisplay) return specialDisplay

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

function specialToolDisplay(
  toolName: string,
  state: ClientToolCallState,
  params?: Record<string, unknown>
): ClientToolDisplay | undefined {
  if (toolName === INTERNAL_RESPOND_TOOL || toolName.endsWith(HIDDEN_TOOL_SUFFIX)) {
    return {
      text: formatRespondLabel(state),
      icon: Loader2,
    }
  }

  if (toolName === ReadTool.id) {
    const target = describeReadTarget(readStringParam(params, 'path'))
    return {
      text: formatReadingLabel(target, state),
      icon: FileText,
    }
  }

  return undefined
}

function formatRespondLabel(state: ClientToolCallState): string {
  void state
  return 'Gathering thoughts'
}

function readStringParam(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function formatReadingLabel(target: string | undefined, state: ClientToolCallState): string {
  const suffix = target ? ` ${target}` : ''
  switch (state) {
    case ClientToolCallState.success:
      return `Read${suffix}`
    case ClientToolCallState.error:
      return `Failed reading${suffix}`
    case ClientToolCallState.rejected:
    case ClientToolCallState.aborted:
      return `Skipped reading${suffix}`
    default:
      return `Reading${suffix}`
  }
}

function describeReadTarget(path: string | undefined): string | undefined {
  if (!path) return undefined

  const segments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) return undefined

  const resourceType = VFS_DIR_TO_RESOURCE[segments[0]]
  if (!resourceType) {
    return stripExtension(segments[segments.length - 1])
  }

  if (resourceType === 'file') {
    return segments.slice(1).join('/') || segments[segments.length - 1]
  }

  const resourceName = segments[1] || segments[segments.length - 1]
  return stripExtension(resourceName)
}

function stripExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, '')
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

function humanizedFallback(
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
  return state === ClientToolCallState.rejected
}

export function isReviewState(state: string): boolean {
  return state === 'review'
}

export function isBackgroundState(state: string): boolean {
  return state === 'background'
}
