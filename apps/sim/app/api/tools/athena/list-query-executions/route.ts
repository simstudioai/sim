import { ListQueryExecutionsCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaListQueryExecutionsContract } from '@/lib/api/contracts/tools/aws/athena-list-query-executions'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaListQueryExecutions')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaListQueryExecutionsContract, request, {
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

    const command = new ListQueryExecutionsCommand({
      ...(data.workGroup && { WorkGroup: data.workGroup }),
      ...(data.maxResults !== undefined && { MaxResults: data.maxResults }),
      ...(data.nextToken && { NextToken: data.nextToken }),
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        queryExecutionIds: response.QueryExecutionIds ?? [],
        nextToken: response.NextToken ?? null,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to list Athena query executions')
    logger.error('ListQueryExecutions failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
