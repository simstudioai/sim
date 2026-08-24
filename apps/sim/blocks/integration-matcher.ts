import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { getCanonicalBlocksByCategory } from '@/blocks/registry'
import type { BlockIcon } from '@/blocks/types'
import { registerBlockCacheInvalidator } from '@/blocks/visibility/context'

/**
 * Public descriptor for a single integration block, exposed to UI surfaces
 * that need to render an integration tile (mention menu, chip glyph, etc.)
 * without depending on the full {@link BlockConfig} shape.
 */
export interface IntegrationDescriptor {
  /** Stable block type identifier (the block's registry key). */
  blockType: string
  /** Display name with `(Legacy)` / `V2` suffixes stripped. */
  name: string
  /** Brand SVG icon component. */
  icon: BlockIcon
  /** Background color hex string used by integration tiles. */
  bgColor: string
}

/**
 * Precomputed lookup tables used by the auto-mention engine and the mention
 * menu. Names are sorted longest-first so multi-word matches like
 * `Google Sheets` win over `Google`; lookarounds prevent substring hits like
 * `Slack` inside `Slackbot`.
 */
export interface IntegrationMatcher {
  /** Regex matching any known integration name as a standalone token, or `null` when no integrations are registered. */
  regex: RegExp | null
  /** Lowercase display name -> descriptor for canonical lookup after a regex match. */
  byName: Map<string, IntegrationDescriptor>
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strips ` (Legacy)` / ` V2` suffixes so the display uses the natural name. */
function normalizeDisplayName(name: string): string {
  return name
    .replace(/\s*\(legacy\)\s*$/i, '')
    .replace(/\s+v\d+(\.\d+)*\s*$/i, '')
    .trim()
}

let cachedMatcher: IntegrationMatcher | null = null
let cachedList: readonly IntegrationDescriptor[] | null = null
let cachedPopularList: readonly IntegrationDescriptor[] | null = null

/**
 * Drops the memoized matcher/list. Registered with the block cache-invalidator
 * seam so a client block-visibility change (preview reveal / kill switch)
 * rebuilds the matcher against the new canonical block set.
 */
function clearIntegrationMatcherCache(): void {
  cachedMatcher = null
  cachedList = null
  cachedPopularList = null
}

registerBlockCacheInvalidator(clearIntegrationMatcherCache)

function buildMatcher(): IntegrationMatcher {
  const byName = new Map<string, IntegrationDescriptor>()
  const names: string[] = []

  for (const block of getCanonicalBlocksByCategory('tools')) {
    if (!block.name || block.name.trim().length < 2) continue
    const displayName = normalizeDisplayName(block.name)
    const key = displayName.toLowerCase()
    if (byName.has(key)) continue
    byName.set(key, {
      blockType: block.type,
      name: displayName,
      icon: block.icon,
      bgColor: block.bgColor,
    })
    names.push(displayName)
  }

  names.sort((a, b) => b.length - a.length)
  const regex = names.length
    ? new RegExp(`(?<![A-Za-z0-9_])(${names.map(escapeRegex).join('|')})(?![A-Za-z0-9_])`, 'gi')
    : null

  return { regex, byName }
}

/**
 * Lazily builds (once per session) and returns the precomputed integration
 * matcher. Reused by both the auto-mention keystroke fast-path and the bulk
 * text rewrite path.
 */
export function getIntegrationMatcher(): IntegrationMatcher {
  if (cachedMatcher) return cachedMatcher
  cachedMatcher = buildMatcher()
  return cachedMatcher
}

/**
 * Rewrites bare integration names in `text` to `@`-mention form (`Slack` →
 * `@Slack`) so they chip when the prompt is populated into the chat input —
 * the auto-mention pipeline deliberately ignores un-prefixed names (mention
 * treatment is strictly opt-in via a token-starting `@`), so curated prompts
 * that should chip must opt in here. Idempotent: names already prefixed with
 * `@` are left untouched.
 */
export function mentionifyIntegrations(text: string): string {
  const { regex } = getIntegrationMatcher()
  if (!regex || !text) return text
  return text.replace(regex, (match: string, _name: string, offset: number) =>
    offset > 0 && text[offset - 1] === '@' ? match : `@${match}`
  )
}

/**
 * Stores a CURATED prompt (a suggested action, template, or showcase CTA — never
 * free-form user prose) for the home chat input to consume after navigation,
 * running it through {@link mentionifyIntegrations} first so its integration
 * names chip with brand icons on arrival.
 *
 * This is the single seam every curated-prompt producer that hands off via
 * {@link LandingPromptStorage} must use — it pairs the rewrite with the store so
 * a new producer cannot forget the rewrite (the regression class this guards
 * against). User-typed prose (e.g. the landing preview panel) intentionally
 * bypasses this and calls {@link LandingPromptStorage.store} directly, since
 * bare integration names in prose must never be auto-chipped (the scunthorpe
 * problem).
 */
export function storeCuratedPrompt(prompt: string): boolean {
  return LandingPromptStorage.store(mentionifyIntegrations(prompt))
}

/**
 * Lazily builds (once per session) and returns all known integrations sorted
 * alphabetically by display name for menu rendering. Shares the underlying
 * scan with {@link getIntegrationMatcher} so the registry is iterated at most
 * once per call site.
 */
export function listIntegrations(): readonly IntegrationDescriptor[] {
  if (cachedList) return cachedList
  const { byName } = getIntegrationMatcher()
  cachedList = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  return cachedList
}

/**
 * The integrations a surface should lead with when it can only show a handful,
 * most-reached-for first.
 *
 * Keyed by NORMALIZED DISPLAY NAME rather than block type on purpose: the matcher
 * dedups versioned blocks down to one descriptor per display name
 * ({@link normalizeDisplayName}), so `gmail` and a future `gmail_v2` collapse to
 * "Gmail" and only one of them is ever the canonical `blockType`. Ranking by name
 * therefore survives a version bump that ranking by type would silently break —
 * the entry would stop matching and the integration would drop out of the preview
 * with nothing failing.
 *
 * Hand-curated, not derived. The landing page's `POPULAR_WORKFLOWS` is the other
 * popularity signal in the app, but it is built from `getAllBlockMeta()` at module
 * scope and so drags the entire block registry into whatever imports it — which is
 * exactly what a client chat surface must not do.
 */
export const POPULAR_INTEGRATION_NAMES: readonly string[] = [
  'Slack',
  'Gmail',
  'Notion',
  'Linear',
  'GitHub',
  'Google Sheets',
  'Google Drive',
  'Google Calendar',
  'Google Docs',
  'Jira',
  'Airtable',
  'HubSpot',
  'Salesforce',
  'Discord',
]

const POPULAR_RANK = new Map(
  POPULAR_INTEGRATION_NAMES.map((name, index) => [name.toLowerCase(), index])
)

/**
 * Orders by {@link POPULAR_INTEGRATION_NAMES} rank first, then alphabetically.
 * Exported for direct testing — the ordering rule needs no block registry.
 */
export function byIntegrationPopularity(a: { name: string }, b: { name: string }): number {
  const unranked = POPULAR_RANK.size
  const rankA = POPULAR_RANK.get(a.name.toLowerCase()) ?? unranked
  const rankB = POPULAR_RANK.get(b.name.toLowerCase()) ?? unranked
  return rankA === rankB ? a.name.localeCompare(b.name) : rankA - rankB
}

/**
 * Every integration, the curated popular ones first (in
 * {@link POPULAR_INTEGRATION_NAMES} order) and the rest alphabetically after.
 *
 * For surfaces that show a truncated preview — the `@`-mention list takes the first
 * few — where plain alphabetical order means leading with whatever happens to sort
 * first (1Password, Affinity, AgentMail) rather than anything a user is likely to
 * want. {@link listIntegrations} stays alphabetical for surfaces that show them all.
 */
export function listIntegrationsByPopularity(): readonly IntegrationDescriptor[] {
  if (cachedPopularList) return cachedPopularList
  cachedPopularList = [...listIntegrations()].sort(byIntegrationPopularity)
  return cachedPopularList
}
