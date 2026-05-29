import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getOAuthProviderConfigContract } from '@/lib/api/contracts/auth'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getOAuthProviderConfigStatus } from '@/lib/oauth/provider-config'

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getOAuthProviderConfigContract, request, {})
  if (!parsed.success) return parsed.response

  return NextResponse.json(getOAuthProviderConfigStatus(parsed.data.query.providerId))
})
