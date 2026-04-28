import {
  CloudFormationClient,
  DescribeStackDriftDetectionStatusCommand,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDescribeStackDriftDetectionStatus')

const DescribeStackDriftDetectionStatusSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  stackDriftDetectionId: z.string().min(1, 'Stack drift detection ID is required'),
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = DescribeStackDriftDetectionStatusSchema.parse(body)

    const client = new CloudFormationClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    const command = new DescribeStackDriftDetectionStatusCommand({
      StackDriftDetectionId: validatedData.stackDriftDetectionId,
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        stackId: response.StackId ?? '',
        stackDriftDetectionId: response.StackDriftDetectionId ?? '',
        stackDriftStatus: response.StackDriftStatus,
        detectionStatus: response.DetectionStatus ?? 'UNKNOWN',
        detectionStatusReason: response.DetectionStatusReason,
        driftedStackResourceCount: response.DriftedStackResourceCount,
        timestamp: response.Timestamp?.getTime(),
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to describe stack drift detection status'
    logger.error('DescribeStackDriftDetectionStatus failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
