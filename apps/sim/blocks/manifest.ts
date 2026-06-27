import { stripVersionSuffix } from '@sim/utils/string'
import { BLOCK_CATALOG, BLOCK_DISPLAY, TOOL_TO_BLOCK } from '@/blocks/manifest-data'
import type {
  BlockCategory,
  BlockConfig,
  BlockMeta,
  BlockTemplate,
  SuggestedSkill,
} from '@/blocks/types'

/**
 * Lightweight presentation slice of a block — every field is a value the
 * palette/catalog/log surfaces render, with none of the heavy execution data
 * (`subBlocks`/`tools.config`/`inputs`/`outputs`). It is the spreadable subset
 * of {@link BlockConfig}, so a block's `display.ts` is the single source of
 * truth that its full config re-exports.
 */
export type BlockDisplay = Pick<
  BlockConfig,
  'type' | 'name' | 'description' | 'category' | 'bgColor' | 'icon'
> &
  Partial<
    Pick<
      BlockConfig,
      | 'iconColor'
      | 'longDescription'
      | 'docsLink'
      | 'integrationType'
      | 'hideFromToolbar'
      | 'triggerAllowed'
    >
  >

/**
 * A template scoped to a viewing block, enriched with `otherBlockTypes` — the
 * integrations to render alongside the viewer in the icon cluster.
 */
export interface ScopedBlockTemplate extends BlockTemplate {
  /** Block types (base form) to render alongside the viewing block. */
  otherBlockTypes: readonly string[]
}

/** Dashes become underscores (some external sources use either form). */
function normalizeType(type: string): string {
  return type.replace(/-/g, '_')
}

/** Get the display slice for a single block type. */
export function getBlockDisplay(type: string): BlockDisplay | undefined {
  return BLOCK_DISPLAY[type] ?? BLOCK_DISPLAY[normalizeType(type)]
}

/** All block display slices. */
export function getAllBlockDisplay(): BlockDisplay[] {
  return Object.values(BLOCK_DISPLAY)
}

/**
 * The canonical (latest-version, toolbar-visible) display slices for a category
 * — the manifest equivalent of `registry.ts:getCanonicalBlocksByCategory`.
 * Superseded versions set `hideFromToolbar`, so they are excluded.
 */
export function getCanonicalBlockDisplayByCategory(category: BlockCategory): BlockDisplay[] {
  return Object.values(BLOCK_DISPLAY).filter(
    (block) => block.category === category && !block.hideFromToolbar
  )
}

/** Resolve the block that owns a given tool id, for icon/color rendering. */
export function getBlockDisplayByToolName(toolName: string): BlockDisplay | undefined {
  const type = TOOL_TO_BLOCK[toolName]
  return type ? getBlockDisplay(type) : undefined
}

/**
 * The canonical (highest-version) display slice for a base type — the manifest
 * equivalent of `registry.ts:getLatestBlock`. Resolves versioned variants
 * (`gmail_v2`): callers pass `gmail` and get the latest version's display.
 */
export function getLatestBlockDisplay(baseType: string): BlockDisplay | undefined {
  const normalized = normalizeType(baseType)
  const versionPattern = new RegExp(`^${normalized}_v(\\d+)$`)
  let latestKey: string | undefined
  let latestVersion = -1
  for (const key of Object.keys(BLOCK_DISPLAY)) {
    const match = key.match(versionPattern)
    if (!match) continue
    const version = Number.parseInt(match[1]!, 10)
    if (version > latestVersion) {
      latestVersion = version
      latestKey = key
    }
  }
  return latestKey ? BLOCK_DISPLAY[latestKey] : BLOCK_DISPLAY[normalized]
}

/**
 * Get the catalog meta for a block type, resolving through the version suffix
 * the same way {@link getTemplatesForBlock} does. Metas are keyed under the base
 * type (e.g. `confluence`, not `confluence_v2`).
 */
export function getBlockCatalog(type: string): BlockMeta | undefined {
  const normalized = normalizeType(type)
  return (
    BLOCK_CATALOG[type] ??
    BLOCK_CATALOG[normalized] ??
    BLOCK_CATALOG[stripVersionSuffix(normalized)]
  )
}

/**
 * All templates whose owner block is `type` or which list `type` in their
 * `alsoIntegrations`. Each returned template carries `otherBlockTypes` — the
 * non-viewing integrations (owner + other alsoIntegrations) for icon cluster
 * rendering. Mirrors the resolution in `registry.ts:getTemplatesForBlock`.
 */
export function getTemplatesForBlock(type: string): ScopedBlockTemplate[] {
  const base = stripVersionSuffix(type)
  const collected: ScopedBlockTemplate[] = []
  for (const [ownerType, meta] of Object.entries(BLOCK_CATALOG)) {
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
 * Popular, ready-to-add skills for a block type. Curated skills live on the base
 * integration's meta; a versioned catalog type falls back to the stripped base.
 */
export function getSuggestedSkillsForBlock(type: string): readonly SuggestedSkill[] {
  const direct = getBlockCatalog(type)?.skills
  if (direct && direct.length > 0) return direct
  const base = stripVersionSuffix(normalizeType(type))
  return BLOCK_CATALOG[base]?.skills ?? []
}
