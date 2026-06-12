import {
  CloudFormationClient,
  DescribeStacksCommand,
  type Stack,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationDescribeStacksContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stacks'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDescribeStacks')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationDescribeStacksContract, request, {
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
    const errorMessage = getErrorMessage(error, 'Failed to describe CloudFormation stacks')
    logger.error('DescribeStacks failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
