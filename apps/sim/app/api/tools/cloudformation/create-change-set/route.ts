import { CloudFormationClient, CreateChangeSetCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationCreateChangeSetContract } from '@/lib/api/contracts/tools/aws/cloudformation-create-change-set'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseCapabilities, toStackParameters } from '../utils'

const logger = createLogger('CloudFormationCreateChangeSet')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationCreateChangeSetContract, request, {
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

    logger.info(
      `Creating change set "${validatedData.changeSetName}" for stack "${validatedData.stackName}"`
    )

    try {
      const command = new CreateChangeSetCommand({
        StackName: validatedData.stackName,
        ChangeSetName: validatedData.changeSetName,
        TemplateBody: validatedData.templateBody,
        UsePreviousTemplate: validatedData.usePreviousTemplate,
        Parameters: toStackParameters(validatedData.parameters),
        Capabilities: parseCapabilities(validatedData.capabilities),
        ChangeSetType: validatedData.changeSetType,
        Description: validatedData.description,
      })

      const response = await client.send(command)

      return NextResponse.json({
        success: true,
        output: {
          changeSetId: response.Id ?? '',
          stackId: response.StackId ?? '',
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to create CloudFormation change set')
    logger.error('CreateChangeSet failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
