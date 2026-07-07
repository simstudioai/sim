import { CloudFormationClient, ExecuteChangeSetCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationExecuteChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-execute-change-set'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationExecuteChangeSet')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationExecuteChangeSetContract, request, {
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

    logger.info(`Executing change set "${validatedData.changeSetName}"`)

    try {
      const command = new ExecuteChangeSetCommand({
        ChangeSetName: validatedData.changeSetName,
        ...(validatedData.stackName && { StackName: validatedData.stackName }),
      })

      await client.send(command)

      return NextResponse.json({
        success: true,
        output: {
          message: `Change set "${validatedData.changeSetName}" execution has been initiated`,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to execute CloudFormation change set')
    logger.error('ExecuteChangeSet failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
