import { CodePipelineClient, GetPipelineExecutionCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineGetPipelineExecutionContract } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline-execution'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineGetPipelineExecution')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineGetPipelineExecutionContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Getting CodePipeline pipeline execution')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new GetPipelineExecutionCommand({
        pipelineName: validatedData.pipelineName,
        pipelineExecutionId: validatedData.pipelineExecutionId,
      })

      const response = await client.send(command)
      const execution = response.pipelineExecution

      if (!execution) {
        throw new Error('Pipeline execution not found in response')
      }

      logger.info('Successfully got pipeline execution')

      return NextResponse.json({
        success: true,
        output: {
          pipelineExecutionId: execution.pipelineExecutionId ?? validatedData.pipelineExecutionId,
          pipelineName: execution.pipelineName ?? validatedData.pipelineName,
          pipelineVersion: execution.pipelineVersion,
          status: execution.status ?? 'Unknown',
          statusSummary: execution.statusSummary,
          executionMode: execution.executionMode,
          executionType: execution.executionType,
          triggerType: execution.trigger?.triggerType,
          triggerDetail: execution.trigger?.triggerDetail,
          artifactRevisions: (execution.artifactRevisions ?? []).map((r) => ({
            name: r.name ?? '',
            revisionId: r.revisionId,
            revisionSummary: r.revisionSummary,
            revisionUrl: r.revisionUrl,
            created: r.created?.getTime(),
          })),
          variables: (execution.variables ?? []).map((v) => ({
            name: v.name ?? '',
            resolvedValue: v.resolvedValue ?? '',
          })),
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('GetPipelineExecution failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CodePipeline pipeline execution: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
