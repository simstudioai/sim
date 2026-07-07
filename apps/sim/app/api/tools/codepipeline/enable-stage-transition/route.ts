import {
  CodePipelineClient,
  EnableStageTransitionCommand,
  type StageTransitionType,
} from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineEnableStageTransitionContract } from '@/lib/api/contracts/tools/aws/codepipeline-enable-stage-transition'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineEnableStageTransition')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineEnableStageTransitionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Enabling CodePipeline stage transition')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new EnableStageTransitionCommand({
        pipelineName: validatedData.pipelineName,
        stageName: validatedData.stageName,
        transitionType: validatedData.transitionType as StageTransitionType,
      })

      await client.send(command)

      logger.info('Successfully enabled stage transition')

      return NextResponse.json({
        success: true,
        output: {
          pipelineName: validatedData.pipelineName,
          stageName: validatedData.stageName,
          transitionType: validatedData.transitionType,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('EnableStageTransition failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to enable CodePipeline stage transition: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
