import {
  CloudFormationClient,
  DescribeStackEventsCommand,
  type StackEvent,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const logger = createLogger('CloudFormationDescribeStackEvents')

const DescribeStackEventsSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().min(1, 'Stack name is required'),
  limit: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.number({ coerce: true }).int().positive().optional()
  ),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = DescribeStackEventsSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to describe CloudFormation stack events'
    logger.error('DescribeStackEvents failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
