import { CodePipelineClient, ListPipelinesCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineListPipelinesContract } from '@/lib/api/contracts/tools/aws/codepipeline-list-pipelines'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineListPipelines')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineListPipelinesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Listing CodePipeline pipelines')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new ListPipelinesCommand({
        ...(validatedData.maxResults !== undefined && { maxResults: validatedData.maxResults }),
        ...(validatedData.nextToken && { nextToken: validatedData.nextToken }),
      })

      const response = await client.send(command)

      const pipelines = (response.pipelines ?? []).map((p) => ({
        name: p.name ?? '',
        version: p.version,
        pipelineType: p.pipelineType,
        executionMode: p.executionMode,
        created: p.created?.getTime(),
        updated: p.updated?.getTime(),
      }))

      logger.info(`Successfully listed ${pipelines.length} pipelines`)

      return NextResponse.json({
        success: true,
        output: {
          pipelines,
          ...(response.nextToken && { nextToken: response.nextToken }),
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('ListPipelines failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to list CodePipeline pipelines: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
