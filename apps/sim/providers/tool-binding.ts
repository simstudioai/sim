import type { SubBlockType } from '@sim/workflow-types/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { ProviderToolConfig } from '@/providers/types'

/** External resource kinds whose identity distinguishes two instances of the same tool. */
export type BoundResourceKind = 'credential' | 'knowledgeBase' | 'workflow'

export interface ToolResourceBinding {
  kind: BoundResourceKind
  /** The configured resource id. Opaque, and never sent to a model. */
  id: string
  /** Developer-authored field label from {@link SubBlockConfig.title}, e.g. `'Gmail Account'`. */
  fieldTitle: string
  /** Label the transform already resolved, which lets the labeller skip its own lookup. */
  preresolvedLabel?: string
  /** The tool's own description already names this resource, so nothing should be appended. */
  selfDescribed?: boolean
}

/**
 * Subblock types whose value identifies WHICH external resource an instance is bound to,
 * and that can be resolved to a name from Sim's own database.
 *
 * A deliberate subset of `SELECTOR_TYPES_HYDRATION_REQUIRED` (`blocks/types.ts`), which lists the
 * fourteen subblock types the editor hydrates into display names. The eleven omitted here fall into
 * three groups:
 *
 * - `channel-selector`, `user-selector`, `file-selector`, `sheet-selector`, `folder-selector`,
 *   `project-selector`, `document-selector` name resources that live in a third-party service, so
 *   resolving one costs an OAuth round-trip rather than a local read.
 * - `table-selector` needs no entry because table tools already name their table through
 *   `toolEnrichment` — see `lib/table/llm/enrichment.ts`.
 * - `variables-input`, `mcp-server-selector` and `mcp-tool-selector` do not identify a bound
 *   resource at all here: variable assignments are not a resource, and an MCP tool's id already
 *   embeds its server (`createMcpToolId`), so two MCP entries only collide when the server and
 *   tool are identical and there is nothing left to distinguish.
 */
export const BINDABLE_SUBBLOCK_KINDS: Partial<Record<SubBlockType, BoundResourceKind>> = {
  'oauth-input': 'credential',
  'knowledge-base-selector': 'knowledgeBase',
  'workflow-selector': 'workflow',
}

/**
 * Shape a configured value must have to be treated as a resolvable resource id.
 *
 * A `{{NAME}}` placeholder and any free-text value fail this, so a binding is simply not collected
 * for them rather than reaching a resolver.
 *
 * This is the whole boundary, by design. An advanced-mode selector is a `short-input` that accepts
 * an environment reference, so routing these params through `assertInputPathsDoNotResolveSecrets`
 * would hard-fail agent blocks that resolve a credential id from a variable today — a real
 * regression in exchange for a cosmetic label. It would also buy nothing: what reaches the model is
 * the resource's workspace display name, never the configured id, and those names already reach
 * every run in the workspace through `executor/handlers/credential/credential-handler.ts`.
 */
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const toolResourceBindings = new WeakMap<object, ToolResourceBinding[]>()

/**
 * Associates a provider tool with the resources its configuration binds it to.
 *
 * Keyed on the exact tool object rather than on a field of {@link ProviderToolConfig}, so the
 * provider wire type stays unwidened and a caller that replaces a tool object simply loses its
 * bindings — degrading to an unlabelled tool instead of a mislabelled one.
 */
export function registerProviderToolBindings(
  tool: object,
  bindings: readonly ToolResourceBinding[]
): void {
  if (bindings.length > 0) toolResourceBindings.set(tool, [...bindings])
}

/** Reads bindings for the exact configured tool instance, never by tool id or name. */
export function getProviderToolBindings(tool: object): ToolResourceBinding[] | undefined {
  return toolResourceBindings.get(tool)
}

/**
 * Groups tools that collapse to the same canonical id, returning only the groups with a
 * duplicate — the sole case where an instance's binding carries information the model needs.
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

interface CollectToolResourceBindingsInput {
  subBlocks: SubBlockConfig[] | undefined
  /** Raw configured params, which hold values for subblocks that declare no canonical id. */
  userProvidedParams: Record<string, unknown>
  /** Params after canonical basic/advanced pairs have collapsed onto their canonical id. */
  resolvedResourceParams: Record<string, unknown>
  /** `toolEnrichment.dependsOn`, when the tool rewrote its own description from that param. */
  selfDescribedParamId?: string
  /** Label for a `workflow` binding the caller already fetched. */
  workflowLabel?: string
}

/**
 * Extracts a tool's resource bindings from its configuration. Pure and synchronous — no lookup
 * happens here, because a tool cannot know whether it has a duplicate sibling.
 *
 * Matches on subblock TYPE rather than `canonicalParamId`, because several OAuth blocks
 * (`box`, `managed_agent`, `microsoft_ad`, `microsoft_dataverse`) declare `oauth-input` with no
 * canonical id at all, and a canonical-keyed lookup would drop them silently.
 */
export function collectToolResourceBindings({
  subBlocks,
  userProvidedParams,
  resolvedResourceParams,
  selfDescribedParamId,
  workflowLabel,
}: CollectToolResourceBindingsInput): ToolResourceBinding[] {
  if (!subBlocks?.length) return []

  const bindings: ToolResourceBinding[] = []
  const seenParamIds = new Set<string>()

  for (const subBlock of subBlocks) {
    const kind = BINDABLE_SUBBLOCK_KINDS[subBlock.type]
    if (!kind) continue

    // A canonical pair contributes two subblocks (basic + advanced) for one logical field.
    const paramId = subBlock.canonicalParamId ?? subBlock.id
    if (seenParamIds.has(paramId)) continue

    const value = subBlock.canonicalParamId
      ? resolvedResourceParams[subBlock.canonicalParamId]
      : userProvidedParams[subBlock.id]
    if (typeof value !== 'string' || !RESOURCE_ID_PATTERN.test(value)) continue

    seenParamIds.add(paramId)
    bindings.push({
      kind,
      id: value,
      fieldTitle: subBlock.title || paramId,
      ...(kind === 'workflow' && workflowLabel ? { preresolvedLabel: workflowLabel } : {}),
      ...(selfDescribedParamId === paramId ? { selfDescribed: true } : {}),
    })
  }

  return bindings
}
