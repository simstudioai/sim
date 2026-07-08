import { CloudFormationClient, UpdateStackCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationUpdateStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-update-stack'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseCapabilities, toStackParameters, toStackTags } from '../utils'

const logger = createLogger('CloudFormationUpdateStack')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationUpdateStackContract, request, {
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

    logger.info(`Updating CloudFormation stack "${validatedData.stackName}"`)

    try {
      const command = new UpdateStackCommand({
        StackName: validatedData.stackName,
        TemplateBody: validatedData.templateBody,
        UsePreviousTemplate: validatedData.usePreviousTemplate,
        Parameters: toStackParameters(validatedData.parameters),
        Capabilities: parseCapabilities(validatedData.capabilities),
        Tags: toStackTags(validatedData.tags),
      })

      const response = await client.send(command)

      return NextResponse.json({
        success: true,
        output: {
          stackId: response.StackId ?? '',
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to update CloudFormation stack')
    logger.error('UpdateStack failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
