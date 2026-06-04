import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamCreateUserContract } from '@/lib/api/contracts/tools/aws/iam-create-user'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, createUser } from '../utils'

const logger = createLogger('IAMCreateUserAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamCreateUserContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Creating IAM user "${params.userName}"`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createUser(client, params.userName, params.path)
      logger.info(`Successfully created IAM user "${result.userName}"`)
      return NextResponse.json({
        message: `User "${result.userName}" created successfully`,
        ...result,
      })
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to create IAM user:`, error)
    return NextResponse.json(
      { error: `Failed to create IAM user: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
