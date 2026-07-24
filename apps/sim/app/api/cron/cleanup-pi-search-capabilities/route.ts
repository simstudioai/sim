import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { cleanupPiSearchCapabilitiesContract } from '@/lib/api/contracts/pi-search-cleanup'
import { parseRequest } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { cleanupExpiredPiSearchCapabilities } from '@/lib/pi/exa-search/capabilities'

const logger = createLogger('PiSearchCapabilityCleanup')
const LOCK_KEY = 'pi-search-capability-cleanup'
const LOCK_TTL_SECONDS = 120
const BATCH_SIZE = 1_000
const RETENTION_MS = 24 * 60 * 60 * 1000

export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'Pi search capability cleanup')
  if (authError) return authError
  const parsed = await parseRequest(cleanupPiSearchCapabilitiesContract, request, {})
  if (!parsed.success) return parsed.response
  const requestId = generateShortId()
  if (!(await acquireLock(LOCK_KEY, requestId, LOCK_TTL_SECONDS))) {
    return NextResponse.json({ success: true, skipped: true }, { status: 202 })
  }

  try {
    const deleted = await cleanupExpiredPiSearchCapabilities({
      batchSize: BATCH_SIZE,
      retentionBefore: new Date(Date.now() - RETENTION_MS),
    })
    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    const message = getErrorMessage(error, 'Capability cleanup failed')
    logger.error('Pi search capability cleanup failed', { requestId, error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  } finally {
    await releaseLock(LOCK_KEY, requestId).catch(() => {})
  }
})
