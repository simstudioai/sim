import { StopQueryExecutionCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaStopQuery')

const StopQuerySchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  queryExecutionId: z.string().min(1, 'Query execution ID is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const data = StopQuerySchema.parse(body)

    const client = createAthenaClient({
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
    })

    const command = new StopQueryExecutionCommand({
      QueryExecutionId: data.queryExecutionId,
    })

    await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        success: true,
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to stop Athena query'
    logger.error('StopQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
