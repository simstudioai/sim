import { type NextRequest, NextResponse } from 'next/server'
import { sweepPeopleDirectoriesContract } from '@/lib/api/contracts/people-sync-cron'
import { parseRequest } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { syncDueDirectories } from '@/lib/people/sync/runner'

export const maxDuration = 300

export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'People directory synchronization')
  if (authError) return authError
  const parsed = await parseRequest(sweepPeopleDirectoriesContract, request, {})
  if (!parsed.success) return parsed.response
  return NextResponse.json(await syncDueDirectories())
})
