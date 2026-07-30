import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesUpdateTemplateContract } from '@/lib/api/contracts/tools/aws/ses-update-template'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, updateTemplate } from '../utils'

const logger = createLogger('SESUpdateTemplateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesUpdateTemplateContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info('Updating SES email template')

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await updateTemplate(client, {
        templateName: params.templateName,
        subjectPart: params.subjectPart,
        textPart: params.textPart,
        htmlPart: params.htmlPart,
      })

      logger.info(`Updated template '${params.templateName}'`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to update template:', error)

    return NextResponse.json(
      { error: `Failed to update template: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
