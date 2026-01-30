import { createLogger } from '@sim/logger'
import { getBlock } from '@/blocks/registry'
import { SELECTOR_TYPES_HYDRATION_REQUIRED, type SubBlockConfig } from '@/blocks/types'
import { CREDENTIAL_SET, isUuid } from '@/executor/constants'
import { fetchCredentialSetById } from '@/hooks/queries/credential-sets'
import { fetchOAuthCredentialDetail } from '@/hooks/queries/oauth-credentials'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import { resolveSelectorForSubBlock } from '@/hooks/selectors/resolution'
import type { SelectorKey } from '@/hooks/selectors/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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
  /** The current workflow state for extracting additional context */
  currentState: WorkflowState
  /** The block ID being resolved */
  blockId?: string
}

/**
 * Extended context extracted from block subBlocks for selector resolution
 */
interface ExtendedSelectorContext {
  credentialId?: string
  domain?: string
  projectId?: string
  planId?: string
  teamId?: string
  knowledgeBaseId?: string
  siteId?: string
  collectionId?: string
  spreadsheetId?: string
}

function getSemanticFallback(subBlockId: string, subBlockConfig?: SubBlockConfig): string {
  if (subBlockConfig?.title) {
    return subBlockConfig.title.toLowerCase()
  }

  const patterns: Record<string, string> = {
    credential: 'credential',
    channel: 'channel',
    channelId: 'channel',
    user: 'user',
    userId: 'user',
    workflow: 'workflow',
    workflowId: 'workflow',
    file: 'file',
    fileId: 'file',
    folder: 'folder',
    folderId: 'folder',
    project: 'project',
    projectId: 'project',
    team: 'team',
    teamId: 'team',
    sheet: 'sheet',
    sheetId: 'sheet',
    document: 'document',
    documentId: 'document',
    knowledgeBase: 'knowledge base',
    knowledgeBaseId: 'knowledge base',
    server: 'server',
    serverId: 'server',
    tool: 'tool',
    toolId: 'tool',
    calendar: 'calendar',
    calendarId: 'calendar',
    label: 'label',
    labelId: 'label',
    site: 'site',
    siteId: 'site',
    collection: 'collection',
    collectionId: 'collection',
    item: 'item',
    itemId: 'item',
    contact: 'contact',
    contactId: 'contact',
    task: 'task',
    taskId: 'task',
    chat: 'chat',
    chatId: 'chat',
  }

  return patterns[subBlockId] || 'value'
}

async function resolveCredential(credentialId: string, workflowId: string): Promise<string | null> {
  try {
    if (credentialId.startsWith(CREDENTIAL_SET.PREFIX)) {
      const setId = credentialId.slice(CREDENTIAL_SET.PREFIX.length)
      const credentialSet = await fetchCredentialSetById(setId)
      return credentialSet?.name ?? null
    }

    const credentials = await fetchOAuthCredentialDetail(credentialId, workflowId)
    if (credentials.length > 0) {
      return credentials[0].name ?? null
    }

    return null
  } catch (error) {
    logger.warn('Failed to resolve credential', { credentialId, error })
    return null
  }
}

async function resolveWorkflow(workflowId: string): Promise<string | null> {
  try {
    const definition = getSelectorDefinition('sim.workflows')
    if (definition.fetchById) {
      const result = await definition.fetchById({
        key: 'sim.workflows',
        context: {},
        detailId: workflowId,
      })
      return result?.label ?? null
    }
    return null
  } catch (error) {
    logger.warn('Failed to resolve workflow', { workflowId, error })
    return null
  }
}

async function resolveSelectorValue(
  value: string,
  selectorKey: SelectorKey,
  extendedContext: ExtendedSelectorContext,
  workflowId: string
): Promise<string | null> {
  try {
    const definition = getSelectorDefinition(selectorKey)
    const selectorContext = {
      workflowId,
      credentialId: extendedContext.credentialId,
      domain: extendedContext.domain,
      projectId: extendedContext.projectId,
      planId: extendedContext.planId,
      teamId: extendedContext.teamId,
      knowledgeBaseId: extendedContext.knowledgeBaseId,
      siteId: extendedContext.siteId,
      collectionId: extendedContext.collectionId,
      spreadsheetId: extendedContext.spreadsheetId,
    }

    if (definition.fetchById) {
      const result = await definition.fetchById({
        key: selectorKey,
        context: selectorContext,
        detailId: value,
      })
      if (result?.label) {
        return result.label
      }
    }

    const options = await definition.fetchList({
      key: selectorKey,
      context: selectorContext,
    })
    const match = options.find((opt) => opt.id === value)
    return match?.label ?? null
  } catch (error) {
    logger.warn('Failed to resolve selector value', { value, selectorKey, error })
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
 * Formats a value for display in diff descriptions.
 */
export function formatValueForDisplay(value: unknown): string {
  if (value === null || value === undefined) return '(none)'
  if (typeof value === 'string') {
    if (value.length > 50) return `${value.slice(0, 50)}...`
    return value || '(empty)'
  }
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'object') return `${JSON.stringify(value).slice(0, 50)}...`
  return String(value)
}

/**
 * Extracts extended context from a block's subBlocks for selector resolution.
 * This mirrors the context extraction done in the UI components.
 */
function extractExtendedContext(
  blockId: string,
  currentState: WorkflowState
): ExtendedSelectorContext {
  const block = currentState.blocks?.[blockId]
  if (!block?.subBlocks) return {}

  const getStringValue = (id: string): string | undefined => {
    const subBlock = block.subBlocks[id] as { value?: unknown } | undefined
    const val = subBlock?.value
    return typeof val === 'string' ? val : undefined
  }

  return {
    credentialId: getStringValue('credential'),
    domain: getStringValue('domain'),
    projectId: getStringValue('projectId'),
    planId: getStringValue('planId'),
    teamId: getStringValue('teamId'),
    knowledgeBaseId: getStringValue('knowledgeBaseId'),
    siteId: getStringValue('siteId'),
    collectionId: getStringValue('collectionId'),
    spreadsheetId: getStringValue('spreadsheetId') || getStringValue('fileId'),
  }
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
  // Non-string or empty values can't be resolved
  if (typeof value !== 'string' || !value) {
    return {
      original: value,
      displayLabel: formatValueForDisplay(value),
      resolved: false,
    }
  }

  const blockConfig = getBlock(context.blockType)
  const subBlockConfig = blockConfig?.subBlocks.find((sb) => sb.id === context.subBlockId)
  const semanticFallback = getSemanticFallback(context.subBlockId, subBlockConfig)

  const extendedContext = context.blockId
    ? extractExtendedContext(context.blockId, context.currentState)
    : {}

  // Credential fields (oauth-input or credential subBlockId)
  const isCredentialField =
    subBlockConfig?.type === 'oauth-input' || context.subBlockId === 'credential'

  if (isCredentialField && (value.startsWith(CREDENTIAL_SET.PREFIX) || isUuid(value))) {
    const label = await resolveCredential(value, context.workflowId)
    if (label) {
      return { original: value, displayLabel: label, resolved: true }
    }
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  // Workflow selector
  if (subBlockConfig?.type === 'workflow-selector' && isUuid(value)) {
    const label = await resolveWorkflow(value)
    if (label) {
      return { original: value, displayLabel: label, resolved: true }
    }
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  // MCP tool selector
  if (subBlockConfig?.type === 'mcp-tool-selector') {
    const toolName = extractMcpToolName(value)
    return { original: value, displayLabel: toolName, resolved: true }
  }

  // Selector types that require hydration (file-selector, sheet-selector, etc.)
  // These support external service IDs like Google Drive file IDs
  if (subBlockConfig && SELECTOR_TYPES_HYDRATION_REQUIRED.includes(subBlockConfig.type)) {
    const resolution = resolveSelectorForSubBlock(subBlockConfig, {
      workflowId: context.workflowId,
      credentialId: extendedContext.credentialId,
      domain: extendedContext.domain,
      projectId: extendedContext.projectId,
      planId: extendedContext.planId,
      teamId: extendedContext.teamId,
      knowledgeBaseId: extendedContext.knowledgeBaseId,
      siteId: extendedContext.siteId,
      collectionId: extendedContext.collectionId,
      spreadsheetId: extendedContext.spreadsheetId,
    })

    if (resolution?.key) {
      const label = await resolveSelectorValue(
        value,
        resolution.key,
        extendedContext,
        context.workflowId
      )
      if (label) {
        return { original: value, displayLabel: label, resolved: true }
      }
    }
    // If resolution failed for a hydration-required type, use semantic fallback
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  // For fields without specific subBlock types, use pattern matching
  // UUID fallback
  if (isUuid(value)) {
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  // Slack-style IDs (channels: C..., users: U.../W...) get semantic fallback
  if (/^C[A-Z0-9]{8,}$/.test(value) || /^[UW][A-Z0-9]{8,}$/.test(value)) {
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  // Credential set prefix without credential field type
  if (value.startsWith(CREDENTIAL_SET.PREFIX)) {
    const label = await resolveCredential(value, context.workflowId)
    if (label) {
      return { original: value, displayLabel: label, resolved: true }
    }
    return { original: value, displayLabel: semanticFallback, resolved: true }
  }

  return {
    original: value,
    displayLabel: formatValueForDisplay(value),
    resolved: false,
  }
}
