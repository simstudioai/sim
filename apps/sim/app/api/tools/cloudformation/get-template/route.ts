import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationGetTemplateContract } from '@/lib/api/contracts/tools/aws/cloudformation-get-template'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationGetTemplate')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationGetTemplateContract, request, {
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

    const command = new GetTemplateCommand({
      StackName: validatedData.stackName,
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        templateBody: response.TemplateBody ?? '',
        stagesAvailable: response.StagesAvailable ?? [],
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to get CloudFormation template')
    logger.error('GetTemplate failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
