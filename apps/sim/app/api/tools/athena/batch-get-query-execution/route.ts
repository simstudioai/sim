import { BatchGetQueryExecutionCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaBatchGetQueryExecutionContract } from '@/lib/api/contracts/tools/aws/athena-batch-get-query-execution'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaBatchGetQueryExecution')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaBatchGetQueryExecutionContract, request, {
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

    const command = new BatchGetQueryExecutionCommand({
      QueryExecutionIds: data.queryExecutionIds,
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        queryExecutions: (response.QueryExecutions ?? []).map((execution) => ({
          queryExecutionId: execution.QueryExecutionId ?? '',
          query: execution.Query ?? null,
          state: execution.Status?.State ?? null,
          stateChangeReason: execution.Status?.StateChangeReason ?? null,
          statementType: execution.StatementType ?? null,
          database: execution.QueryExecutionContext?.Database ?? null,
          catalog: execution.QueryExecutionContext?.Catalog ?? null,
          workGroup: execution.WorkGroup ?? null,
          submissionDateTime: execution.Status?.SubmissionDateTime?.getTime() ?? null,
          completionDateTime: execution.Status?.CompletionDateTime?.getTime() ?? null,
          dataScannedInBytes: execution.Statistics?.DataScannedInBytes ?? null,
          totalExecutionTimeInMillis: execution.Statistics?.TotalExecutionTimeInMillis ?? null,
          outputLocation: execution.ResultConfiguration?.OutputLocation ?? null,
        })),
        unprocessedQueryExecutionIds: (response.UnprocessedQueryExecutionIds ?? []).map((item) => ({
          queryExecutionId: item.QueryExecutionId ?? null,
          errorCode: item.ErrorCode ?? null,
          errorMessage: item.ErrorMessage ?? null,
        })),
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to batch get Athena query executions')
    logger.error('BatchGetQueryExecution failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
