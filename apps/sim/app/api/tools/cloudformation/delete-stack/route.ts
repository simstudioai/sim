import { CloudFormationClient, DeleteStackCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationDeleteStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-delete-stack'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationDeleteStack')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationDeleteStackContract, request, {
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

    logger.info(`Deleting CloudFormation stack "${validatedData.stackName}"`)

    const retainResources = validatedData.retainResources
      ?.split(',')
      .map((r) => r.trim())
      .filter(Boolean)

    const command = new DeleteStackCommand({
      StackName: validatedData.stackName,
      ...(retainResources && retainResources.length > 0 && { RetainResources: retainResources }),
    })

    await client.send(command)

    logger.info(
      `Successfully requested deletion of CloudFormation stack "${validatedData.stackName}"`
    )

    return NextResponse.json({
      success: true,
      output: {
        message: `Deletion of stack "${validatedData.stackName}" has been initiated`,
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to delete CloudFormation stack')
    logger.error('DeleteStack failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
