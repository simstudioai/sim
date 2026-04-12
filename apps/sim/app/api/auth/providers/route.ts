import { NextResponse } from 'next/server'
import { getOAuthProviderStatus } from '@/app/(auth)/components/oauth-provider-checker'

export const dynamic = 'force-dynamic'

export async function GET() {
  const status = await getOAuthProviderStatus()
  return NextResponse.json(status)
}
