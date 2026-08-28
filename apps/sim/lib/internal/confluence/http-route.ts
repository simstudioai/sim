import type { Logger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ConfluenceOperationError } from '@/lib/internal/confluence/errors'
import type { ConfluenceOperationContext } from '@/lib/internal/confluence/operations'

type ConfluenceRequestParseResult<T> =
  | { success: true; data: { body?: T; query?: T } }
  | { success: false; response: Response }

interface ConfluenceHttpRouteConfig<T> {
  logger: Logger
  parse: (request: NextRequest) => Promise<ConfluenceRequestParseResult<T>>
  execute: (input: T, context: ConfluenceOperationContext) => Promise<unknown>
}

export function createConfluenceHttpRoute<T>({
  logger,
  parse,
  execute,
}: ConfluenceHttpRouteConfig<T>) {
  return withRouteHandler(async (request: NextRequest) => {
    try {
      const auth = await checkSessionOrInternalAuth(request)
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }
      const parsed = await parse(request)
      if (!parsed.success) return parsed.response
      const input = parsed.data.body ?? parsed.data.query
      if (!input) throw new Error('Parsed Confluence request is missing input')
      return NextResponse.json(
        await execute(input, {
          headers: request.headers,
          requestId: request.headers.get('x-request-id') || 'confluence-http',
          signal: request.signal,
          userId: auth.userId,
        })
      )
    } catch (error) {
      request.signal.throwIfAborted()
      const status = error instanceof ConfluenceOperationError ? error.status : 500
      const message = getErrorMessage(error, 'Internal server error')
      logger.error('Confluence operation failed', { error: message })
      return NextResponse.json(
        error instanceof ConfluenceOperationError && error.body ? error.body : { error: message },
        { status }
      )
    }
  })
}
