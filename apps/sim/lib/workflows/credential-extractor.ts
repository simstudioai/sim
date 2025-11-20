import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

// Credential types based on actual patterns in the codebase
export enum CredentialType {
  OAUTH = 'oauth',
  SECRET = 'secret', // password: true (covers API keys, bot tokens, passwords, etc.)
}

// Type for credential requirement
export interface CredentialRequirement {
  type: CredentialType
  provider?: string // For OAuth (e.g., 'google-drive', 'slack')
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
export function extractRequiredCredentials(state: any): CredentialRequirement[] {
  const credentials: CredentialRequirement[] = []
  const seen = new Set<string>()

  if (!state?.blocks) {
    return credentials
  }

  // Process each block
  Object.values(state.blocks).forEach((block: any) => {
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
          provider: block.type,
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

  // Helper to check visibility, respecting mode and conditions
  function isSubBlockVisible(block: any, subBlockConfig: SubBlockConfig): boolean {
    const mode = subBlockConfig.mode ?? 'both'
    if (mode === 'trigger' && !block?.triggerMode) return false
    if (mode === 'basic' && block?.advancedMode) return false
    if (mode === 'advanced' && !block?.advancedMode) return false

    if (!subBlockConfig.condition) return true

    const condition =
      typeof subBlockConfig.condition === 'function'
        ? subBlockConfig.condition()
        : subBlockConfig.condition

    const evaluate = (cond: any): boolean => {
      const currentValue = block?.subBlocks?.[cond.field]?.value
      const expected = cond.value

      let match =
        expected === undefined
          ? true
          : Array.isArray(expected)
            ? expected.includes(currentValue)
            : currentValue === expected

      if (cond.not) match = !match
      if (cond.and) match = match && evaluate(cond.and)

      return match
    }

    return evaluate(condition)
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

/**
 * Sanitize workflow state by removing all credentials and workspace-specific data
 * This is used for both template creation and workflow export to ensure consistency
 *
 * @param state - The workflow state to sanitize
 * @param options - Options for sanitization behavior
 */
export function sanitizeWorkflowForSharing(
  state: any,
  options: {
    preserveEnvVars?: boolean // Keep {{VAR}} references for export
  } = {}
): any {
  const sanitized = JSON.parse(JSON.stringify(state)) // Deep clone

  if (!sanitized?.blocks) {
    return sanitized
  }

  Object.values(sanitized.blocks).forEach((block: any) => {
    if (!block?.type) return

    const blockConfig = getBlock(block.type)

    // Process subBlocks with config
    if (blockConfig) {
      blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
        if (block.subBlocks?.[subBlockConfig.id]) {
          const subBlock = block.subBlocks[subBlockConfig.id]

          // Clear OAuth credentials (type: 'oauth-input')
          if (subBlockConfig.type === 'oauth-input') {
            block.subBlocks[subBlockConfig.id].value = ''
          }

          // Clear secret fields (password: true)
          else if (subBlockConfig.password === true) {
            // Preserve environment variable references if requested
            if (
              options.preserveEnvVars &&
              typeof subBlock.value === 'string' &&
              subBlock.value.startsWith('{{') &&
              subBlock.value.endsWith('}}')
            ) {
              // Keep the env var reference
            } else {
              block.subBlocks[subBlockConfig.id].value = ''
            }
          }

          // Clear workspace-specific selectors
          else if (WORKSPACE_SPECIFIC_TYPES.has(subBlockConfig.type)) {
            block.subBlocks[subBlockConfig.id].value = ''
          }

          // Clear workspace-specific fields by ID
          else if (WORKSPACE_SPECIFIC_FIELDS.has(subBlockConfig.id)) {
            block.subBlocks[subBlockConfig.id].value = ''
          }
        }
      })
    }

    // Process subBlocks without config (fallback)
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
        // Clear workspace-specific fields by key name
        if (WORKSPACE_SPECIFIC_FIELDS.has(key)) {
          subBlock.value = ''
        }
      })
    }

    // Clear data field (for backward compatibility)
    if (block.data) {
      Object.entries(block.data).forEach(([key, value]: [string, any]) => {
        // Clear anything that looks like credentials
        if (/credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key)) {
          block.data[key] = ''
        }
        // Clear workspace-specific data
        if (WORKSPACE_SPECIFIC_FIELDS.has(key)) {
          block.data[key] = ''
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
export function sanitizeCredentials(state: any): any {
  return sanitizeWorkflowForSharing(state, { preserveEnvVars: false })
}

/**
 * Sanitize workflow state for export (preserves env vars)
 * Convenience wrapper for workflow export
 */
export function sanitizeForExport(state: any): any {
  return sanitizeWorkflowForSharing(state, { preserveEnvVars: true })
}
