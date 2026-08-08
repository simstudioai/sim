import type { ComponentType } from 'react'
import { Loader } from '@sim/emcn'
import { FileText } from '@sim/emcn/icons'
import { Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { getReadTargetBlock } from '@/lib/copilot/tools/client/read-block'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-call-state'
import {
  describeReadTarget,
  humanizeDisplayIdentifier,
  humanizeToolName,
} from '@/lib/copilot/tools/tool-display'

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
    const path = readStringParam(params, 'path')
    const target = describeReadTarget(path, getReadTargetBlock(path)?.name)
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
  const suffix = ` ${target || 'file'}`
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

function humanizedFallback(
  toolName: string,
  state: ClientToolCallState
): ClientToolDisplay | undefined {
  const titleCaseName = humanizeToolName(toolName)
  if (state === ClientToolCallState.error) {
    const lowerCaseName = humanizeDisplayIdentifier(toolName, 'sentence')
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
