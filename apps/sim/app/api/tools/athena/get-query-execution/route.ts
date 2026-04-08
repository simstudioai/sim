import { GetQueryExecutionCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaGetQueryExecution')

const GetQueryExecutionSchema = z.object({
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
    const data = GetQueryExecutionSchema.parse(body)

    const client = createAthenaClient({
      region: data.region,
      accessKeyId: data.accessKeyId,
      secretAccessKey: data.secretAccessKey,
    })

    const command = new GetQueryExecutionCommand({
      QueryExecutionId: data.queryExecutionId,
    })

    const response = await client.send(command)
    const execution = response.QueryExecution

    if (!execution) {
      throw new Error('No query execution data returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        queryExecutionId: execution.QueryExecutionId ?? data.queryExecutionId,
        query: execution.Query ?? '',
        state: execution.Status?.State ?? 'UNKNOWN',
        stateChangeReason: execution.Status?.StateChangeReason ?? null,
        statementType: execution.StatementType ?? null,
        database: execution.QueryExecutionContext?.Database ?? null,
        catalog: execution.QueryExecutionContext?.Catalog ?? null,
        workGroup: execution.WorkGroup ?? null,
        submissionDateTime: execution.Status?.SubmissionDateTime?.getTime() ?? null,
        completionDateTime: execution.Status?.CompletionDateTime?.getTime() ?? null,
        dataScannedInBytes: execution.Statistics?.DataScannedInBytes ?? null,
        engineExecutionTimeInMillis: execution.Statistics?.EngineExecutionTimeInMillis ?? null,
        queryPlanningTimeInMillis: execution.Statistics?.QueryPlanningTimeInMillis ?? null,
        queryQueueTimeInMillis: execution.Statistics?.QueryQueueTimeInMillis ?? null,
        totalExecutionTimeInMillis: execution.Statistics?.TotalExecutionTimeInMillis ?? null,
        outputLocation: execution.ResultConfiguration?.OutputLocation ?? null,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get Athena query execution'
    logger.error('GetQueryExecution failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
