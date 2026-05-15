import { GetNamedQueryCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaGetNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-get-named-query'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaGetNamedQuery')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaGetNamedQueryContract, request, {
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

    const command = new GetNamedQueryCommand({
      NamedQueryId: data.namedQueryId,
    })

    const response = await client.send(command)
    const namedQuery = response.NamedQuery

    if (!namedQuery) {
      throw new Error('No named query data returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        namedQueryId: namedQuery.NamedQueryId ?? data.namedQueryId,
        name: namedQuery.Name ?? '',
        description: namedQuery.Description ?? null,
        database: namedQuery.Database ?? '',
        queryString: namedQuery.QueryString ?? '',
        workGroup: namedQuery.WorkGroup ?? null,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to get Athena named query')
    logger.error('GetNamedQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
