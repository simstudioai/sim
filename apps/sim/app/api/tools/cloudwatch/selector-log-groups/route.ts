import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  cloudwatchLogGroupsBodySchema,
  cloudwatchSelectorLogGroupsContract,
} from '@/lib/api/contracts/selectors/cloudwatch'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authenticateSelectorRequest,
  resolveAuthorizedSelectorContext,
} from '@/lib/selectors/server/resolve-authorized-context'
import { createCloudWatchLogsClient, describeLogGroups } from '@/app/api/tools/cloudwatch/utils'

const logger = createLogger('CloudWatchSelectorLogGroupsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const authentication = await authenticateSelectorRequest(request)
    if (!authentication.ok) {
      return NextResponse.json({ error: authentication.error }, { status: authentication.status })
    }
    const parsed = await parseRequest(cloudwatchSelectorLogGroupsContract, request, {})
    if (!parsed.success) return parsed.response

    const { workflowId, prefix, limit, ...context } = parsed.data.body
    const resolution = await resolveAuthorizedSelectorContext(authentication.principal, {
      workflowId,
      context,
    })
    if (!resolution.ok) {
      return NextResponse.json({ error: resolution.error }, { status: resolution.status })
    }

    const validated = cloudwatchLogGroupsBodySchema.safeParse({
      ...resolution.context,
      prefix,
      limit,
    })
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid CloudWatch selector configuration' },
        { status: 400 }
      )
    }

    const client = createCloudWatchLogsClient(validated.data)
    try {
      const result = await describeLogGroups(client, {
        prefix: validated.data.prefix,
        limit: validated.data.limit,
      })
      return NextResponse.json({
        logGroups: result.logGroups.map(({ logGroupName }) => ({ logGroupName })),
      })
    } finally {
      client.destroy()
    }
  } catch {
    logger.error('CloudWatch selector log-group request failed')
    return NextResponse.json({ error: 'Failed to retrieve CloudWatch log groups' }, { status: 500 })
  }
})
