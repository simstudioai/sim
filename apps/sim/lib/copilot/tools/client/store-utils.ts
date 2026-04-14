import type { LucideIcon } from 'lucide-react'
import { FileText, Loader2 } from 'lucide-react'
import { Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-call-state'

/** Respond tools are internal handoff tools shown with a friendly generic label. */
const HIDDEN_TOOL_SUFFIX = '_respond'
const INTERNAL_RESPOND_TOOL = 'respond'

interface ClientToolDisplay {
  text: string
  icon: LucideIcon
}

export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  params?: Record<string, unknown>
): ClientToolDisplay | undefined {
  if (!toolName) return undefined
  if (isToolHiddenInUi(toolName)) return undefined

  const specialDisplay = specialToolDisplay(toolName, state, params)
  if (specialDisplay) return specialDisplay

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

  if (resourceType === 'workflow') {
    return stripExtension(getLeafResourceSegment(segments))
  }

  const resourceName = segments[1] || segments[segments.length - 1]
  return stripExtension(resourceName)
}

function getLeafResourceSegment(segments: string[]): string {
  const lastSegment = segments[segments.length - 1] || ''
  if (hasFileExtension(lastSegment) && segments.length > 1) {
    return segments[segments.length - 2] || lastSegment
  }
  return lastSegment
}

function hasFileExtension(value: string): boolean {
  return /\.[^/.]+$/.test(value)
}

function stripExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, '')
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
