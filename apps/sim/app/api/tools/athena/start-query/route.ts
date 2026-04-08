import { StartQueryExecutionCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaStartQuery')

const StartQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryString: z.string().min(1, 'Query string is required'),
  database: z.string().optional(),
  catalog: z.string().optional(),
  outputLocation: z.string().optional(),
  workGroup: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = StartQuerySchema.parse(body)

    const client = createAthenaClient({
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
    })

    const command = new StartQueryExecutionCommand({
      QueryString: data.queryString,
      ...(data.database || data.catalog
        ? {
            QueryExecutionContext: {
              ...(data.database && { Database: data.database }),
              ...(data.catalog && { Catalog: data.catalog }),
            },
          }
        : {}),
      ...(data.outputLocation
        ? {
            ResultConfiguration: {
              OutputLocation: data.outputLocation,
            },
          }
        : {}),
      ...(data.workGroup && { WorkGroup: data.workGroup }),
    })

    const response = await client.send(command)

    if (!response.QueryExecutionId) {
      throw new Error('No query execution ID returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        queryExecutionId: response.QueryExecutionId,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to start Athena query'
    logger.error('StartQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
