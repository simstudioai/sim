import {
  CloudFormationClient,
  DescribeStackDriftDetectionStatusCommand,
} from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationDescribeStackDriftDetectionStatusContract } from '@/lib/api/contracts/tools/aws/cloudformation-describe-stack-drift-detection-status'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDescribeStackDriftDetectionStatus')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(
      awsCloudformationDescribeStackDriftDetectionStatusContract,
      request,
      {
        errorFormat: 'details',
        logger,
      }
    )
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

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
    const errorMessage = getErrorMessage(error, 'Failed to describe stack drift detection status')
    logger.error('DescribeStackDriftDetectionStatus failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
