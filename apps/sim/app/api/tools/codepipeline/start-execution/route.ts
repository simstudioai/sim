import { CodePipelineClient, StartPipelineExecutionCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineStartExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-start-execution'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineStartExecution')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineStartExecutionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Starting CodePipeline pipeline execution')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new StartPipelineExecutionCommand({
        name: validatedData.pipelineName,
        ...(validatedData.clientRequestToken && {
          clientRequestToken: validatedData.clientRequestToken,
        }),
        ...(validatedData.variables &&
          validatedData.variables.length > 0 && { variables: validatedData.variables }),
      })

      const response = await client.send(command)

      if (!response.pipelineExecutionId) {
        throw new Error('No pipeline execution ID returned')
      }

      logger.info('Successfully started pipeline execution')

      return NextResponse.json({
        success: true,
        output: { pipelineExecutionId: response.pipelineExecutionId },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('StartPipelineExecution failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to start CodePipeline pipeline execution: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
