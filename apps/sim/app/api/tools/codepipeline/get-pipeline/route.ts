import { CodePipelineClient, GetPipelineCommand } from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelineGetPipelineContract } from '@/lib/api/contracts/tools/aws/codepipeline-get-pipeline'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelineGetPipeline')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelineGetPipelineContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Getting CodePipeline pipeline structure')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new GetPipelineCommand({
        name: validatedData.pipelineName,
        ...(validatedData.version !== undefined && { version: validatedData.version }),
      })
      const response = await client.send(command)
      const pipeline = response.pipeline

      if (!pipeline) {
        throw new Error('Pipeline structure not found in response')
      }

      const stages = (pipeline.stages ?? []).map((stage) => ({
        stageName: stage.name ?? '',
        actions: (stage.actions ?? []).map((action) => ({
          name: action.name ?? '',
          category: action.actionTypeId?.category ?? '',
          owner: action.actionTypeId?.owner ?? '',
          provider: action.actionTypeId?.provider ?? '',
          version: action.actionTypeId?.version ?? '',
          runOrder: action.runOrder,
          configuration: action.configuration ?? {},
          inputArtifacts: (action.inputArtifacts ?? []).map((a) => a.name ?? ''),
          outputArtifacts: (action.outputArtifacts ?? []).map((a) => a.name ?? ''),
        })),
      }))

      logger.info(`Successfully got pipeline structure with ${stages.length} stages`)

      return NextResponse.json({
        success: true,
        output: {
          pipelineName: pipeline.name ?? validatedData.pipelineName,
          pipelineArn: response.metadata?.pipelineArn,
          roleArn: pipeline.roleArn ?? '',
          version: pipeline.version,
          pipelineType: pipeline.pipelineType,
          executionMode: pipeline.executionMode,
          artifactStoreType: pipeline.artifactStore?.type,
          artifactStoreLocation: pipeline.artifactStore?.location,
          stages,
          variables: (pipeline.variables ?? []).map((v) => ({
            name: v.name ?? '',
            defaultValue: v.defaultValue,
            description: v.description,
          })),
          created: response.metadata?.created?.getTime(),
          updated: response.metadata?.updated?.getTime(),
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('GetPipeline failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to get CodePipeline pipeline: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
