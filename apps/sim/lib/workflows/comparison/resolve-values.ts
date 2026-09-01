import { createLogger } from '@sim/logger'
import { truncate } from '@sim/utils/string'
import {
  executeSelectorRequest,
  loadAllSelectorOptions,
} from '@/lib/selectors/client/execute-selector'
import { buildSelectorRawContext, projectSelectorContext } from '@/lib/selectors/context'
import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import type { SelectorContext, SelectorScope } from '@/lib/selectors/types'
import { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
import { getBlock } from '@/blocks/registry'
import { SELECTOR_TYPES_HYDRATION_REQUIRED, type SubBlockConfig } from '@/blocks/types'
import { isUuid } from '@/executor/constants'
import { fetchOAuthCredentialDetail } from '@/hooks/queries/oauth/oauth-credentials'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { formatParameterLabel } from '@/tools/params'

const logger = createLogger('ResolveValues')

/**
 * Result of resolving a value for display
 */
interface ResolvedValue {
  /** The original value before resolution */
  original: unknown
  /** Human-readable label for display */
  displayLabel: string
  /** Whether the value was successfully resolved to a name */
  resolved: boolean
}

/**
 * Context needed to resolve values for display
 */
interface ResolutionContext {
  /** The block type (e.g., 'slack', 'gmail') */
  blockType: string
  /** The subBlock field ID (e.g., 'channel', 'credential') */
  subBlockId: string
  /** The workflow ID for API calls */
  workflowId: string
  /** The workspace scope for selector-based lookups */
  workspaceId?: string
  /** The current workflow state for extracting additional context */
  currentState: WorkflowState
  /** The block ID being resolved */
  blockId?: string
}

function getSemanticFallback(subBlockConfig: SubBlockConfig): string {
  return (subBlockConfig.title ?? subBlockConfig.id).toLowerCase()
}

async function resolveCredential(credentialId: string, workflowId: string): Promise<string | null> {
  try {
    const credentials = await fetchOAuthCredentialDetail(credentialId, workflowId)
    if (credentials.length > 0) {
      return credentials[0].name ?? null
    }

    return null
  } catch {
    logger.warn('Failed to resolve credential display label')
    return null
  }
}

async function resolveWorkflow(workflowId: string, workspaceId?: string): Promise<string | null> {
  if (!workspaceId) return null

  try {
    const result = await executeSelectorRequest({
      selectorKey: 'sim.workflows',
      scope: { kind: 'workspace', workspaceId },
      context: {},
      request: { kind: 'detail', id: workflowId },
    })
    return result.kind === 'detail' ? (result.item?.label ?? null) : null
  } catch {
    logger.warn('Failed to resolve workflow display label')
    return null
  }
}

async function resolveSelectorValue(
  value: string,
  selectorKey: SelectorKey,
  selectorContext: SelectorContext,
  scope: SelectorScope
): Promise<string | null> {
  try {
    const manifest = getSelectorManifestEntry(selectorKey)

    if (manifest.supportsDetail) {
      const result = await executeSelectorRequest({
        selectorKey,
        scope,
        context: selectorContext,
        request: { kind: 'detail', id: value },
      })
      if (result.kind === 'detail' && result.item?.label) {
        return result.item.label
      }
    }

    const options = await loadAllSelectorOptions({
      selectorKey,
      scope,
      context: selectorContext,
    })
    const match = options.find((opt) => opt.id === value)
    return match?.label ?? null
  } catch {
    logger.warn('Failed to resolve selector display label', { selectorKey })
    return null
  }
}

function extractMcpToolName(toolId: string): string {
  const withoutPrefix = toolId.startsWith('mcp-') ? toolId.slice(4) : toolId
  const parts = withoutPrefix.split('_')
  if (parts.length >= 2) {
    return parts[parts.length - 1]
  }
  return withoutPrefix
}

/**
 * Resolves a subBlock field ID to its human-readable title.
 * Falls back to the raw ID if the block or subBlock is not found.
 */
export function resolveFieldLabel(blockType: string, subBlockId: string): string {
  if (subBlockId.startsWith('data.')) {
    return formatParameterLabel(subBlockId.slice(5))
  }
  const blockConfig = getBlock(blockType)
  if (!blockConfig) return subBlockId
  const subBlockConfig = blockConfig.subBlocks.find((sb) => sb.id === subBlockId)
  return subBlockConfig?.title ?? subBlockId
}

/**
 * Resolves a dropdown option ID to its human-readable label.
 * Returns null if the subBlock is not a dropdown or the value is not found.
 */
function resolveDropdownLabel(subBlockConfig: SubBlockConfig, value: string): string | null {
  if (subBlockConfig.type !== 'dropdown') return null
  if (!subBlockConfig.options) return null
  const options =
    typeof subBlockConfig.options === 'function' ? subBlockConfig.options() : subBlockConfig.options
  const match = options.find((opt) => opt.id === value)
  return match?.label ?? null
}

/**
 * Formats a value for display in diff descriptions.
 */
export function formatValueForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '(none)'
  if (typeof value === 'string') {
    if (value.length > 50) return truncate(value, 50)
    return value || '(empty)'
  }
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') {
    const json = JSON.stringify(value)
    return truncate(json, 50)
  }
  return String(value)
}

function extractSelectorContext(
  blockId: string,
  currentState: WorkflowState,
  selectorKey: SelectorKey,
  subBlockConfig: SubBlockConfig
): SelectorContext {
  const block = currentState.blocks?.[blockId]
  if (!block?.subBlocks) return {}
  return buildSelectorRawContext({
    selectorKey,
    blockType: block.type,
    subBlocks: block.subBlocks,
    dependsOn: getDependsOnFields(subBlockConfig.dependsOn),
    canonicalModes: block.data?.canonicalModes,
    triggerMode: block.triggerMode,
    staticContext: { mimeType: subBlockConfig.mimeType },
  })
}

/**
 * Resolves a value to a human-readable display label.
 * Uses the selector registry infrastructure to resolve IDs to names.
 *
 * @param value - The value to resolve (credential ID, channel ID, UUID, etc.)
 * @param context - Context needed for resolution (block type, subBlock ID, workflow state)
 * @returns ResolvedValue with the display label and resolution status
 */
export async function resolveValueForDisplay(
  value: unknown,
  context: ResolutionContext
): Promise<ResolvedValue> {
  if (typeof value !== 'string' || !value) {
    return {
      original: value,
      displayLabel: formatValueForDisplay(value),
      resolved: false,
    }
  }

  const blockConfig = getBlock(context.blockType)
  const subBlockConfig = blockConfig?.subBlocks.find((sb) => sb.id === context.subBlockId)
  if (!subBlockConfig) {
    return { original: value, displayLabel: formatValueForDisplay(value), resolved: false }
  }
  const semanticFallback = getSemanticFallback(subBlockConfig)

  const isCredentialField =
    subBlockConfig.type === 'oauth-input' || context.subBlockId === 'credential'

  if (isCredentialField && isUuid(value)) {
    const label = await resolveCredential(value, context.workflowId)
    if (label) {
      return { original: value, displayLabel: label, resolved: true }
    }
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  if (subBlockConfig.type === 'workflow-selector' && isUuid(value)) {
    const label = await resolveWorkflow(value, context.workspaceId)
    if (label) {
      return { original: value, displayLabel: label, resolved: true }
    }
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  if (subBlockConfig.type === 'mcp-tool-selector') {
    const toolName = extractMcpToolName(value)
    return { original: value, displayLabel: toolName, resolved: true }
  }

  if (subBlockConfig.type === 'dropdown') {
    try {
      const label = resolveDropdownLabel(subBlockConfig, value)
      if (label) {
        return { original: value, displayLabel: label, resolved: true }
      }
    } catch {
      logger.warn('Failed to resolve dropdown display label')
    }
  }

  if (SELECTOR_TYPES_HYDRATION_REQUIRED.includes(subBlockConfig.type)) {
    const selectorKey = subBlockConfig.selectorKey
    const scope: SelectorScope | undefined = context.workflowId
      ? {
          kind: 'workflow',
          workflowId: context.workflowId,
          ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        }
      : context.workspaceId
        ? { kind: 'workspace', workspaceId: context.workspaceId }
        : undefined
    if (selectorKey && scope) {
      const selectorContext = context.blockId
        ? extractSelectorContext(context.blockId, context.currentState, selectorKey, subBlockConfig)
        : projectSelectorContext(selectorKey, { mimeType: subBlockConfig.mimeType })
      const label = await resolveSelectorValue(value, selectorKey, selectorContext, scope)
      if (label) {
        return { original: value, displayLabel: label, resolved: true }
      }
    }
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  if (isUuid(value)) {
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  if (/^C[A-Z0-9]{8,}$/.test(value) || /^[UW][A-Z0-9]{8,}$/.test(value)) {
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  return {
    original: value,
    displayLabel: formatValueForDisplay(value),
    resolved: false,
  }
}
