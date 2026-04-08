import { CloudFormationClient, ValidateTemplateCommand } from '@aws-sdk/client-cloudformation'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'

const logger = createLogger('CloudFormationValidateTemplate')

const ValidateTemplateSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
  templateBody: z.string().min(1, 'Template body is required'),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = ValidateTemplateSchema.parse(body)

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to validate CloudFormation template'
    logger.error('ValidateTemplate failed', { error: errorMessage })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
