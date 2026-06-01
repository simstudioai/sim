import { ListNamedQueriesCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaListNamedQueriesContract } from '@/lib/api/contracts/tools/aws/athena-list-named-queries'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaListNamedQueries')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaListNamedQueriesContract, request, {
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

    const command = new ListNamedQueriesCommand({
      ...(data.workGroup && { WorkGroup: data.workGroup }),
      ...(data.maxResults !== undefined && { MaxResults: data.maxResults }),
      ...(data.nextToken && { NextToken: data.nextToken }),
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        namedQueryIds: response.NamedQueryIds ?? [],
        nextToken: response.NextToken ?? null,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to list Athena named queries')
    logger.error('ListNamedQueries failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
