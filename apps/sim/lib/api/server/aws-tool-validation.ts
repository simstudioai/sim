import { type NextRequest, NextResponse } from 'next/server'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server/validation'

type AwsToolValidationErrorFormat = 'firstError' | 'details' | 'toolDetails'

interface AwsToolValidationLogger {
  warn(message: string, metadata?: Record<string, unknown>): void
}

interface ParseAwsToolRequestOptions {
  errorFormat: AwsToolValidationErrorFormat
  logger?: AwsToolValidationLogger
  logMessage?: string
}

export async function parseAwsToolRequest<C extends AnyApiRouteContract>(
  contract: C,
  request: NextRequest,
  options: ParseAwsToolRequestOptions
) {
  return parseRequest(
    contract,
    request,
    {},
    {
      validationErrorResponse: (error) => {
        options.logger?.warn(options.logMessage ?? 'Invalid request data', { errors: error.issues })

        if (options.errorFormat === 'firstError') {
          return NextResponse.json(
            { error: error.issues[0]?.message ?? 'Invalid request' },
            { status: 400 }
          )
        }

        if (options.errorFormat === 'toolDetails') {
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
