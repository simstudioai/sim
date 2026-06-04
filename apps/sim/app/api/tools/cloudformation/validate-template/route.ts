import { CloudFormationClient, ValidateTemplateCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCloudformationValidateTemplateContract } from '@/lib/api/contracts/tools/aws/cloudformation-validate-template'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CloudFormationValidateTemplate')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCloudformationValidateTemplateContract, request, {
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

    const command = new ValidateTemplateCommand({
      TemplateBody: validatedData.templateBody,
    })

    const response = await client.send(command)

    return NextResponse.json({
      success: true,
      output: {
        description: response.Description,
        parameters: (response.Parameters ?? []).map((p) => ({
          parameterKey: p.ParameterKey,
          defaultValue: p.DefaultValue,
          noEcho: p.NoEcho,
          description: p.Description,
        })),
        capabilities: response.Capabilities ?? [],
        capabilitiesReason: response.CapabilitiesReason,
        declaredTransforms: response.DeclaredTransforms ?? [],
      },
    })
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Failed to validate CloudFormation template')
    logger.error('ValidateTemplate failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
})
