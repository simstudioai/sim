import { fetchAppConfigProfile } from '@/lib/core/config/appconfig'
import type { AppConfigGateContext, AppConfigGateRule } from '@/lib/core/config/appconfig-rules'
import { matchesRule, parseGateConfig } from '@/lib/core/config/appconfig-rules'
import { env } from '@/lib/core/config/env'
import { getPreviewBlocksFromEnv, isAppConfigEnabled } from '@/lib/core/config/env-flags'

/**
 * Name of the AppConfig configuration profile holding per-block visibility rules.
 * Cross-repo contract: must match the `CfnConfigurationProfile` name created by
 * the infra stack (`BLOCK_VISIBILITY_PROFILE_NAME`).
 */
const BLOCK_VISIBILITY_PROFILE = 'block-visibility'

/**
 * Custom (deploy-as-block) block types are org-scoped and managed by their own
 * enabled/disabled lifecycle — the visibility document must never gate them.
 * Literal mirrors `CUSTOM_BLOCK_TYPE_PREFIX` in `@/blocks/custom/build-config`,
 * not imported to keep the blocks graph out of this config module.
 */
const CUSTOM_BLOCK_KEY_PREFIX = 'custom_block_'

/** Per-request evaluation context; same shape as the feature-flag context. */
export type BlockVisibilityContext = AppConfigGateContext

/**
 * The evaluated per-viewer visibility projection.
 *
 * - `revealed` — preview block types this viewer may see.
 * - `disabled` — types whose rule exists but matched no clause; hides
 *   non-preview (shipped) blocks from discovery surfaces (the kill switch).
 * - `previewTagged` — revealed types not globally GA (`enabled !== true`);
 *   the registry appends " (Preview)" to their names.
 *
 * All three are needed: `revealed \ previewTagged` is the "GA'd via config while
 * `preview: true` is still in code" window, and `disabled` targets a disjoint
 * (non-preview) population.
 */
export interface BlockVisibilityState {
  revealed: Set<string>
  disabled: Set<string>
  previewTagged: Set<string>
}

function parseVisibilityConfig(json: unknown): Record<string, AppConfigGateRule> {
  const rules = parseGateConfig(json)
  for (const key of Object.keys(rules)) {
    if (key.startsWith(CUSTOM_BLOCK_KEY_PREFIX)) delete rules[key]
  }
  return rules
}

/**
 * Resolve platform-admin status lazily. Dynamically imported so the DB-backed
 * helper (and `@sim/db`) stay out of this config module's load graph for callers
 * that never reach an admin-gated rule.
 */
async function resolveAdmin(userId: string): Promise<boolean> {
  const { isPlatformAdmin } = await import('@/lib/permissions/super-user')
  return isPlatformAdmin(userId)
}

/**
 * Evaluate the block-visibility document for a viewer.
 *
 * On hosted deployments the rules come from the AppConfig profile (cached,
 * ~30s TTL); off-AppConfig the `PREVIEW_BLOCKS` env allowlist is the only
 * reveal path and nothing is disabled.
 *
 * Unlike feature-flags (one rule per call, admin resolved lazily per rule),
 * this evaluates the whole document, so platform-admin status is resolved at
 * most ONCE per call — and only when some rule actually has `adminEnabled` and
 * the caller didn't already supply `ctx.isAdmin`.
 */
export async function getBlockVisibility(
  ctx: BlockVisibilityContext = {}
): Promise<BlockVisibilityState> {
  if (!isAppConfigEnabled) {
    const revealed = new Set(getPreviewBlocksFromEnv())
    return { revealed, disabled: new Set(), previewTagged: new Set(revealed) }
  }

  const rules =
    (await fetchAppConfigProfile(
      {
        application: env.APPCONFIG_APPLICATION as string,
        environment: env.APPCONFIG_ENVIRONMENT as string,
        profile: BLOCK_VISIBILITY_PROFILE,
      },
      parseVisibilityConfig
    )) ?? {}

  const needsAdmin =
    ctx.isAdmin === undefined &&
    Boolean(ctx.userId) &&
    Object.values(rules).some((rule) => rule.adminEnabled)
  const isAdmin = ctx.isAdmin ?? (needsAdmin ? await resolveAdmin(ctx.userId as string) : false)

  const revealed = new Set<string>()
  const disabled = new Set<string>()
  const previewTagged = new Set<string>()
  for (const [type, rule] of Object.entries(rules)) {
    if (matchesRule(rule, ctx, isAdmin)) {
      revealed.add(type)
      if (rule.enabled !== true) previewTagged.add(type)
    } else {
      disabled.add(type)
    }
  }
  return { revealed, disabled, previewTagged }
}
