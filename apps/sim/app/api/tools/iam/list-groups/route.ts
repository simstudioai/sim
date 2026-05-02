import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsIamListGroupsContract } from '@/lib/api/contracts/tools/aws/iam-list-groups'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createIAMClient, listGroups } from '../utils'

const logger = createLogger('IAMListGroupsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsIamListGroupsContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Listing IAM groups`)

    const client = createIAMClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listGroups(client, params.pathPrefix, params.maxItems, params.marker)
      logger.info(`Successfully listed ${result.count} IAM groups`)
      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error(`Failed to list IAM groups:`, error)
    return NextResponse.json(
      { error: `Failed to list IAM groups: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
