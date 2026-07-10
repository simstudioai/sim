import { stripVersionSuffix } from '@sim/utils/string'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import { overlayBlocks, resolveOverlayBlock } from '@/blocks/custom/overlay'
import { BLOCK_META_REGISTRY, BLOCK_REGISTRY } from '@/blocks/registry-maps'
import type {
  BlockCategory,
  BlockConfig,
  BlockMeta,
  BlockTemplate,
  SuggestedSkill,
} from '@/blocks/types'
import { isHiddenUnder, overlayVisibility } from '@/blocks/visibility/context'

/**
 * Normalize an external block type to its registry key form: dashes become
 * underscores (some external sources use either form).
 */
function normalizeType(type: string): string {
  return type.replace(/-/g, '_')
}

/** Get the block config for a single block type. Falls back to the custom-block overlay. */
export function getBlock(type: string): BlockConfig | undefined {
  return BLOCK_REGISTRY[type] ?? BLOCK_REGISTRY[normalizeType(type)] ?? resolveOverlayBlock(type)
}

/** Whether any registered block is an unreleased `preview` block. Static — computed once. */
const HAS_PREVIEW_BLOCKS = Object.values(BLOCK_REGISTRY).some((block) => block.preview)

/**
 * True when the visibility projection cannot change any block, so accessors can
 * return raw arrays untouched: no `preview` blocks exist (they must be hidden
 * even with a null state) and no kill-switch entries apply.
 */
function visibilityInert(vis: BlockVisibilityState | null): boolean {
  if (HAS_PREVIEW_BLOCKS) return false
  return vis === null || vis.disabled.size === 0
}

/**
 * Effective hidden state for discovery surfaces: static `hideFromToolbar`
 * (superseded versions, disabled custom blocks) plus the per-viewer visibility
 * predicate ({@link isHiddenUnder}: unrevealed `preview` blocks — fail-closed
 * even without a context — and kill-switched types).
 */
function effectiveHidden(block: BlockConfig, vis: BlockVisibilityState | null): boolean {
  if (block.hideFromToolbar) return true
  return isHiddenUnder(vis, block)
}

/**
 * Project a block through the viewer's visibility: gated blocks become shallow
 * clones with `hideFromToolbar: true` (CLONE-NOT-REMOVE — gated blocks must stay
 * in `getAllBlocks()` output because `.find`-by-type consumers rely on it), and
 * revealed-but-not-GA preview blocks get a display " (Preview)" name suffix.
 * The `!block.hideFromToolbar` guard keeps already-hidden blocks (including
 * disabled custom blocks) un-cloned and never suffixed.
 */
function projectBlock(block: BlockConfig, vis: BlockVisibilityState | null): BlockConfig {
  if (effectiveHidden(block, vis) && !block.hideFromToolbar) {
    return { ...block, hideFromToolbar: true }
  }
  if (block.preview && vis?.previewTagged.has(block.type)) {
    return { ...block, name: `${block.name} (Preview)` }
  }
  return block
}

/**
 * All block configs, including any in-scope custom blocks from the overlay,
 * projected through the viewer's block visibility. Execution paths are
 * unaffected: they resolve via the pure {@link getBlock}.
 */
export function getAllBlocks(): BlockConfig[] {
  const all = [...Object.values(BLOCK_REGISTRY), ...overlayBlocks()]
  const vis = overlayVisibility()
  if (visibilityInert(vis)) return all
  return all.map((block) => projectBlock(block, vis))
}

/** Find the block whose `tools.access` contains the given tool id. */
export function getBlockByToolName(toolName: string): BlockConfig | undefined {
  return Object.values(BLOCK_REGISTRY).find((b) => b.tools?.access?.includes(toolName))
}

/**
 * Resolve the canonical (highest-version) block for a base type. Handles
 * versioned variants like `confluence_v2`: callers pass `confluence` and
 * receive the latest implementation. Returns the registry key alongside the
 * config so callers that need the canonical type identifier avoid re-deriving
 * it.
 */
function resolveLatest(baseType: string): { type: string; config: BlockConfig } | undefined {
  const normalized = normalizeType(baseType)
  const versionPattern = new RegExp(`^${normalized}_v(\\d+)$`)
  let latestKey: string | undefined
  let latestVersion = -1
  for (const key of Object.keys(BLOCK_REGISTRY)) {
    const match = key.match(versionPattern)
    if (!match) continue
    const version = Number.parseInt(match[1]!, 10)
    if (version > latestVersion) {
      latestVersion = version
      latestKey = key
    }
  }
  if (latestKey) return { type: latestKey, config: BLOCK_REGISTRY[latestKey]! }
  const config = BLOCK_REGISTRY[normalized]
  return config ? { type: normalized, config } : undefined
}

/**
 * Resolve the canonical (highest-version) block for a base type. Handles
 * versioned variants like `confluence_v2`: callers pass `confluence` and
 * receive the latest implementation.
 */
export function getLatestBlock(baseType: string): BlockConfig | undefined {
  return resolveLatest(baseType)?.config
}

/** All blocks in a given category. */
export function getBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY).filter((block) => block.category === category)
}

/**
 * The canonical "latest-version, toolbar-visible" set of blocks for a
 * category. This is the single source of truth shared by every surface that
 * extracts blocks for presentation — the toolbar, the search/mention engine,
 * and the integrations catalog. A block is included when its `category`
 * matches and it is not effectively hidden: not `hideFromToolbar` (superseded
 * versions), not an unrevealed `preview` block, and not kill-switched for the
 * viewer. Visible blocks are projected so revealed preview blocks carry their
 * " (Preview)" display suffix.
 */
export function getCanonicalBlocksByCategory(category: BlockCategory): BlockConfig[] {
  const vis = overlayVisibility()
  const blocks = [...Object.values(BLOCK_REGISTRY), ...overlayBlocks()].filter(
    (block) => block.category === category && !effectiveHidden(block, vis)
  )
  return visibilityInert(vis) ? blocks : blocks.map((block) => projectBlock(block, vis))
}

/** All registered block type identifiers. */
export function getAllBlockTypes(): string[] {
  return Object.keys(BLOCK_REGISTRY)
}

/** Whether the given string is a registered block type. Accepts hyphens as a dash-form alias. */
export function isValidBlockType(type: string): type is string {
  return (
    type in BLOCK_REGISTRY ||
    normalizeType(type) in BLOCK_REGISTRY ||
    Boolean(resolveOverlayBlock(type))
  )
}

/**
 * Get the presentation/catalog meta for a block type, resolving through the
 * version suffix the same way {@link getTemplatesForBlock} does. Metas are
 * keyed under the base type (e.g. `confluence`, not `confluence_v2`), so a
 * versioned lookup falls back to the stripped base.
 */
export function getBlockMeta(type: string): BlockMeta | undefined {
  const normalized = normalizeType(type)
  return (
    BLOCK_META_REGISTRY[type] ??
    BLOCK_META_REGISTRY[normalized] ??
    BLOCK_META_REGISTRY[stripVersionSuffix(normalized)]
  )
}

/** All block metas keyed by block type. */
export function getAllBlockMeta(): Record<string, BlockMeta> {
  return BLOCK_META_REGISTRY
}

/**
 * A template scoped to a viewing block, enriched with `otherBlockTypes` —
 * the integrations to render alongside the viewer in the icon cluster.
 * Includes the template's owner block whenever the viewer is not the owner.
 */
export interface ScopedBlockTemplate extends BlockTemplate {
  /** Block types (base form) to render alongside the viewing block in the icon cluster. */
  otherBlockTypes: readonly string[]
}

/**
 * All templates whose owner block is `type` or which list `type` in their
 * `alsoIntegrations`. Each returned template carries `otherBlockTypes` —
 * the non-viewing integrations (owner + other alsoIntegrations) for icon
 * cluster rendering.
 */
export function getTemplatesForBlock(type: string): ScopedBlockTemplate[] {
  const base = stripVersionSuffix(type)
  const collected: ScopedBlockTemplate[] = []
  for (const [ownerType, meta] of Object.entries(BLOCK_META_REGISTRY)) {
    if (!meta.templates) continue
    const ownerBase = stripVersionSuffix(ownerType)
    const isOwnerMatch = ownerBase === base
    for (const template of meta.templates) {
      const isAlsoMatch =
        template.alsoIntegrations?.includes(base) || template.alsoIntegrations?.includes(type)
      if (!isOwnerMatch && !isAlsoMatch) continue
      const others: string[] = []
      if (!isOwnerMatch) others.push(ownerBase)
      for (const also of template.alsoIntegrations ?? []) {
        const alsoBase = stripVersionSuffix(also)
        if (alsoBase !== base && !others.includes(alsoBase)) others.push(alsoBase)
      }
      collected.push({ ...template, otherBlockTypes: others })
    }
  }
  return collected
}

/**
 * Popular, ready-to-add skills for a block type. Curated skills live on the
 * base integration's meta, but a versioned catalog type (e.g. `notion_v2`) has
 * its own meta entry that {@link getBlockMeta} resolves first and which may omit
 * skills — so fall back to the stripped base meta. Returns an empty array when
 * the integration has no curated skills.
 */
export function getSuggestedSkillsForBlock(type: string): readonly SuggestedSkill[] {
  const direct = getBlockMeta(type)?.skills
  if (direct && direct.length > 0) return direct
  const base = stripVersionSuffix(normalizeType(type))
  return BLOCK_META_REGISTRY[base]?.skills ?? []
}

/**
 * Raw block registry map keyed by block type. Prefer the typed accessors
 * (`getBlock`, `getAllBlocks`, `getCanonicalBlocksByCategory`); this alias is
 * retained for callers that need the underlying record directly.
 */
export const registry: Record<string, BlockConfig> = BLOCK_REGISTRY

export type { BlockCategory }
