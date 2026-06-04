import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamCreateAccessKeyContract } from '@/lib/api/contracts/tools/aws/iam-create-access-key'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createAccessKey, createIAMClient } from '../utils'

const logger = createLogger('IAMCreateAccessKeyAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamCreateAccessKeyContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Creating IAM access key`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createAccessKey(client, params.userName)
      logger.info(`Successfully created access key for user "${result.userName}"`)
      return NextResponse.json({
        message: `Access key created for user "${result.userName}"`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to create access key:`, error)
    return NextResponse.json(
      { error: `Failed to create access key: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
