import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAllowedMcpDomainsFromEnv } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const GET = withRouteHandler(async () => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configuredDomains = getAllowedMcpDomainsFromEnv()
  if (configuredDomains === null) {
    return NextResponse.json({ allowedMcpDomains: null })
  }

  try {
    const platformHostname = new URL(getBaseUrl()).hostname.toLowerCase()
    if (!configuredDomains.includes(platformHostname)) {
      return NextResponse.json({
        allowedMcpDomains: [...configuredDomains, platformHostname],
      })
    }
  } catch {}

  return NextResponse.json({ allowedMcpDomains: configuredDomains })
})
