import { isPlainRecord } from '@sim/utils/object'
import { getToolInputParamConfigs } from '@/lib/workflows/search-replace/indexer'
import { WORKFLOW_SEARCH_SUBBLOCK_RESOURCE_TYPES } from '@/lib/workflows/search-replace/resources/registry'
import { setValueAtPath } from '@/lib/workflows/search-replace/value-walker'
import { evaluateSubBlockCondition, isNonEmptyValue } from '@/lib/workflows/subblocks/visibility'
import { parseStoredToolInputValue } from '@/lib/workflows/tool-input/types'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import type { BlockState, SubBlockState, WorkflowState } from '@/stores/workflows/workflow/types'

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
  'credentialId',
  'oauthCredential',
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

/**
 * The workspace-specific fields that name a credential rather than a resource.
 * Cleared even when {@link WorkflowSanitizationOptions.preserveWorkspaceBindings}
 * keeps the rest: the flag exists for a same-workspace round trip of resource
 * selections, and credentials stay on the sharing-safe rule alongside
 * `oauth-input` and `password` fields.
 */
const CREDENTIAL_BINDING_FIELDS: ReadonlySet<string> = new Set(['credentialId', 'oauthCredential'])

/**
 * Sub-block values whose interior cannot be projected safely once the payload leaves the
 * workspace.
 *
 * Tables are arbitrary key/value rows used for authorization headers and sandbox environment
 * variables. Their cells carry no password metadata — nothing distinguishes
 * `Authorization: Bearer sk-…` from `Content-Type: application/json` — so the whole value is
 * withheld. Tool inputs are handled separately through the search-replace parameter codecs.
 *
 * Which surfaces withhold these values, what that costs, and the shape a future relaxation must
 * take are recorded on {@link WorkflowSanitizationOptions.redactOpaqueCredentialInputs}, the flag
 * that governs both this set and the tool-input branch.
 */
const OPAQUE_CREDENTIAL_BEARING_TYPES: ReadonlySet<string> = new Set(['table'])

interface MutableSubBlockState extends Omit<SubBlockState, 'value'> {
  value: unknown
}

/** Block state with mutable subBlocks for sanitization */
interface MutableBlockState extends Omit<BlockState, 'subBlocks'> {
  subBlocks: Record<string, MutableSubBlockState | null | undefined>
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

export interface WorkflowSanitizationOptions {
  preserveEnvVars?: boolean
  /**
   * Keep workspace-scoped resource bindings — table, knowledge base, document,
   * file, folder, channel, and every other selector the resource registry knows
   * — instead of clearing them. For a same-workspace round trip (`workflows
   * export` then `workflows import` into the workspace it came from) those ids
   * still resolve, and clearing them was the reason a re-imported workflow could
   * not run. Credentials (`oauth-input`, {@link CREDENTIAL_BINDING_FIELDS}),
   * passwords, and opaque table values are cleared regardless: the flag widens
   * what a payload carries, never what leaves the trust boundary as a secret.
   */
  preserveWorkspaceBindings?: boolean
  /**
   * Withhold values whose interior cannot be projected safely once the payload leaves the
   * workspace — whole `table` values (see {@link OPAQUE_CREDENTIAL_BEARING_TYPES}) and every
   * `tool-input` parameter with no authoritative codec metadata.
   *
   * Governed surfaces are every caller that passes this flag: the public execution-snapshot
   * projection, the pinned deployment-version read, and — since #6591 — workflow export, which
   * reaches the in-app Export as JSON button, the folder and multi-select ZIPs, and the v1/v2
   * export APIs.
   *
   * The accepted cost on the export surface is that an export is lossy for tables and does not
   * round-trip: non-secret configuration (api `params`, cloudwatch dimensions, response `headers`,
   * sts `tags`) is withheld alongside the secrets, and a whole-`{{ENV_VAR}}` reference inside a
   * cell is withheld too, unlike the same reference in a `password: true` field. Withholding was
   * chosen over per-cell heuristics because the sub-blocks that motivate the loss — every header
   * table and the `browser_use`/`stagehand`/`daytona` variable tables — are exactly the ones a
   * pasted bearer token lands in, and an export file leaves the trust boundary. Relaxing this
   * needs a per-sub-block opt-in that fails closed for tables added later, not a wider default;
   * `import-export-roundtrip` pins the current loss so the trade cannot be reversed silently.
   */
  redactOpaqueCredentialInputs?: boolean
}

type CredentialSanitizationConfig = Pick<
  SubBlockConfig,
  'id' | 'type' | 'password' | 'canonicalParamId'
>

function isEnvironmentVariableReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')
}

/** Whether a sub-block config holds a reference scoped to this workspace. */
function isWorkspaceBindingConfig(config: CredentialSanitizationConfig): boolean {
  return (
    WORKSPACE_SPECIFIC_TYPES.has(config.type) ||
    WORKSPACE_SPECIFIC_FIELDS.has(config.id) ||
    (config.canonicalParamId != null && WORKSPACE_SPECIFIC_FIELDS.has(config.canonicalParamId))
  )
}

/** Whether a sub-block config names a credential, which no export option preserves. */
function isCredentialBindingConfig(config: CredentialSanitizationConfig): boolean {
  return (
    config.type === 'oauth-input' ||
    CREDENTIAL_BINDING_FIELDS.has(config.id) ||
    (config.canonicalParamId != null && CREDENTIAL_BINDING_FIELDS.has(config.canonicalParamId))
  )
}

/**
 * Sanitizes nested tool parameters using the same codecs as workflow search and fork remapping.
 * Only parameters resolved from a registered definition retain non-sensitive values. Custom, MCP,
 * and unknown schemas lack reliable secret annotations, so their generic parameters are withheld.
 */
function sanitizeToolInputValue(value: unknown, options: WorkflowSanitizationOptions): unknown {
  const tools = parseStoredToolInputValue(value)
  if (!Array.isArray(value)) return null
  if (tools.length !== value.length) return null

  let sanitizedValue: unknown = value
  tools.forEach((tool, toolIndex) => {
    const storedTool = value[toolIndex]
    if (!isPlainRecord(storedTool)) {
      throw new Error(`Parsed tool input at index ${toolIndex} lost its object shape`)
    }
    if (storedTool.params != null && !isPlainRecord(storedTool.params)) {
      sanitizedValue = setValueAtPath(sanitizedValue, [toolIndex, 'params'], null)
      return
    }

    const configs = getToolInputParamConfigs({ tool, toolIndex })
    const configByParamKey = new Map<
      string,
      { config: CredentialSanitizationConfig; authoritative: boolean }
    >()
    configs.forEach(({ paramId, config, authoritative }) => {
      configByParamKey.set(paramId, { config, authoritative })
      if (config.canonicalParamId) {
        configByParamKey.set(config.canonicalParamId, { config, authoritative })
      }
    })

    Object.entries(tool.params ?? {}).forEach(([paramKey, paramValue]) => {
      const resolved = configByParamKey.get(paramKey)
      const nextValue = resolved?.authoritative
        ? sanitizeConfiguredSubBlockValue(paramValue, resolved.config, options)
        : null
      sanitizedValue = setValueAtPath(sanitizedValue, [toolIndex, 'params', paramKey], nextValue)
    })
  })

  return sanitizedValue
}

function sanitizeConfiguredSubBlockValue(
  value: unknown,
  config: CredentialSanitizationConfig,
  options: WorkflowSanitizationOptions
): unknown {
  if (config.type === 'oauth-input') return null
  if (options.redactOpaqueCredentialInputs && config.type === 'tool-input') {
    return sanitizeToolInputValue(value, options)
  }
  if (options.redactOpaqueCredentialInputs && OPAQUE_CREDENTIAL_BEARING_TYPES.has(config.type)) {
    return null
  }
  if (config.password === true) {
    return options.preserveEnvVars && isEnvironmentVariableReference(value) ? value : null
  }
  if (isWorkspaceBindingConfig(config)) {
    if (!options.preserveWorkspaceBindings || isCredentialBindingConfig(config)) return null
  }
  return value
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
  options: WorkflowSanitizationOptions = {}
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

    // Process subBlocks with config
    if (blockConfig) {
      blockConfig.subBlocks?.forEach((subBlockConfig: SubBlockConfig) => {
        if (block.subBlocks?.[subBlockConfig.id]) {
          const subBlock = block.subBlocks[subBlockConfig.id]

          block.subBlocks[subBlockConfig.id]!.value = sanitizeConfiguredSubBlockValue(
            subBlock?.value,
            subBlockConfig,
            options
          )
        }
      })
    }

    // Process subBlocks without config (fallback)
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]) => {
        if (options.redactOpaqueCredentialInputs && subBlock) {
          if (subBlock.type === 'tool-input') {
            subBlock.value = sanitizeToolInputValue(subBlock.value, options)
          } else if (OPAQUE_CREDENTIAL_BEARING_TYPES.has(subBlock.type)) {
            subBlock.value = null
          }
        }

        // Clear workspace-specific fields by key name
        if (
          WORKSPACE_SPECIFIC_FIELDS.has(key) &&
          subBlock &&
          (!options.preserveWorkspaceBindings || CREDENTIAL_BINDING_FIELDS.has(key))
        ) {
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
        if (WORKSPACE_SPECIFIC_FIELDS.has(key) && !options.preserveWorkspaceBindings) {
          block.data![key] = null
        }
      })
    }
  })

  return sanitized
}

/** A required workspace binding an export cleared, keyed the way a caller sets it. */
export interface StrippedWorkspaceBinding {
  blockId: string
  blockName: string
  /** The canonical param id of a picker/manual pair, else the sub-block id. */
  field: string
}

function isRequiredSubBlock(config: SubBlockConfig, values: Record<string, unknown>): boolean {
  if (!config.required) return false
  if (config.required === true) return true
  return evaluateSubBlockCondition(config.required, values)
}

/**
 * The required workspace bindings of a state that arrived empty — what
 * {@link sanitizeWorkflowForSharing} clears on export and nothing on the import
 * path can restore.
 *
 * Reported per canonical group: a picker and its manual twin are one binding to
 * the caller, and the group is empty only when every member is. A binding
 * whose sub-block is hidden by its `condition` (a document selector on a
 * knowledge block set to `search`) or not required in the current mode is not
 * reported, so the list is exactly the fields the workflow cannot run without.
 * Credentials are left to the sharing rule that always clears them; disabled
 * blocks are skipped because execution skips them too.
 */
export function collectStrippedWorkspaceBindings(
  state: Pick<Partial<WorkflowState>, 'blocks'> | null | undefined
): StrippedWorkspaceBinding[] {
  const findings: StrippedWorkspaceBinding[] = []
  for (const [blockId, block] of Object.entries(state?.blocks ?? {})) {
    if (!block?.type || block.enabled === false) continue
    const blockConfig = getBlock(block.type)
    if (!blockConfig) continue

    const subBlocks = block.subBlocks ?? {}
    const values: Record<string, unknown> = {}
    for (const [id, subBlock] of Object.entries(subBlocks)) values[id] = subBlock?.value

    const groups = new Map<string, { present: boolean; hasValue: boolean; required: boolean }>()
    for (const config of blockConfig.subBlocks ?? []) {
      if (!isWorkspaceBindingConfig(config) || isCredentialBindingConfig(config)) continue
      const key = config.canonicalParamId ?? config.id
      const group = groups.get(key) ?? { present: false, hasValue: false, required: false }
      if (Object.hasOwn(subBlocks, config.id)) group.present = true
      if (isNonEmptyValue(values[config.id])) group.hasValue = true
      if (
        evaluateSubBlockCondition(config.condition, values) &&
        isRequiredSubBlock(config, values)
      ) {
        group.required = true
      }
      groups.set(key, group)
    }

    for (const [field, group] of groups) {
      if (group.present && group.required && !group.hasValue) {
        findings.push({ blockId, blockName: block.name || blockId, field })
      }
    }
  }
  return findings
}
