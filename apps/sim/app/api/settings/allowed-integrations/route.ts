import { NextResponse } from 'next/server'
import { getAllowedIntegrationsFromEnv } from '@/lib/core/config/feature-flags'

export async function GET() {
  return NextResponse.json({
    allowedIntegrations: getAllowedIntegrationsFromEnv(),
  })
}
