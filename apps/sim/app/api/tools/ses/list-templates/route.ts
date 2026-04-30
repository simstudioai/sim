import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesListTemplatesContract } from '@/lib/api/contracts/tools/aws/ses-list-templates'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, listTemplates } from '../utils'

const logger = createLogger('SESListTemplatesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesListTemplatesContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Listing SES email templates')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await listTemplates(client, {
        pageSize: params.pageSize,
        nextToken: params.nextToken,
      })

      logger.info(`Listed ${result.count} templates`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to list templates:', error)

    return NextResponse.json(
      { error: `Failed to list templates: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
