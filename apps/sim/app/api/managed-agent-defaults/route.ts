import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('ManagedAgentDefaultsAPI')

interface DefaultRow {
  cells: Record<string, string>
}

/**
 * Read the JSON defaults for the Claude Managed Agents (self-hosted)
 * block's Session parameters table from the SERVER-ONLY env var
 * `MANAGED_AGENT_SELF_HOSTED_DEFAULTS`. Kept behind an API route (rather
 * than a `NEXT_PUBLIC_*` var) so seeded values never leak into the
 * client bundle at build time — deployers can safely put anything the
 * self-hosted agent sandbox reads without inadvertently shipping it to
 * the browser.
 */
function readSelfHostedDefaults(): DefaultRow[] {
  const raw = env.MANAGED_AGENT_SELF_HOSTED_DEFAULTS
  if (typeof raw !== 'string' || raw.trim().length === 0) return []
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const rows: DefaultRow[] = []
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const k = typeof key === 'string' ? key.trim() : ''
      if (!k) continue
      const v = value == null ? '' : typeof value === 'string' ? value : String(value)
      rows.push({ cells: { Key: k, Value: v } })
    }
    return rows
  } catch (error) {
    logger.warn('Failed to parse MANAGED_AGENT_SELF_HOSTED_DEFAULTS', { error })
    return []
  }
}

/**
 * GET /api/managed-agent-defaults
 *
 * Returns the deployer-configured default rows the block picker seeds
 * into a fresh Claude Managed Agents (self-hosted) block. No auth
 * required — the response contains only default keys the deployer
 * chose to expose to their workflow authors; there is no per-user or
 * per-workspace state.
 */
export const GET = withRouteHandler(async (_request: NextRequest) => {
  return NextResponse.json({ selfHosted: readSelfHostedDefaults() }, { status: 200 })
})
