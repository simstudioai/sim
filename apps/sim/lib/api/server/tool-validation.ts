import { type NextRequest, NextResponse } from 'next/server'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server/validation'

export type ToolValidationErrorFormat = 'firstError' | 'details' | 'toolDetails'

interface ToolValidationLogger {
  warn(message: string, metadata?: Record<string, unknown>): void
}

export interface ParseToolRequestOptions {
  errorFormat?: ToolValidationErrorFormat
  logger?: ToolValidationLogger
  logMessage?: string
}

/**
 * Parse a tool route request against its contract and produce a tool-shaped
 * 400 response on validation failure.
 *
 * Three error envelope variants are supported via `errorFormat`:
 * - `firstError`  → `{ error: <first issue message> }`
 * - `details`     → `{ error: 'Invalid request data', details: <issues> }` (default)
 * - `toolDetails` → `{ success: false, error: 'Invalid request data', details: <issues> }`
 *
 * For `toolDetails`, an invalid-JSON body is also wrapped as
 * `{ success: false, error: 'Request body must be valid JSON' }` so the caller
 * sees a consistent envelope across both failure modes. The other formats fall
 * back to the default `{ error: 'Request body must be valid JSON' }` shape.
 */
export async function parseToolRequest<C extends AnyApiRouteContract>(
  contract: C,
  request: NextRequest,
  options: ParseToolRequestOptions = {}
) {
  const errorFormat: ToolValidationErrorFormat = options.errorFormat ?? 'details'

  return parseRequest(
    contract,
    request,
    {},
    {
      invalidJsonResponse:
        errorFormat === 'toolDetails'
          ? () =>
              NextResponse.json(
                { success: false, error: 'Request body must be valid JSON' },
                { status: 400 }
              )
          : undefined,
      validationErrorResponse: (error) => {
        options.logger?.warn(options.logMessage ?? 'Invalid request data', { errors: error.issues })

        if (errorFormat === 'firstError') {
          return NextResponse.json(
            { error: error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 }
          )
        }

        if (errorFormat === 'toolDetails') {
          return NextResponse.json(
            { success: false, error: 'Invalid request data', details: error.issues },
            { status: 400 }
          )
        }

        return NextResponse.json(
          { error: 'Invalid request data', details: error.issues },
          { status: 400 }
        )
      },
    }
  )
}
