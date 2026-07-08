import { CodePipelineClient, ListActionExecutionsCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineListActionExecutionsContract } from '@/lib/api/contracts/tools/aws/codepipeline-list-action-executions'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineListActionExecutions')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineListActionExecutionsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Listing CodePipeline action executions')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new ListActionExecutionsCommand({
        pipelineName: validatedData.pipelineName,
        ...(validatedData.pipelineExecutionId && {
          filter: { pipelineExecutionId: validatedData.pipelineExecutionId },
        }),
        ...(validatedData.maxResults !== undefined && { maxResults: validatedData.maxResults }),
        ...(validatedData.nextToken && { nextToken: validatedData.nextToken }),
      })

      const response = await client.send(command)

      const actionExecutionDetails = (response.actionExecutionDetails ?? []).map((d) => ({
        pipelineExecutionId: d.pipelineExecutionId,
        actionExecutionId: d.actionExecutionId,
        pipelineVersion: d.pipelineVersion,
        stageName: d.stageName,
        actionName: d.actionName,
        startTime: d.startTime?.getTime(),
        lastUpdateTime: d.lastUpdateTime?.getTime(),
        updatedBy: d.updatedBy,
        status: d.status,
        externalExecutionId: d.output?.executionResult?.externalExecutionId,
        externalExecutionSummary: d.output?.executionResult?.externalExecutionSummary,
        externalExecutionUrl: d.output?.executionResult?.externalExecutionUrl,
        errorCode: d.output?.executionResult?.errorDetails?.code,
        errorMessage: d.output?.executionResult?.errorDetails?.message,
      }))

      logger.info(`Successfully listed ${actionExecutionDetails.length} action executions`)

      return NextResponse.json({
        success: true,
        output: {
          actionExecutionDetails,
          ...(response.nextToken && { nextToken: response.nextToken }),
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('ListActionExecutions failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to list CodePipeline action executions: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
