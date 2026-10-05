import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { desktopInboxStreamContract } from '@/lib/api/contracts/desktop-executor'
import { parseRequest } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { openDesktopInboxStream } from '@/lib/desktop/application/executor'
import { DesktopDeviceUnrecognizedError } from '@/lib/desktop/executor/errors'
import { createSSEStream } from '@/lib/events/sse-endpoint'

export const dynamic = 'force-dynamic'

const logger = createLogger('DesktopInboxStream')

/**
 * The background executor's doorbell. A raw route because it streams: authentication, the device
 * check, and presence all run through the `openDesktopInboxStream` use case.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const principal = await internalSessionAuth.authenticate()
    const parsed = await parseRequest(desktopInboxStreamContract, request, {})
    if (!parsed.success) return parsed.response
    const { deviceId } = parsed.data.query
    const inbox = await openDesktopInboxStream.execute({ principal, input: { deviceId } })
    return createSSEStream(request, {
      label: 'desktop-inbox',
      revalidate: inbox.revalidate,
      subscriptions: [{ subscribe: inbox.subscribe }],
    })
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError)
      return new Response('Unauthorized', { status: 401 })
    if (error instanceof DesktopDeviceUnrecognizedError)
      return new Response(error.message, { status: 401 })
    logger.error('Failed to open the desktop inbox stream', error)
    return new Response('Unable to open the desktop inbox', { status: 500 })
  }
})
