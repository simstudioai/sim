import { CancelUpdateStackCommand, CloudFormationClient } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationCancelUpdateStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-cancel-update-stack'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationCancelUpdateStack')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationCancelUpdateStackContract, request, {
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

    logger.info(`Cancelling update for CloudFormation stack "${validatedData.stackName}"`)

    try {
      const command = new CancelUpdateStackCommand({
        StackName: validatedData.stackName,
      })

      await client.send(command)

      return NextResponse.json({
        success: true,
        output: {
          message: `Update for stack "${validatedData.stackName}" is being cancelled and rolled back`,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to cancel CloudFormation stack update')
    logger.error('CancelUpdateStack failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
