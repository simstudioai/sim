import {
  buildCanonicalIndex,
  buildSubBlockValues,
  evaluateSubBlockCondition,
  hasAdvancedValues,
  isSubBlockFeatureEnabled,
  isSubBlockVisibleForMode,
  type SubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { BlockState, SubBlockState, WorkflowState } from '@/stores/workflows/workflow/types'

// Credential types based on actual patterns in the codebase
export enum CredentialType {
  OAUTH = 'oauth',
  SECRET = 'secret', // password: true (covers API keys, bot tokens, passwords, etc.)
}

// Type for credential requirement
export interface CredentialRequirement {
  type: CredentialType
  serviceId?: string // For OAuth (e.g., 'google-drive', 'slack')
  label: string // Human-readable label
  blockType: string // The block type that requires this
  subBlockId: string // The subblock ID for reference
  required: boolean
}

// Workspace-specific subblock types that should be cleared
const WORKSPACE_SPECIFIC_TYPES = new Set([
  'knowledge-base-selector',
  'knowledge-tag-filters',
  'document-selector',
  'document-tag-entry',
  'file-selector', // Workspace files
  'file-upload', // Uploaded files in workspace
  'project-selector', // Workspace-specific projects
  'channel-selector', // Workspace-specific channels
  'folder-selector', // User-specific folders
  'mcp-server-selector', // User-specific MCP servers
])

// Field IDs that are workspace-specific
const WORKSPACE_SPECIFIC_FIELDS = new Set([
  'knowledgeBaseId',
  'tagFilters',
  'documentTags',
  'documentId',
  'fileId',
  'projectId',
  'channelId',
  'folderId',
])

/**
 * Extract required credentials from a workflow state
 * This analyzes all blocks and their subblocks to identify credential requirements
 */
export function extractRequiredCredentials(
  state: Partial<WorkflowState> | null | undefined
): CredentialRequirement[] {
  const credentials: CredentialRequirement[] = []
  const seen = new Set<string>()

  if (!state?.blocks) {
    return credentials
  }

  // Process each block
  Object.values(state.blocks).forEach((block: BlockState) => {
    if (!block?.type) return

    const blockConfig = getBlock(block.type)
    if (!blockConfig) return

    // Add OAuth credential if block has OAuth auth mode
    if (blockConfig.authMode === AuthMode.OAuth) {
      const blockName = blockConfig.name || block.type
      const key = `oauth-${block.type}`

      if (!seen.has(key)) {
        seen.add(key)
        credentials.push({
          type: CredentialType.OAUTH,
          serviceId: block.type,
          label: `Credential for ${blockName}`,
          blockType: block.type,
          subBlockId: 'oauth',
          required: true,
        })
      }
    }

    // Process password fields (API keys, tokens, etc)
    blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
      if (!isSubBlockVisible(block, subBlockConfig)) return
      if (!subBlockConfig.password) return

      const blockName = blockConfig.name || block.type
      const suffix = block?.triggerMode ? ' Trigger' : ''
      const fieldLabel = subBlockConfig.title || formatFieldName(subBlockConfig.id)
      const key = `secret-${block.type}-${subBlockConfig.id}-${block?.triggerMode ? 'trigger' : 'default'}`

      if (!seen.has(key)) {
        seen.add(key)
        credentials.push({
          type: CredentialType.SECRET,
          label: `${fieldLabel} for ${blockName}${suffix}`,
          blockType: block.type,
          subBlockId: subBlockConfig.id,
          required: subBlockConfig.required !== false,
        })
      }
    })
  })

  /** Helper to check visibility, respecting mode and conditions */
  function isSubBlockVisible(block: BlockState, subBlockConfig: SubBlockConfig): boolean {
    if (!isSubBlockFeatureEnabled(subBlockConfig)) return false

    const values = buildSubBlockValues(block?.subBlocks || {})
    const blockConfig = getBlock(block.type)
    const blockSubBlocks = blockConfig?.subBlocks || []
    const canonicalIndex = buildCanonicalIndex(blockSubBlocks)
    const effectiveAdvanced =
      (block?.advancedMode ?? false) || hasAdvancedValues(blockSubBlocks, values, canonicalIndex)
    const canonicalModeOverrides = block.data?.canonicalModes

    if (subBlockConfig.mode === 'trigger' && !block?.triggerMode) return false
    if (block?.triggerMode && subBlockConfig.mode && subBlockConfig.mode !== 'trigger') return false

    if (
      !isSubBlockVisibleForMode(
        subBlockConfig,
        effectiveAdvanced,
        canonicalIndex,
        values,
        canonicalModeOverrides
      )
    ) {
      return false
    }

    return evaluateSubBlockCondition(subBlockConfig.condition as SubBlockCondition, values)
  }

  // Sort: OAuth first, then secrets, alphabetically within each type
  credentials.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === CredentialType.OAUTH ? -1 : 1
    }
    return a.label.localeCompare(b.label)
  })

  return credentials
}

/**
 * Format field name to be human-readable
 */
function formatFieldName(fieldName: string): string {
  return fieldName
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/** Block state with mutable subBlocks for sanitization */
interface MutableBlockState extends Omit<BlockState, 'subBlocks'> {
  subBlocks: Record<string, SubBlockState | null | undefined>
  data?: Record<string, unknown>
}

/**
 * Remove malformed subBlocks from a block that may have been created by bugs.
 * This includes subBlocks with:
 * - Key "undefined" (caused by assigning to undefined key)
 * - Missing required `id` field
 * - Type "unknown" (indicates malformed data)
 */
function removeMalformedSubBlocks(block: MutableBlockState): void {
  if (!block.subBlocks) return

  const keysToRemove: string[] = []

  Object.entries(block.subBlocks).forEach(([key, subBlock]) => {
    // Flag subBlocks with invalid keys (literal "undefined" string)
    if (key === 'undefined') {
      keysToRemove.push(key)
      return
    }

    // Flag subBlocks that are null or not objects
    if (!subBlock || typeof subBlock !== 'object') {
      keysToRemove.push(key)
      return
    }

    // Flag subBlocks with type "unknown" (malformed data)
    // Cast to string for comparison since SubBlockType doesn't include 'unknown'
    if ((subBlock.type as string) === 'unknown') {
      keysToRemove.push(key)
      return
    }

    // Flag subBlocks missing required id field
    if (!subBlock.id) {
      keysToRemove.push(key)
    }
  })

  // Remove the flagged keys
  keysToRemove.forEach((key) => {
    delete block.subBlocks[key]
  })
}

/** Sanitized workflow state structure */
interface SanitizedWorkflowState {
  blocks?: Record<string, MutableBlockState>
  [key: string]: unknown
}

/**
 * Sanitize workflow state by removing all credentials and workspace-specific data
 * This is used for both template creation and workflow export to ensure consistency
 *
 * @param state - The workflow state to sanitize
 * @param options - Options for sanitization behavior
 */
export function sanitizeWorkflowForSharing(
  state: Partial<WorkflowState> | null | undefined,
  options: {
    preserveEnvVars?: boolean // Keep {{VAR}} references for export
  } = {}
): SanitizedWorkflowState {
  const sanitized = JSON.parse(JSON.stringify(state)) as SanitizedWorkflowState // Deep clone

  if (!sanitized?.blocks) {
    return sanitized
  }

  Object.values(sanitized.blocks).forEach((block: MutableBlockState) => {
    if (!block?.type) return

    // First, remove any malformed subBlocks that may have been created by bugs
    removeMalformedSubBlocks(block)

    const blockConfig = getBlock(block.type)

    // Process subBlocks with config
    if (blockConfig) {
      blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
        if (block.subBlocks?.[subBlockConfig.id]) {
          const subBlock = block.subBlocks[subBlockConfig.id]

          // Clear OAuth credentials (type: 'oauth-input')
          if (subBlockConfig.type === 'oauth-input') {
            block.subBlocks[subBlockConfig.id]!.value = null
          }

          // Clear secret fields (password: true)
          else if (subBlockConfig.password === true) {
            // Preserve environment variable references if requested
            if (
              options.preserveEnvVars &&
              typeof subBlock?.value === 'string' &&
              subBlock.value.startsWith('{{') &&
              subBlock.value.endsWith('}}')
            ) {
              // Keep the env var reference
            } else {
              block.subBlocks[subBlockConfig.id]!.value = null
            }
          }

          // Clear workspace-specific selectors
          else if (WORKSPACE_SPECIFIC_TYPES.has(subBlockConfig.type)) {
            block.subBlocks[subBlockConfig.id]!.value = null
          }

          // Clear workspace-specific fields by ID
          else if (WORKSPACE_SPECIFIC_FIELDS.has(subBlockConfig.id)) {
            block.subBlocks[subBlockConfig.id]!.value = null
          }
        }
      })
    }

    // Process subBlocks without config (fallback)
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]) => {
        // Clear workspace-specific fields by key name
        if (WORKSPACE_SPECIFIC_FIELDS.has(key) && subBlock) {
          subBlock.value = null
        }
      })
    }

    // Clear data field (for backward compatibility)
    if (block.data) {
      Object.entries(block.data).forEach(([key]) => {
        // Clear anything that looks like credentials
        if (/credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key)) {
          block.data![key] = null
        }
        // Clear workspace-specific data
        if (WORKSPACE_SPECIFIC_FIELDS.has(key)) {
          block.data![key] = null
        }
      })
    }
  })

  return sanitized
}

/**
 * Sanitize workflow state for templates (removes credentials and workspace data)
 * Wrapper for backward compatibility
 */
export function sanitizeCredentials(
  state: Partial<WorkflowState> | null | undefined
): SanitizedWorkflowState {
  return sanitizeWorkflowForSharing(state, { preserveEnvVars: false })
}

/**
 * Sanitize workflow state for export (preserves env vars)
 * Convenience wrapper for workflow export
 */
export function sanitizeForExport(
  state: Partial<WorkflowState> | null | undefined
): SanitizedWorkflowState {
  return sanitizeWorkflowForSharing(state, { preserveEnvVars: true })
}
