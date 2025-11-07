import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('CredentialExtractor')

// Credential types based on actual patterns in the codebase
export enum CredentialType {
  OAUTH = 'oauth', // type: 'oauth-input'
  SECRET = 'secret', // password: true (covers API keys, bot tokens, passwords, etc.)
}

// Type for credential requirement
export interface CredentialRequirement {
  type: CredentialType
  provider?: string // For OAuth (e.g., 'google-drive', 'slack')
  serviceId?: string // For OAuth services
  label: string // Human-readable label
  blockType: string // The block type that requires this
  subBlockId: string // The subblock ID for reference
  required: boolean
  description?: string
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

// Map of known providers to friendly names
const PROVIDER_NAMES: Record<string, string> = {
  'google-drive': 'Google Drive',
  'google-sheets': 'Google Sheets',
  'google-forms': 'Google Forms',
  'google-calendar': 'Google Calendar',
  'google-contacts': 'Google Contacts',
  'google-gmail': 'Gmail',
  slack: 'Slack',
  discord: 'Discord',
  notion: 'Notion',
  github: 'GitHub',
  jira: 'Jira',
  linear: 'Linear',
  x: 'X (Twitter)',
  reddit: 'Reddit',
  onedrive: 'OneDrive',
  figma: 'Figma',
  salesforce: 'Salesforce',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  perplexity: 'Perplexity',
  groq: 'Groq',
  together: 'Together AI',
  replicate: 'Replicate',
  pinecone: 'Pinecone',
  weaviate: 'Weaviate',
  qdrant: 'Qdrant',
  chroma: 'Chroma',
  supabase: 'Supabase',
  mongodb: 'MongoDB',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
}

/**
 * Extract required credentials from a workflow state
 * This analyzes all blocks and their subblocks to identify credential requirements
 */
export function extractRequiredCredentials(state: any): CredentialRequirement[] {
  const credentials: CredentialRequirement[] = []
  const seenCredentials = new Set<string>()

  if (!state?.blocks) {
    return credentials
  }

  // Process each block
  Object.values(state.blocks).forEach((block: any) => {
    if (!block?.type) return

    // Get the block configuration to understand its subblocks
    const blockConfig = getBlock(block.type)
    if (!blockConfig) return

    // Process each subblock configuration
    blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
      const credentialReq = extractCredentialFromSubBlock(
        subBlockConfig,
        block.type,
        blockConfig.name || block.type
      )

      if (credentialReq) {
        // Create a unique key to avoid duplicates
        const key = `${credentialReq.type}-${credentialReq.provider || ''}-${credentialReq.serviceId || ''}-${credentialReq.blockType}`

        if (!seenCredentials.has(key)) {
          seenCredentials.add(key)
          credentials.push(credentialReq)
        }
      }
    })

    // Also check the actual subBlock values for OAuth inputs that weren't caught by config
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
        // Check if this looks like an OAuth credential that wasn't caught by the config
        if (shouldExtractAsCredential(subBlock)) {
          const credentialReq: CredentialRequirement = {
            type: CredentialType.OAUTH,
            label: formatFieldName(subBlockId),
            blockType: block.type,
            subBlockId,
            required: true,
            description: `${formatFieldName(subBlockId)} for ${blockConfig.name || block.type}`,
          }

          const key = `${credentialReq.type}-${credentialReq.label}-${credentialReq.blockType}`

          if (!seenCredentials.has(key)) {
            seenCredentials.add(key)
            credentials.push(credentialReq)
          }
        }
      })
    }
  })

  // Sort credentials by type and label for consistent display
  credentials.sort((a, b) => {
    if (a.type !== b.type) {
      // OAuth credentials come first, then secrets
      const typeOrder = {
        [CredentialType.OAUTH]: 0,
        [CredentialType.SECRET]: 1,
      }
      return typeOrder[a.type] - typeOrder[b.type]
    }
    return a.label.localeCompare(b.label)
  })

  logger.info(`Extracted ${credentials.length} credential requirements from workflow`)
  return credentials
}

/**
 * Extract credential requirement from a subblock configuration
 */
function extractCredentialFromSubBlock(
  subBlockConfig: SubBlockConfig,
  blockType: string,
  blockName: string
): CredentialRequirement | null {
  // Handle OAuth credentials (type: 'oauth-input')
  if (subBlockConfig.type === 'oauth-input') {
    return {
      type: CredentialType.OAUTH,
      provider: subBlockConfig.provider,
      serviceId: subBlockConfig.serviceId,
      label: subBlockConfig.title || getProviderLabel(subBlockConfig.provider) || 'OAuth Account',
      blockType,
      subBlockId: subBlockConfig.id,
      required: subBlockConfig.required !== false,
      description:
        subBlockConfig.description ||
        `${getProviderLabel(subBlockConfig.provider)} account for ${blockName}`,
    }
  }

  // Handle secret fields (password: true) - includes API keys, bot tokens, passwords, etc.
  if (subBlockConfig.password === true) {
    return {
      type: CredentialType.SECRET,
      label: subBlockConfig.title || formatFieldName(subBlockConfig.id),
      blockType,
      subBlockId: subBlockConfig.id,
      required: subBlockConfig.required !== false,
      description:
        subBlockConfig.description ||
        `${subBlockConfig.title || formatFieldName(subBlockConfig.id)} for ${blockName}`,
    }
  }

  return null
}

/**
 * Check if a subblock should be extracted as a credential
 * This is only used for subblocks that don't have proper config
 */
function shouldExtractAsCredential(subBlock: any): boolean {
  // Only extract if it's an OAuth input type
  // We can't reliably detect password fields without the config
  return subBlock.type === 'oauth-input'
}

/**
 * Get friendly provider label
 */
function getProviderLabel(provider?: string): string | null {
  if (!provider) return null
  return (
    PROVIDER_NAMES[provider] ||
    provider.charAt(0).toUpperCase() + provider.slice(1).replace(/-/g, ' ')
  )
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
        // Clear OAuth that wasn't in config
        if (shouldExtractAsCredential(subBlock)) {
          subBlock.value = ''
        }

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
