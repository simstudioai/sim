import { NextResponse } from 'next/server'
import type { UsageLogPeriod } from '@/lib/api/contracts/user'
import type { AuthResult } from '@/lib/auth/hybrid'

const PERIOD_TO_DAYS: Record<'1d' | '7d' | '30d', number> = { '1d': 1, '7d': 7, '30d': 30 }

type WorkspaceFilterResult =
  | { ok: true; workspaceId: string | undefined }
  | { ok: false; response: NextResponse }

/**
 * Resolves the effective `workspaceId` ledger filter for the caller's
 * credential. Sessions, internal JWTs, and personal API keys read the
 * authenticated user's full ledger with whatever filter they asked for; a
 * workspace-scoped API key is pinned to its own workspace — the filter
 * defaults to the key's workspace and an explicit mismatch is rejected rather
 * than silently ignored.
 */
export function resolveUsageLogsWorkspaceFilter(
  auth: AuthResult,
  requestedWorkspaceId: string | undefined
): WorkspaceFilterResult {
  if (auth.apiKeyType !== 'workspace') return { ok: true, workspaceId: requestedWorkspaceId }
  if (requestedWorkspaceId && requestedWorkspaceId !== auth.workspaceId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'API key is not authorized for this workspace' },
        { status: 403 }
      ),
    }
  }
  return { ok: true, workspaceId: auth.workspaceId }
}

interface ResolvedDateRange {
  startDate: Date | undefined
  endDate: Date
}

/** Shared by the list and export routes so their date-filtering can never drift. */
export function resolveDateRange(
  period: UsageLogPeriod,
  customStartDate: string | undefined,
  customEndDate: string | undefined
): ResolvedDateRange {
  if (period === 'custom') {
    if (!customStartDate) throw new Error('startDate is required when period is "custom"')
    return {
      startDate: new Date(customStartDate),
      endDate: customEndDate ? new Date(customEndDate) : new Date(),
    }
  }
  if (period === 'all') return { startDate: undefined, endDate: new Date() }

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - PERIOD_TO_DAYS[period])
  return { startDate, endDate: new Date() }
}
