import { CloudFormationClient, CreateStackCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationCreateStackContract } from '@/lib/api/contracts/tools/aws/cloudformation-create-stack'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseCapabilities, toStackParameters, toStackTags } from '../utils'

const logger = createLogger('CloudFormationCreateStack')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationCreateStackContract, request, {
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

    logger.info(`Creating CloudFormation stack "${validatedData.stackName}"`)

    const command = new CreateStackCommand({
      StackName: validatedData.stackName,
      TemplateBody: validatedData.templateBody,
      Parameters: toStackParameters(validatedData.parameters),
      Capabilities: parseCapabilities(validatedData.capabilities),
      Tags: toStackTags(validatedData.tags),
      OnFailure: validatedData.onFailure,
      TimeoutInMinutes: validatedData.timeoutInMinutes,
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        stackId: response.StackId ?? '',
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to create CloudFormation stack')
    logger.error('CreateStack failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
