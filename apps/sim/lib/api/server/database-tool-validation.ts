import { type NextRequest, NextResponse } from 'next/server'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server/validation'

type DatabaseToolValidationErrorFormat = 'firstError' | 'details' | 'toolDetails'

interface DatabaseToolValidationLogger {
  warn(message: string, metadata?: Record<string, unknown>): void
}

interface ParseDatabaseToolRequestOptions {
  errorFormat?: DatabaseToolValidationErrorFormat
  logger?: DatabaseToolValidationLogger
  logMessage?: string
}

export async function parseDatabaseToolRequest<C extends AnyApiRouteContract>(
  contract: C,
  request: NextRequest,
  options: ParseDatabaseToolRequestOptions = {}
) {
  const errorFormat = options.errorFormat ?? 'details'

  return parseRequest(
    contract,
    request,
    {},
    {
      invalidJsonResponse: () => {
        if (errorFormat === 'toolDetails') {
          return NextResponse.json(
            { success: false, error: 'Request body must be valid JSON' },
            { status: 400 }
          )
        }

        return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
      },
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
