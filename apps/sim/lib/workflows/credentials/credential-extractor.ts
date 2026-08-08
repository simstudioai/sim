import { CREDENTIAL_SUBBLOCK_IDS } from '@/lib/workflows/credentials/constants'
import { WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES } from '@/lib/workflows/search-replace/resources/registry'
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
enum CredentialType {
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

/**
 * Resource-selector types NOT cleared by the workspace rule below. Everything else the resource
 * registry knows about IS cleared, so the two lists can never drift apart again — the previous
 * hand-written copy had silently omitted `table-selector`, `mcp-tool-selector`, `user-selector`
 * and `sheet-selector`, which is how raw `tbl_…` ids reached other workspaces through an export.
 *
 * Every id in an export is workspace-scoped, and nothing on the import path remaps them:
 * `import-export.ts` extracts each workflow independently and assigns it a fresh id, so a
 * preserved reference points at a workflow that does not exist in the target — including inside a
 * multi-workflow bundle, where the sibling it named was itself re-created under a new id. Clearing
 * is therefore the only correct treatment for every id-bearing selector.
 */
export const EXPORT_PRESERVED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  // Cleared by the dedicated `oauth-input` branch in `sanitizeWorkflowForSharing`, so excluding it
  // here only avoids clearing it twice - it never survives an export.
  'oauth-input',
])

/**
 * Sub-block types holding a reference scoped to this workspace, or to a credential that is itself
 * cleared on export. Derived from the canonical resource registry plus the name/slot-based
 * knowledge fields, which carry no resource id and therefore no registry entry.
 */
const WORKSPACE_SPECIFIC_TYPES: ReadonlySet<string> = new Set<string>([
  ...WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES.filter(
    (type) => !EXPORT_PRESERVED_RESOURCE_TYPES.has(type)
  ),
  'knowledge-tag-filters',
  'document-tag-entry',
])

/**
 * Field IDs that are workspace-specific, for the fallback pass over blocks with no registry
 * config (and over legacy `block.data`). Keyed by sub-block / canonical param id, which the
 * type-keyed registry above cannot supply, so this list stays explicit.
 */
const WORKSPACE_SPECIFIC_FIELDS = new Set([
  'knowledgeBaseId',
  'tagFilters',
  'documentTags',
  'documentId',
  'fileId',
  'tableId',
  'projectId',
  'channelId',
  'folderId',
])

// Internal secretless Copilot views may retain resources owned by the current
// workspace. Provider-scoped selectors (channels, projects, external files and
// folders) stay redacted because they belong to a credential/account context.
const PRESERVABLE_WORKSPACE_TYPES = new Set([
  'knowledge-base-selector',
  'knowledge-tag-filters',
  'document-selector',
  'document-tag-entry',
  'file-upload',
  'mcp-server-selector',
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

function dependencyFields(config: SubBlockConfig): string[] {
  const { dependsOn } = config
  const staticDependencies = !dependsOn
    ? []
    : Array.isArray(dependsOn)
      ? dependsOn
      : [...(dependsOn.all ?? []), ...(dependsOn.any ?? [])]
  return [...staticDependencies, ...(config.reactiveCondition?.watchFields ?? [])]
}

function isCredentialKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, '').replace(/\d+$/, '').toLowerCase()
  return (
    normalized === 'auth' ||
    normalized === 'authorization' ||
    normalized.endsWith('credential') ||
    normalized.endsWith('credentialid') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('idtoken') ||
    normalized.endsWith('authtoken') ||
    normalized.endsWith('bottoken') ||
    normalized.endsWith('bearertoken') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('password')
  )
}

/**
 * Resolve credential fields and every credential-scoped dependent (for example
 * a Slack channel selected under one OAuth account). Canonical groups are
 * cleared as a unit so dormant advanced/manual values cannot survive.
 */
function credentialSensitiveSubBlockIds(subBlocks: SubBlockConfig[]): Set<string> {
  const sensitive = new Set<string>()
  const canonicalIndex = buildCanonicalIndex(subBlocks)

  const addCanonicalGroup = (subBlockId: string) => {
    sensitive.add(subBlockId)
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockId]
    if (!canonicalId) return
    sensitive.add(canonicalId)
    const group = canonicalIndex.groupsById[canonicalId]
    if (group?.basicId) sensitive.add(group.basicId)
    for (const advancedId of group?.advancedIds ?? []) sensitive.add(advancedId)
  }

  for (const config of subBlocks) {
    if (config.type === 'oauth-input' || config.password === true) {
      addCanonicalGroup(config.id)
    }
  }

  // Dependents can chain (credential -> project -> folder), so close over the
  // dependency graph rather than clearing only the first level.
  let changed = true
  while (changed) {
    changed = false
    for (const config of subBlocks) {
      if (sensitive.has(config.id)) continue
      if (dependencyFields(config).some((field) => sensitive.has(field))) {
        addCanonicalGroup(config.id)
        changed = true
      }
    }
  }

  return sensitive
}

/**
 * Resolve workspace-owned selectors and their canonical basic/advanced peers.
 * Matching by field name alone is unsafe: common IDs such as `documentId`
 * also identify provider-owned resources (for example Google Docs).
 */
function preservableWorkspaceSubBlockIds(subBlocks: SubBlockConfig[]): Set<string> {
  const preservable = new Set<string>()
  const canonicalIndex = buildCanonicalIndex(subBlocks)

  for (const config of subBlocks) {
    if (!PRESERVABLE_WORKSPACE_TYPES.has(config.type)) continue
    preservable.add(config.id)
    const canonicalId = canonicalIndex.canonicalIdBySubBlockId[config.id]
    if (!canonicalId) continue
    preservable.add(canonicalId)
    const group = canonicalIndex.groupsById[canonicalId]
    if (group?.basicId) preservable.add(group.basicId)
    for (const advancedId of group?.advancedIds ?? []) preservable.add(advancedId)
  }

  return preservable
}

function registeredSubBlockIds(subBlocks: SubBlockConfig[]): Set<string> {
  const registered = new Set<string>()
  for (const config of subBlocks) {
    registered.add(config.id)
    if (config.canonicalParamId) registered.add(config.canonicalParamId)
  }
  return registered
}

function sanitizeStoredToolCredentials(value: unknown): unknown {
  let tools: unknown[]
  let wasJson = false
  if (Array.isArray(value)) {
    tools = value
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Array.isArray(parsed)) return value
      tools = parsed
      wasJson = true
    } catch {
      return value
    }
  } else {
    return value
  }

  const sanitized = tools.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return tool
    const record = tool as Record<string, unknown>
    if (!record.params || typeof record.params !== 'object' || Array.isArray(record.params)) {
      return tool
    }

    const toolConfig = typeof record.type === 'string' ? getBlock(record.type) : undefined
    const toolSubBlocks = toolConfig?.subBlocks ?? []
    const registeredParams = registeredSubBlockIds(toolSubBlocks)
    const sensitive = credentialSensitiveSubBlockIds(toolSubBlocks)
    const params = record.params as Record<string, unknown>
    const nextParams = Object.fromEntries(
      Object.entries(params).filter(([key]) => {
        if (record.type === 'function' && (key === 'secretScope' || key === 'mountedSecrets')) {
          return false
        }
        if (sensitive.has(key)) return false
        if (registeredParams.has(key)) return true
        return !CREDENTIAL_SUBBLOCK_IDS.has(key) && !isCredentialKey(key)
      })
    )
    return { ...record, params: nextParams }
  })

  return wasJson ? JSON.stringify(sanitized) : sanitized
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
    preserveWorkspaceReferences?: boolean // Keep workspace-owned resource IDs for internal views
  } = {}
): SanitizedWorkflowState {
  const sanitized = structuredClone(state) as SanitizedWorkflowState

  if (!sanitized?.blocks) {
    return sanitized
  }

  Object.values(sanitized.blocks).forEach((block: MutableBlockState) => {
    if (!block?.type) return

    // First, remove any malformed subBlocks that may have been created by bugs
    removeMalformedSubBlocks(block)

    const blockConfig = getBlock(block.type)
    const blockConfigById = new Map(
      (blockConfig?.subBlocks ?? []).map((subBlock) => [subBlock.id, subBlock])
    )
    const registeredIds = registeredSubBlockIds(blockConfig?.subBlocks ?? [])
    const credentialSensitiveIds = blockConfig
      ? credentialSensitiveSubBlockIds(blockConfig.subBlocks ?? [])
      : new Set<string>()
    const preservableWorkspaceIds = blockConfig
      ? preservableWorkspaceSubBlockIds(blockConfig.subBlocks ?? [])
      : new Set<string>()

    // Process subBlocks with config
    if (blockConfig) {
      blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
        if (block.subBlocks?.[subBlockConfig.id]) {
          const subBlock = block.subBlocks[subBlockConfig.id]

          const preserveWorkspaceReference =
            options.preserveWorkspaceReferences === true &&
            preservableWorkspaceIds.has(subBlockConfig.id)
          const preserveSecretEnvRef =
            subBlockConfig.password === true &&
            options.preserveEnvVars === true &&
            typeof subBlock?.value === 'string' &&
            subBlock.value.startsWith('{{') &&
            subBlock.value.endsWith('}}')

          // Clear credentials, their canonical peers, and selectors scoped to
          // those credentials. Workspace-owned references may be retained for
          // internal secretless Copilot projections.
          if (
            credentialSensitiveIds.has(subBlockConfig.id) &&
            !preserveWorkspaceReference &&
            !preserveSecretEnvRef
          ) {
            block.subBlocks[subBlockConfig.id]!.value = null
          }

          // Secret fields may preserve an env reference only for explicit export.
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
          else if (
            WORKSPACE_SPECIFIC_TYPES.has(subBlockConfig.type) &&
            !preserveWorkspaceReference
          ) {
            block.subBlocks[subBlockConfig.id]!.value = null
          }

          // Clear workspace-specific fields by ID
          else if (
            WORKSPACE_SPECIFIC_FIELDS.has(subBlockConfig.id) &&
            !preserveWorkspaceReference
          ) {
            block.subBlocks[subBlockConfig.id]!.value = null
          }
        }
      })
    }

    // Process subBlocks without config (fallback)
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]) => {
        if (!subBlock) return

        if (key === 'tools' || subBlock.type === 'tool-input') {
          subBlock.value = sanitizeStoredToolCredentials(subBlock.value) as SubBlockState['value']
        }

        const preserveSecretEnvRef =
          blockConfigById.get(key)?.password === true &&
          options.preserveEnvVars === true &&
          typeof subBlock.value === 'string' &&
          subBlock.value.startsWith('{{') &&
          subBlock.value.endsWith('}}')
        const isRegistered = registeredIds.has(key)
        if (
          (credentialSensitiveIds.has(key) ||
            (!isRegistered && (CREDENTIAL_SUBBLOCK_IDS.has(key) || isCredentialKey(key)))) &&
          !preserveSecretEnvRef
        ) {
          subBlock.value = null
        }

        // Clear workspace-specific fields by key name
        if (
          WORKSPACE_SPECIFIC_FIELDS.has(key) &&
          !(options.preserveWorkspaceReferences && preservableWorkspaceIds.has(key))
        ) {
          subBlock.value = null
        }
      })
    }

    // Clear data field (for backward compatibility)
    if (block.data) {
      Object.entries(block.data).forEach(([key]) => {
        const isSensitive = registeredIds.has(key)
          ? credentialSensitiveIds.has(key)
          : CREDENTIAL_SUBBLOCK_IDS.has(key) || isCredentialKey(key)
        if (isSensitive) {
          block.data![key] = null
        }
        // Clear workspace-specific data
        if (
          WORKSPACE_SPECIFIC_FIELDS.has(key) &&
          !(options.preserveWorkspaceReferences && preservableWorkspaceIds.has(key))
        ) {
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
