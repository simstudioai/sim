import { type NextRequest, NextResponse } from 'next/server'
import { functionExecuteContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  executeFunctionRequest,
  projectFunctionValidationResponse,
} from '@/lib/function-execution/execute-request'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Static host ceiling; the trusted workflow deadline applies the smaller per-call budget. */
export const maxDuration = 604800

/**
 * Accepts legacy Function requests from pre-direct-execution tasks during a blue/green rollout.
 * Remove this adapter only after those tasks have drained past the maximum execution window.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const auth = await checkInternalAuth(req)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }
  const parsed = await parseRequest(functionExecuteContract, req, {})
  if (!parsed.success) return projectFunctionValidationResponse(req, parsed.response)
  return executeFunctionRequest(req, parsed.data.body, {
    userId: auth.userId,
    ...(auth.sandboxProfile === 'mothership' ? { sandboxProfile: 'mothership' } : {}),
  })
})
