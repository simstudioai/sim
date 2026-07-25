/**
 * Shared parsing and clause evaluation for AppConfig gating documents
 * (`feature-flags`, `block-visibility`). Both documents are maps of key →
 * gate rule with identical rule shapes; this module is the single copy of the
 * security-sensitive normalization that prevents a malformed document from
 * granting access. Admin-resolution *scheduling* deliberately stays with the
 * callers (feature-flags resolves lazily per rule; block-visibility resolves
 * once per document), so {@link matchesRule} takes an explicit `isAdmin`.
 */

/**
 * A single gating rule. A gate is open for a context when ANY clause matches:
 * the global `enabled` default, the org/user allowlists, or `adminEnabled` for
 * platform admins. An absent clause never matches.
 */
export interface AppConfigGateRule {
  enabled?: boolean
  orgIds?: string[]
  userIds?: string[]
  adminEnabled?: boolean
}

/**
 * Per-request evaluation context. Pass only the ids you have — a missing id
 * skips its clause. `isAdmin` is a fast-path override for callers that already
 * resolved platform-admin status.
 */
export interface AppConfigGateContext {
  userId?: string | null
  orgId?: string | null
  isAdmin?: boolean
}

function normalizeIds(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const ids = Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)))
  return ids.length > 0 ? ids : undefined
}

/** Coerce a single arbitrary JSON value into a rule, or `null` when malformed. */
export function normalizeRule(value: unknown): AppConfigGateRule | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const rule: AppConfigGateRule = {}
  if (typeof obj.enabled === 'boolean') rule.enabled = obj.enabled
  if (typeof obj.adminEnabled === 'boolean') rule.adminEnabled = obj.adminEnabled
  const orgIds = normalizeIds(obj.orgIds)
  if (orgIds) rule.orgIds = orgIds
  const userIds = normalizeIds(obj.userIds)
  if (userIds) rule.userIds = userIds
  return rule
}

/** Coerce an arbitrary AppConfig/JSON document into a rule map, dropping malformed entries. */
export function parseGateConfig(json: unknown): Record<string, AppConfigGateRule> {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const rules: Record<string, AppConfigGateRule> = {}
  for (const [key, value] of Object.entries(obj)) {
    const rule = normalizeRule(value)
    if (rule) rules[key] = rule
  }
  return rules
}

/**
 * Pure OR-of-clauses check. The caller supplies `isAdmin` — pass `false` to
 * evaluate only the non-admin clauses (for lazy admin resolution).
 */
export function matchesRule(
  rule: AppConfigGateRule | undefined,
  ctx: AppConfigGateContext,
  isAdmin: boolean
): boolean {
  if (!rule) return false
  if (rule.enabled) return true
  if (ctx.userId && rule.userIds?.includes(ctx.userId)) return true
  if (ctx.orgId && rule.orgIds?.includes(ctx.orgId)) return true
  if (rule.adminEnabled && isAdmin) return true
  return false
}
