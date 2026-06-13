import { type NextRequest, NextResponse } from 'next/server'
import { getMyMemberCreditsContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { checkOrgMemberUsageLimit } from '@/lib/billing/calculations/usage-monitor'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

/**
 * GET /api/billing/member-credits?workspaceId=...
 *
 * Returns the caller's OWN per-member usage and cap inside the workspace's
 * organization, in DOLLARS (the DB unit) so the client's `formatCredits` does the
 * single dollars→credits conversion. Own-data only, so no admin gate (unlike the
 * org/member admin route). Reuses {@link checkOrgMemberUsageLimit}, which yields a
 * null limit — and the chip falls back to the plan-level view — whenever no
 * per-member cap applies: non-hosted, the workspace isn't org-owned, or no cap is
 * set for this member.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getMyMemberCreditsContract, request, {})
  if (!parsed.success) return parsed.response

  const { workspaceId } = parsed.data.query
  const { currentUsage, limit } = await checkOrgMemberUsageLimit(session.user.id, workspaceId)

  return NextResponse.json({
    success: true,
    data: {
      usedDollars: currentUsage,
      limitDollars: limit,
    },
  })
})
