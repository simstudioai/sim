import { NextResponse } from 'next/server'
import { getAllowedMcpDomainsFromEnv } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'

export async function GET() {
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
}
