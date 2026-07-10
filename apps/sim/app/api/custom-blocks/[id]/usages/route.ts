import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getCustomBlockUsageCountsContract } from '@/lib/api/contracts/custom-blocks'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCustomBlockUsageCounts } from '@/lib/workflows/custom-blocks/operations'
import { authorizeManage } from '@/app/api/custom-blocks/[id]/authorize-manage'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getCustomBlockUsageCountsContract, request, context)
  if (!parsed.success) return parsed.response

  const authz = await authorizeManage(session.user.id, parsed.data.params.id)
  if (authz.error) return authz.error

  const counts = await getCustomBlockUsageCounts(authz.ctx.organizationId, authz.ctx.type)
  return NextResponse.json(counts)
})
