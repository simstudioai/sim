import { StartQueryExecutionCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaStartQueryContract } from '@/lib/api/contracts/tools/aws/athena-start-query'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaStartQuery')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaStartQueryContract, request, {
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
    const errorMessage = getErrorMessage(error, 'Failed to start Athena query')
    logger.error('StartQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
