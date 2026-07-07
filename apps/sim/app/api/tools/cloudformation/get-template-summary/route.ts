import { CloudFormationClient, GetTemplateSummaryCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationGetTemplateSummaryContract } from '@/lib/api/contracts/tools/aws/cloudformation-get-template-summary'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationGetTemplateSummary')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationGetTemplateSummaryContract, request, {
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

    const command = new GetTemplateSummaryCommand({
      ...(validatedData.templateBody && { TemplateBody: validatedData.templateBody }),
      ...(validatedData.stackName && { StackName: validatedData.stackName }),
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        description: response.Description,
        parameters: (response.Parameters ?? []).map((p) => ({
          parameterKey: p.ParameterKey,
          defaultValue: p.DefaultValue,
          parameterType: p.ParameterType,
          noEcho: p.NoEcho,
          description: p.Description,
        })),
        capabilities: response.Capabilities ?? [],
        capabilitiesReason: response.CapabilitiesReason,
        resourceTypes: response.ResourceTypes ?? [],
        version: response.Version,
        declaredTransforms: response.DeclaredTransforms ?? [],
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to get CloudFormation template summary')
    logger.error('GetTemplateSummary failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
