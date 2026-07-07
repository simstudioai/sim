import { CodePipelineClient, ListPipelineExecutionsCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineListPipelineExecutionsContract } from '@/lib/api/contracts/tools/aws/codepipeline-list-pipeline-executions'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineListPipelineExecutions')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineListPipelineExecutionsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Listing CodePipeline pipeline executions')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new ListPipelineExecutionsCommand({
        pipelineName: validatedData.pipelineName,
        ...(validatedData.maxResults !== undefined && { maxResults: validatedData.maxResults }),
        ...(validatedData.nextToken && { nextToken: validatedData.nextToken }),
        ...(validatedData.succeededInStage && {
          filter: { succeededInStage: { stageName: validatedData.succeededInStage } },
        }),
      })

      const response = await client.send(command)

      const executions = (response.pipelineExecutionSummaries ?? []).map((e) => ({
        pipelineExecutionId: e.pipelineExecutionId ?? '',
        status: e.status ?? 'Unknown',
        statusSummary: e.statusSummary,
        startTime: e.startTime?.getTime(),
        lastUpdateTime: e.lastUpdateTime?.getTime(),
        executionMode: e.executionMode,
        executionType: e.executionType,
        stopTriggerReason: e.stopTrigger?.reason,
        triggerType: e.trigger?.triggerType,
        triggerDetail: e.trigger?.triggerDetail,
        rollbackTargetPipelineExecutionId: e.rollbackMetadata?.rollbackTargetPipelineExecutionId,
        sourceRevisions: (e.sourceRevisions ?? []).map((r) => ({
          actionName: r.actionName ?? '',
          revisionId: r.revisionId,
          revisionSummary: r.revisionSummary,
          revisionUrl: r.revisionUrl,
        })),
      }))

      logger.info(`Successfully listed ${executions.length} pipeline executions`)

      return NextResponse.json({
        success: true,
        output: {
          executions,
          ...(response.nextToken && { nextToken: response.nextToken }),
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('ListPipelineExecutions failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to list CodePipeline pipeline executions: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
