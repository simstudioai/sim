import {
  type ApprovalStatus,
  CodePipelineClient,
  PutApprovalResultCommand,
} from '@aws-sdk/client-codepipeline'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsCodepipelinePutApprovalResultContract } from '@/lib/api/contracts/tools/aws/codepipeline-put-approval-result'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { awsErrorStatus } from '@/app/api/tools/codepipeline/utils'

const logger = createLogger('CodePipelinePutApprovalResult')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseToolRequest(awsCodepipelinePutApprovalResultContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    logger.info('Submitting CodePipeline approval result')

    const client = new CodePipelineClient({
      region: validatedData.region,
      credentials: {
        accessKeyId: validatedData.accessKeyId,
        secretAccessKey: validatedData.secretAccessKey,
      },
    })

    try {
      const command = new PutApprovalResultCommand({
        pipelineName: validatedData.pipelineName,
        stageName: validatedData.stageName,
        actionName: validatedData.actionName,
        token: validatedData.token,
        result: {
          status: validatedData.status as ApprovalStatus,
          summary: validatedData.summary,
        },
      })

      const response = await client.send(command)

      logger.info('Successfully submitted approval result')

      return NextResponse.json({
        success: true,
        output: {
          approvedAt: response.approvedAt?.getTime(),
          status: validatedData.status,
        },
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('PutApprovalResult failed', { error: toError(error).message })
    return NextResponse.json(
      { error: `Failed to submit CodePipeline approval result: ${toError(error).message}` },
      { status: awsErrorStatus(error) }
    )
  }
})
