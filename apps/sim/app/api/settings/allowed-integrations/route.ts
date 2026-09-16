import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getIntegrationAvailability,
  getOAuthServiceAvailability,
} from '@/lib/integrations/availability.server'
import { getAllOAuthServices } from '@/lib/oauth/utils'

export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    allowedIntegrations: getAllowedIntegrationsFromEnv(),
    integrationAvailability: getIntegrationAvailability().map(
      ({ type, state, oauthAvailable }) => ({ type, state, oauthAvailable })
    ),
    oauthServiceAvailability: getOAuthServiceAvailability(getAllOAuthServices()),
  })
})
