import { CreateNamedQueryCommand } from '@aws-sdk/client-athena'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsAthenaCreateNamedQueryContract } from '@/lib/api/contracts/tools/aws/athena-create-named-query'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAthenaClient } from '@/app/api/tools/athena/utils'

const logger = createLogger('AthenaCreateNamedQuery')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsAthenaCreateNamedQueryContract, request, {
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

    const command = new CreateNamedQueryCommand({
      Name: data.name,
      Database: data.database,
      QueryString: data.queryString,
      ...(data.description && { Description: data.description }),
      ...(data.workGroup && { WorkGroup: data.workGroup }),
    })

    const response = await client.send(command)

    if (!response.NamedQueryId) {
      throw new Error('No named query ID returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        namedQueryId: response.NamedQueryId,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to create Athena named query')
    logger.error('CreateNamedQuery failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
