import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    allowedIntegrations: getAllowedIntegrationsFromEnv(),
  })
})
