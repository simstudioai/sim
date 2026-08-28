import type { Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { checkInternalAuth, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CloudWatchInputError } from '@/lib/internal/cloudwatch/operations'

type CloudWatchRequestParseResult<T> =
  | { success: true; data: { body: T } }
  | { success: false; response: Response }

interface CloudWatchHttpRouteConfig<T> {
  logger: Logger
  parse: (request: NextRequest) => Promise<CloudWatchRequestParseResult<T>>
  execute: (input: T, signal?: AbortSignal) => Promise<unknown>
  errorMessage: string
  auth?: 'internal' | 'session-or-internal'
  logError?: (error: unknown) => void
}

export function createCloudWatchHttpRoute<T>({
  logger,
  parse,
  execute,
  errorMessage,
  auth = 'internal',
  logError,
}: CloudWatchHttpRouteConfig<T>) {
  return withRouteHandler(async (request: NextRequest) => {
    try {
      const result =
        auth === 'session-or-internal'
          ? await checkSessionOrInternalAuth(request)
          : await checkInternalAuth(request)
      if (!result.success || !result.userId) {
        return NextResponse.json({ error: result.error || 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parse(request)
      if (!parsed.success) return parsed.response
      return NextResponse.json(await execute(parsed.data.body, request.signal))
    } catch (error) {
      if (error instanceof CloudWatchInputError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      if (logError) logError(error)
      else logger.error(errorMessage, { error: toError(error).message })
      return NextResponse.json(
        { error: `${errorMessage}: ${toError(error).message}` },
        { status: 500 }
      )
    }
  })
}
