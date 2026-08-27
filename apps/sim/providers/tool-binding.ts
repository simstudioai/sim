import { truncate } from '@sim/utils/string'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { ProviderToolConfig } from '@/providers/types'
import { isNonEmpty } from '@/tools/merge-params'

/** Resource kinds whose configured value is an opaque id that must be resolved to a name. */
export type BoundResourceKind = 'credential' | 'knowledgeBase' | 'workflow'

export interface ToolPinnedField {
  paramId: string
  /** Human field label, e.g. `'Gmail Account'`. */
  title: string
  /** Display value for a plain param. Mutually exclusive with {@link ToolPinnedField.resource}. */
  value?: string
  /** Set when the configured value is an opaque id the labeller must resolve first. */
  resource?: { kind: BoundResourceKind; id: string }
  /** Whether the rendered value is quoted — strings are, numbers and booleans are not. */
  quoted?: boolean
}

/**
 * Subblock types whose value is an opaque resource id resolvable to a name from Sim's own
 * database. Every other filled field is stated using its configured value directly, so this map
 * is only about which fields need a lookup — not about which fields are worth stating.
 */
export const BINDABLE_SUBBLOCK_KINDS: Partial<Record<SubBlockType, BoundResourceKind>> = {
  'oauth-input': 'credential',
  'knowledge-base-selector': 'knowledgeBase',
  'workflow-selector': 'workflow',
}

/**
 * Subblock types whose value is never worth stating: either it is not something the model could
 * act on, or it is large enough to crowd out the tool's own description.
 */
const UNSTATEABLE_SUBBLOCK_TYPES: ReadonlySet<string> = new Set([
  'code',
  'tool-input',
  'skill-input',
  'file-upload',
  'table',
  'checkbox-list',
  'condition-input',
  'eval-input',
  'variables-input',
  'trigger-config',
  'webhook-config',
  'schedule-config',
  'secrets-management',
])

/** Backstop for a field that holds a secret but is missing its `password` declaration. */
const SECRET_PARAM_PATTERN = /password|apikey|api_key|token|secret|passphrase|privatekey/i

/** Shape a configured value must have to be treated as a resolvable resource id. */
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const MAX_STATED_VALUE_LENGTH = 60

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/**
 * Flattens workspace-authored text so it cannot forge structure inside a tool description:
 * control characters collapse to spaces, and quotes are dropped so the text cannot close its own
 * quoting. Returns an empty string when nothing printable survives.
 */
export function sanitizeStatedText(raw: string, maxLength = MAX_STATED_VALUE_LENGTH): string {
  return truncate(
    raw
      .replace(CONTROL_CHARACTERS, ' ')
      .replace(/["`\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    maxLength,
    '…'
  )
}

const toolPinnedFields = new WeakMap<object, ToolPinnedField[]>()

/**
 * Associates a provider tool with the fields the workflow pinned on it.
 *
 * Keyed on the exact tool object rather than on a field of {@link ProviderToolConfig}, so the
 * provider wire type stays unwidened and a caller that replaces a tool object loses its fields —
 * degrading to an unannotated tool rather than a mislabelled one.
 */
export function registerToolPinnedFields(tool: object, fields: readonly ToolPinnedField[]): void {
  if (fields.length > 0) toolPinnedFields.set(tool, [...fields])
}

/** Reads pinned fields for the exact configured tool instance, never by tool id or name. */
export function getToolPinnedFields(tool: object): ToolPinnedField[] | undefined {
  return toolPinnedFields.get(tool)
}

/**
 * Groups tools that collapse to the same canonical id, returning only groups with a duplicate.
 *
 * Keyed on `canonicalId ?? id`, the identical key `assignProviderToolIdentities` groups by, so the
 * two computations cannot disagree. Correct both before aliasing (when `canonicalId` is still
 * undefined) and after.
 */
export function groupDuplicateToolsByCanonicalId(
  tools: readonly ProviderToolConfig[]
): ProviderToolConfig[][] {
  const byCanonicalId = new Map<string, ProviderToolConfig[]>()
  for (const tool of tools) {
    const key = tool.canonicalId ?? tool.id
    const group = byCanonicalId.get(key)
    if (group) group.push(tool)
    else byCanonicalId.set(key, [tool])
  }
  return [...byCanonicalId.values()].filter((group) => group.length > 1)
}

function statedValue(value: unknown): { value: string; quoted: boolean } | undefined {
  if (typeof value === 'boolean') return { value: String(value), quoted: false }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value: String(value), quoted: false } : undefined
  }
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeStatedText(value)
  return sanitized ? { value: sanitized, quoted: true } : undefined
}

interface CollectToolPinnedFieldsInput {
  subBlocks: SubBlockConfig[] | undefined
  /** Raw configured params, holding values for subblocks that declare no canonical id. */
  userProvidedParams: Record<string, unknown>
  /** Params after canonical basic/advanced pairs have collapsed onto their canonical id. */
  resolvedResourceParams: Record<string, unknown>
  /** Tool param declarations, consulted for `hidden` visibility. */
  toolParams?: Record<string, { visibility?: string } | undefined>
  /** `toolEnrichment.dependsOn`, when the tool rewrote its own description from that param. */
  selfDescribedParamId?: string
  /** Label for a `workflow` field the caller already fetched. */
  workflowLabel?: string
  formatParamLabel: (paramId: string) => string
}

/**
 * Extracts the fields a workflow pinned on one tool instance. Pure and synchronous — resource ids
 * are recorded rather than resolved, because the lookup belongs to the layer that can batch it.
 *
 * Walks subblocks rather than `toolConfig.params` because subblocks are the set of fields a user
 * can actually fill, they carry the human title, and some pinned fields — the OAuth credential
 * above all — are block inputs that never appear in the tool's own param map.
 */
export function collectToolPinnedFields({
  subBlocks,
  userProvidedParams,
  resolvedResourceParams,
  toolParams,
  selfDescribedParamId,
  workflowLabel,
  formatParamLabel,
}: CollectToolPinnedFieldsInput): ToolPinnedField[] {
  if (!subBlocks?.length) return []

  const fields: ToolPinnedField[] = []
  const seenParamIds = new Set<string>()

  // A canonical pair's advanced half is a plain `short-input`, so the kind has to come from the
  // whole group rather than from whichever subblock is being scanned. Without this, a credential
  // entered in advanced mode falls through to the literal path and is stated verbatim.
  const kindByParamId = new Map<string, BoundResourceKind>()
  for (const subBlock of subBlocks) {
    const kind = BINDABLE_SUBBLOCK_KINDS[subBlock.type]
    if (kind) kindByParamId.set(subBlock.canonicalParamId ?? subBlock.id, kind)
  }

  for (const subBlock of subBlocks) {
    // A canonical pair contributes two subblocks (basic + advanced) for one logical field.
    const paramId = subBlock.canonicalParamId ?? subBlock.id
    if (seenParamIds.has(paramId)) continue
    if (selfDescribedParamId && paramId === selfDescribedParamId) continue

    if (subBlock.password || subBlock.hidden) continue
    if (UNSTATEABLE_SUBBLOCK_TYPES.has(subBlock.type)) continue
    if (toolParams?.[paramId]?.visibility === 'hidden') continue

    const kind = kindByParamId.get(paramId)
    if (!kind && SECRET_PARAM_PATTERN.test(paramId)) continue

    const raw = subBlock.canonicalParamId
      ? resolvedResourceParams[subBlock.canonicalParamId]
      : userProvidedParams[subBlock.id]
    if (!isNonEmpty(raw)) continue

    // Decided exactly once: a later subblock in the same canonical group must not re-evaluate the
    // same param under different rules.
    seenParamIds.add(paramId)

    const title = sanitizeStatedText(subBlock.title || formatParamLabel(paramId), 40)
    if (!title) continue

    if (kind) {
      if (typeof raw !== 'string' || !RESOURCE_ID_PATTERN.test(raw)) continue
      const preresolved = kind === 'workflow' && workflowLabel ? workflowLabel : undefined
      fields.push(
        preresolved
          ? { paramId, title, value: sanitizeStatedText(preresolved), quoted: true }
          : { paramId, title, resource: { kind, id: raw } }
      )
      continue
    }

    const stated = statedValue(raw)
    if (stated) fields.push({ paramId, title, value: stated.value, quoted: stated.quoted })
  }

  return fields
}
