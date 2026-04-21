import {
  CloudFormationClient,
  DescribeStacksCommand,
  type Stack,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDescribeStacks')

const DescribeStacksSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackName: z.string().optional(),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = DescribeStacksSchema.parse(body)

    const client = new CloudFormationClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const allStacks: Stack[] = []
    let nextToken: string | undefined
    do {
      const command = new DescribeStacksCommand({
        ...(validatedData.stackName && { StackName: validatedData.stackName }),
        ...(nextToken && { NextToken: nextToken }),
      })
      const response = await client.send(command)
      allStacks.push(...(response.Stacks ?? []))
      nextToken = response.NextToken
    } while (nextToken)

    const stacks = allStacks.map((s) => ({
      stackName: s.StackName ?? '',
      stackId: s.StackId ?? '',
      stackStatus: s.StackStatus ?? 'UNKNOWN',
      stackStatusReason: s.StackStatusReason,
      creationTime: s.CreationTime?.getTime(),
      lastUpdatedTime: s.LastUpdatedTime?.getTime(),
      description: s.Description,
      enableTerminationProtection: s.EnableTerminationProtection,
      driftInformation: s.DriftInformation
        ? {
            stackDriftStatus: s.DriftInformation.StackDriftStatus,
            lastCheckTimestamp: s.DriftInformation.LastCheckTimestamp?.getTime(),
          }
        : null,
      outputs: (s.Outputs ?? []).map((o) => ({
        outputKey: o.OutputKey ?? '',
        outputValue: o.OutputValue ?? '',
        description: o.Description,
      })),
      tags: (s.Tags ?? []).map((t) => ({
        key: t.Key ?? '',
        value: t.Value ?? '',
      })),
    }))

    return NextResponse.json({
      success: true,
      output: { stacks },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to describe CloudFormation stacks'
    logger.error('DescribeStacks failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
