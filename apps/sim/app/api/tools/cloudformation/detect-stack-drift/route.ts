import { CloudFormationClient, DetectStackDriftCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationDetectStackDriftContract } from '@/lib/api/contracts/tools/aws/cloudformation-detect-stack-drift'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDetectStackDrift')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationDetectStackDriftContract, request, {
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

    const command = new DetectStackDriftCommand({
      StackName: validatedData.stackName,
    })

    const response = await client.send(command)

    if (!response.StackDriftDetectionId) {
      throw new Error('No drift detection ID returned')
    }

    return NextResponse.json({
      success: true,
      output: {
        stackDriftDetectionId: response.StackDriftDetectionId,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to detect CloudFormation stack drift')
    logger.error('DetectStackDrift failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
