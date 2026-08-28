import { truncate } from '@sim/utils/string'
import type { SubBlockType } from '@sim/workflow-types/blocks'
import {
  evaluateSubBlockCondition,
  isTriggerModeSubBlock,
} from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig } from '@/blocks/types'
import { isNonEmpty } from '@/tools/merge-params'

/** Resource kinds whose configured value is an opaque id that must be resolved to a name. */
export type BoundResourceKind = 'credential' | 'knowledgeBase'

/**
 * One value the workflow pinned on a tool instance: either a literal the model can read as-is, or
 * an opaque id that has to be resolved first. Never both — a field is one or the other.
 */
export type ToolPinnedField =
  | { title: string; value: string | number | boolean }
  | { title: string; resource: { kind: BoundResourceKind; id: string } }

/**
 * A workflow id is resolvable too, but its name is already fetched during tool transformation, so
 * it is stated as a literal and never leaves this module as an unresolved resource.
 */
type ResolvableKind = BoundResourceKind | 'workflow'

/**
 * Subblock types whose value is an opaque resource id rather than something readable. Every other
 * filled field is stated using its configured value directly, so this map is only about which
 * fields need a lookup — not about which fields are worth stating.
 */
const RESOURCE_SUBBLOCK_KINDS: Partial<Record<SubBlockType, ResolvableKind>> = {
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

/**
 * The operation selector itself. It is a real subblock with a value, but it names the tool rather
 * than constraining it, so stating it would only repeat what the tool id already says.
 */
const OPERATION_PARAM_ID = 'operation'

/**
 * Secret-ish names `isPasswordParameter` does not cover. It is tuned to Sim-authored param ids
 * (`password`, `apiKey`, `token`, `secret`, `key`, `credential`, …), but this module also states
 * params named by a REMOTE MCP schema, where these spellings are common and just as sensitive.
 * `passphrase` is the one that also occurs in Sim's own blocks — three declare it, all of them
 * with `password: true`, so that flag is the real guard and this is the backstop.
 */
const SUPPLEMENTAL_SECRET_PATTERN =
  /passphrase|authorization|bearer|cookie|session|signature|connectionstring|dsn|webhookurl|\botp\b|\bpin\b/i

/**
 * Shape a configured value must have to be treated as a resolvable resource id.
 *
 * Deliberately permissive: its job is to reject an unresolved `{{VAR}}` reference and free text,
 * not to assert that the id is a UUID. A credential may legitimately be addressed by the legacy
 * `account.id` it wraps, which `findWorkspaceCredentialLookup` still resolves.
 */
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const MAX_STATED_VALUE_LENGTH = 60
const MAX_STATED_TITLE_LENGTH = 40

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
 * Keyed on the exact tool object rather than on a field of `ProviderToolConfig`, so the provider
 * wire type stays unwidened and a caller that replaces a tool object loses its fields — degrading
 * to an unannotated tool rather than a mislabelled one.
 */
export function registerToolPinnedFields(tool: object, fields: readonly ToolPinnedField[]): void {
  if (fields.length > 0) toolPinnedFields.set(tool, [...fields])
}

/** Reads pinned fields for the exact configured tool instance, never by tool id or name. */
export function getToolPinnedFields(tool: object): ToolPinnedField[] | undefined {
  return toolPinnedFields.get(tool)
}

function statedValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined
  return sanitizeStatedText(value) || undefined
}

interface PinnedFieldSourceOptions {
  formatParamLabel: (paramId: string) => string
  /** `isPasswordParameter` from `@/tools/params`, injected to avoid a static registry-side edge. */
  isPasswordParam: (paramId: string) => boolean
}

function isSecretParamId(paramId: string, options: PinnedFieldSourceOptions): boolean {
  return options.isPasswordParam(paramId) || SUPPLEMENTAL_SECRET_PATTERN.test(paramId)
}

/**
 * Pinned fields for a tool that has no block subblocks to describe it. Used by the MCP path, whose
 * configured params are plain values keyed by the remote schema's own names. Custom tools take the
 * same shape but are not wired to this yet.
 */
export function collectPinnedFieldsFromParams(
  params: Record<string, unknown>,
  options: PinnedFieldSourceOptions
): ToolPinnedField[] {
  const fields: ToolPinnedField[] = []
  for (const [paramId, raw] of Object.entries(params)) {
    if (isSecretParamId(paramId, options)) continue
    if (!isNonEmpty(raw)) continue
    const value = statedValue(raw)
    if (value === undefined) continue
    const title = sanitizeStatedText(options.formatParamLabel(paramId), MAX_STATED_TITLE_LENGTH)
    if (title) fields.push({ title, value })
  }
  return fields
}

interface CollectToolPinnedFieldsInput extends PinnedFieldSourceOptions {
  subBlocks: SubBlockConfig[] | undefined
  /** Raw configured params, holding values for subblocks that declare no canonical id. */
  userProvidedParams: Record<string, unknown>
  /** Params after canonical basic/advanced pairs have collapsed onto their canonical id. */
  resolvedResourceParams: Record<string, unknown>
  /** The selected tool's declared params, consulted only for `hidden` visibility. */
  toolParams?: Record<string, { visibility?: string } | undefined>
  /**
   * Values the subblock conditions are evaluated against — the configured params plus the selected
   * operation, matching how the block's own tool selector resolves them.
   */
  conditionValues: Record<string, unknown>
  /** `toolEnrichment.dependsOn`, when the tool rewrote its own description from that param. */
  selfDescribedParamId?: string
  /** Name for a `workflow` field the caller already fetched. */
  workflowLabel?: string
}

/**
 * Extracts the fields a workflow pinned on one tool instance. Pure and synchronous — resource ids
 * are recorded rather than resolved, because the lookup belongs to the layer that can batch it.
 *
 * Walks subblocks rather than the tool's params because subblocks are the set of fields a user can
 * actually fill, they carry the human title, and some pinned fields — the OAuth credential above
 * all — are block inputs that never appear in the tool's own param map.
 */
export function collectToolPinnedFields(input: CollectToolPinnedFieldsInput): ToolPinnedField[] {
  const {
    subBlocks,
    userProvidedParams,
    resolvedResourceParams,
    toolParams,
    selfDescribedParamId,
    workflowLabel,
    formatParamLabel,
    conditionValues,
  } = input
  if (!subBlocks?.length) return []

  // A canonical pair's advanced half is a plain `short-input`, so the kind has to come from the
  // whole group rather than from whichever subblock is being scanned. Without this a resource
  // entered in advanced mode takes the literal path: a knowledge base id would be stated verbatim,
  // and a credential would be dropped entirely by the secret-name check below.
  // Decisions that must hold for a whole canonical group, not for whichever half is scanned first.
  // A group's advanced half is a plain `short-input`, so its kind has to come from the group — and
  // a group blocked by ANY half must stay blocked, or a `file-upload` basic half would skip without
  // claiming the param and let its `short-input` twin state a raw file reference.
  const kindByParamId = new Map<string, ResolvableKind>()
  const blockedParamIds = new Set<string>()
  for (const subBlock of subBlocks) {
    const paramId = subBlock.canonicalParamId ?? subBlock.id
    const kind = RESOURCE_SUBBLOCK_KINDS[subBlock.type]
    if (kind) kindByParamId.set(paramId, kind)
    // Only value-level disqualifiers block the whole group: a canonical group shares one value, so
    // if any half calls it secret or unstateable, the value is. Trigger mode is a property of the
    // SURFACE, not the value — several blocks put a trigger-mode credential in the same canonical
    // group as the action one — so it is skipped per subblock below instead.
    if (subBlock.password || subBlock.hidden || UNSTATEABLE_SUBBLOCK_TYPES.has(subBlock.type)) {
      blockedParamIds.add(paramId)
    }
  }

  const fields: ToolPinnedField[] = []
  const seenParamIds = new Set<string>()

  for (const subBlock of subBlocks) {
    // Not a candidate, and deliberately without claiming the param: an action-mode sibling in the
    // same canonical group still has to be considered.
    if (isTriggerModeSubBlock(subBlock)) continue

    const paramId = subBlock.canonicalParamId ?? subBlock.id
    if (seenParamIds.has(paramId)) continue
    if (selfDescribedParamId && paramId === selfDescribedParamId) continue

    if (blockedParamIds.has(paramId)) continue

    const kind = kindByParamId.get(paramId)

    // These apply only to a literal. A resource never reaches the model as its configured value —
    // only as a name looked up from it — so the secret-name heuristic would misfire here
    // (`isPasswordParameter` matches `oauthCredential`), and a resource is a block-level input
    // legitimately absent from the tool's own params.
    if (!kind) {
      if (paramId === OPERATION_PARAM_ID) continue
      if (isSecretParamId(paramId, input)) continue
      if (toolParams?.[paramId]?.visibility === 'hidden') continue
      // A block's subblocks span every operation it supports, so a field belonging to a different
      // operation must not be advertised as this tool's constraint. The subblock's own condition is
      // exactly that statement, and unlike matching against the tool's param names it survives a
      // block that renames a field on its way to the tool.
      if (!evaluateSubBlockCondition(subBlock.condition, conditionValues)) continue
    }

    const raw = subBlock.canonicalParamId
      ? resolvedResourceParams[subBlock.canonicalParamId]
      : userProvidedParams[subBlock.id]
    if (!isNonEmpty(raw)) continue

    // Decided exactly once: a later subblock in the same canonical group must not re-evaluate the
    // same param under different rules.
    seenParamIds.add(paramId)

    const title = sanitizeStatedText(
      subBlock.title || formatParamLabel(paramId),
      MAX_STATED_TITLE_LENGTH
    )
    if (!title) continue

    if (kind) {
      if (typeof raw !== 'string' || !RESOURCE_ID_PATTERN.test(raw)) continue
      if (kind === 'workflow') {
        // Nothing downstream can resolve a workflow id, so state it only if the name is in hand.
        const name = workflowLabel ? sanitizeStatedText(workflowLabel) : ''
        if (name) fields.push({ title, value: name })
        continue
      }
      fields.push({ title, resource: { kind, id: raw } })
      continue
    }

    const value = statedValue(raw)
    if (value !== undefined) fields.push({ title, value })
  }

  return fields
}
