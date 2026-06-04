import {
  CloudFormationClient,
  DescribeStackEventsCommand,
  type StackEvent,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationDescribeStackEventsContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stack-events'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDescribeStackEvents')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationDescribeStackEventsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const client = new CloudFormationClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const limit = validatedData.limit ?? 50

    const allEvents: StackEvent[] = []
    let nextToken: string | undefined
    do {
      const command = new DescribeStackEventsCommand({
        StackName: validatedData.stackName,
        ...(nextToken && { NextToken: nextToken }),
      })
      const response = await client.send(command)
      allEvents.push(...(response.StackEvents ?? []))
      nextToken = allEvents.length >= limit ? undefined : response.NextToken
    } while (nextToken)

    const events = allEvents.slice(0, limit).map((e) => ({
      stackId: e.StackId ?? '',
      eventId: e.EventId ?? '',
      stackName: e.StackName ?? '',
      logicalResourceId: e.LogicalResourceId,
      physicalResourceId: e.PhysicalResourceId,
      resourceType: e.ResourceType,
      resourceStatus: e.ResourceStatus,
      resourceStatusReason: e.ResourceStatusReason,
      timestamp: e.Timestamp?.getTime(),
    }))

    return NextResponse.json({
      success: true,
      output: { events },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to describe CloudFormation stack events')
    logger.error('DescribeStackEvents failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
