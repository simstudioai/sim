import { CodePipelineClient, StopPipelineExecutionCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineStopExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-stop-execution'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineStopExecution')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineStopExecutionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Stopping CodePipeline pipeline execution')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new StopPipelineExecutionCommand({
        pipelineName: validatedData.pipelineName,
        pipelineExecutionId: validatedData.pipelineExecutionId,
        ...(validatedData.abandon !== undefined && { abandon: validatedData.abandon }),
        ...(validatedData.reason && { reason: validatedData.reason }),
      })

      const response = await client.send(command)

      logger.info('Successfully stopped pipeline execution')

      return NextResponse.json({
        success: true,
        output: {
          pipelineExecutionId: response.pipelineExecutionId ?? validatedData.pipelineExecutionId,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('StopPipelineExecution failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to stop CodePipeline pipeline execution: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
