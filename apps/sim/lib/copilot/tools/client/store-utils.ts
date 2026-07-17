import type { ComponentType } from 'react'
import { Loader } from '@sim/emcn'
import { FileText } from 'lucide-react'
import { Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resources/types'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-call-state'
import { decodeVfsSegmentSafe } from '@/lib/copilot/vfs/path-utils'

/** Respond tools are internal handoff tools shown with a friendly generic label. */
const HIDDEN_TOOL_SUFFIX = '_respond'
const INTERNAL_RESPOND_TOOL = 'respond'

interface ClientToolDisplay {
  text: string
  icon: ComponentType<{ className?: string }>
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
      icon: Loader,
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
      return `Attempted to read${suffix}`
    case ClientToolCallState.rejected:
    case ClientToolCallState.aborted:
      return `Skipped reading${suffix}`
    default:
      return `Reading${suffix}`
  }
}

function describeReadTarget(path: string | undefined): string | undefined {
  if (!path) return undefined

  const block = getReadTargetBlock(path)
  if (block) return block.name

  const segments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(decodeVfsSegmentSafe)

  if (segments.length === 0) return undefined

  const resourceType = VFS_DIR_TO_RESOURCE[segments[0]]
  if (!resourceType) {
    return stripExtension(segments[segments.length - 1])
  }

  if (resourceType === 'file') {
    return describeFileReadTarget(segments)
  }

  if (resourceType === 'workflow') {
    return stripExtension(getLeafResourceSegment(segments))
  }

  const resourceName = segments[1] || segments[segments.length - 1]
  return stripExtension(resourceName)
}

// A workspace file is addressed as a directory of facets in the VFS
// (files/{...path}/{name}/{facet}). `content` is the default facet — reading a
// file means reading its content — so it carries no qualifier, matching a bare
// `files/{...path}/{name}` read. The remaining facets are genuinely distinct, so
// they keep a descriptive label.
const FILE_FACET_LABELS: Record<string, string> = {
  content: '',
  'meta.json': 'metadata for',
  style: 'style details for',
  'compiled-check': 'the final file check for',
}

function describeFileReadTarget(segments: string[]): string {
  const lastSegment = segments[segments.length - 1] || ''
  const facetLabel = FILE_FACET_LABELS[lastSegment]
  // Treat the suffix as a facet only when a real file name precedes it; otherwise
  // the leaf is the file itself (e.g. a file literally named "content").
  if (facetLabel !== undefined && segments.length > 2) {
    const fileName = segments[segments.length - 2]
    return facetLabel ? `${facetLabel} ${fileName}` : fileName
  }
  // Show just the file name, not the folder path — these are glanceable status
  // lines, and the other resource types already render the leaf only.
  return lastSegment
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
  const titleCaseName = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  if (state === ClientToolCallState.error) {
    const lowerCaseName = toolName.replace(/_/g, ' ').toLowerCase()
    return { text: `Attempted to ${lowerCaseName}`, icon: Loader }
  }
  const stateVerb =
    state === ClientToolCallState.success
      ? 'Executed'
      : state === ClientToolCallState.rejected || state === ClientToolCallState.aborted
        ? 'Skipped'
        : 'Executing'
  return { text: `${stateVerb} ${titleCaseName}`, icon: Loader }
}
