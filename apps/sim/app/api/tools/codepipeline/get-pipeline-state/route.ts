import { CodePipelineClient, GetPipelineStateCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineGetPipelineStateContract } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline-state'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineGetPipelineState')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineGetPipelineStateContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Getting CodePipeline pipeline state')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new GetPipelineStateCommand({ name: validatedData.pipelineName })
      const response = await client.send(command)

      const stageStates = (response.stageStates ?? []).map((stage) => ({
        stageName: stage.stageName ?? '',
        status: stage.latestExecution?.status,
        pipelineExecutionId: stage.latestExecution?.pipelineExecutionId,
        inboundTransitionEnabled: stage.inboundTransitionState?.enabled,
        actionStates: (stage.actionStates ?? []).map((action) => ({
          actionName: action.actionName ?? '',
          status: action.latestExecution?.status,
          summary: action.latestExecution?.summary,
          lastStatusChange: action.latestExecution?.lastStatusChange?.getTime(),
          externalExecutionId: action.latestExecution?.externalExecutionId,
          externalExecutionUrl: action.latestExecution?.externalExecutionUrl,
          errorCode: action.latestExecution?.errorDetails?.code,
          errorMessage: action.latestExecution?.errorDetails?.message,
          percentComplete: action.latestExecution?.percentComplete,
          token: action.latestExecution?.token,
          revisionId: action.currentRevision?.revisionId,
          entityUrl: action.entityUrl,
        })),
      }))

      logger.info(`Successfully got pipeline state with ${stageStates.length} stages`)

      return NextResponse.json({
        success: true,
        output: {
          pipelineName: response.pipelineName ?? validatedData.pipelineName,
          pipelineVersion: response.pipelineVersion,
          created: response.created?.getTime(),
          updated: response.updated?.getTime(),
          stageStates,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('GetPipelineState failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CodePipeline pipeline state: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
