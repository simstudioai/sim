import { GetQueryExecutionCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaGetQueryExecutionContract } from '@/lib/api/contracts/tools/aws/athena-get-query-execution'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaGetQueryExecution')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaGetQueryExecutionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

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
    const errorMessage = getErrorMessage(error, 'Failed to get Athena query execution')
    logger.error('GetQueryExecution failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
