import {
  CodePipelineClient,
  RetryStageExecutionCommand,
  type StageRetryMode,
} from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineRetryStageExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-retry-stage-execution'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineRetryStageExecution')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineRetryStageExecutionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Retrying CodePipeline stage execution')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new RetryStageExecutionCommand({
        pipelineName: validatedData.pipelineName,
        stageName: validatedData.stageName,
        pipelineExecutionId: validatedData.pipelineExecutionId,
        retryMode: validatedData.retryMode as StageRetryMode,
      })

      const response = await client.send(command)

      logger.info('Successfully retried stage execution')

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
    logger.error('RetryStageExecution failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to retry CodePipeline stage execution: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
