import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  cloudwatchLogStreamsBodySchema,
  cloudwatchSelectorLogStreamsContract,
} from '@/lib/api/contracts/selectors/cloudwatch'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authenticateSelectorRequest,
  resolveAuthorizedSelectorContext,
} from '@/lib/selectors/server/resolve-authorized-context'
import { createCloudWatchLogsClient, describeLogStreams } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchSelectorLogStreamsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(cloudwatchSelectorLogStreamsContract, request, {})
    if (!parsed.success) return parsed.response

    const { workflowId, prefix, limit, logGroupName, ...context } = parsed.data.body
    const resolution = await resolveAuthorizedSelectorContext(authentication.principal, {
      workflowId,
      context,
    })
    if (!resolution.ok) {
      return NextResponse.json({ error: resolution.error }, { status: resolution.status })
    }

    const validated = cloudwatchLogStreamsBodySchema.safeParse({
      ...resolution.context,
      prefix,
      limit,
      logGroupName,
    })
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid CloudWatch selector configuration' },
        { status: 400 }
      )
    }

    const client = createCloudWatchLogsClient(validated.data)
    try {
      const result = await describeLogStreams(client, validated.data.logGroupName, {
        prefix: validated.data.prefix,
        limit: validated.data.limit,
      })
      return NextResponse.json({
        logStreams: result.logStreams.map(({ logStreamName }) => ({ logStreamName })),
      })
    } finally {
      client.destroy()
    }
  } catch {
    logger.error('CloudWatch selector log-stream request failed')
    return NextResponse.json(
      { error: 'Failed to retrieve CloudWatch log streams' },
      { status: 500 }
    )
  }
})
