import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { awsSesCreateTemplateContract } from '@/lib/api/contracts/tools/aws/ses-create-template'
import { parseToolRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createSESClient, createTemplate } from '../utils'

const logger = createLogger('SESCreateTemplateAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseToolRequest(awsSesCreateTemplateContract, request, {
      errorFormat: 'details',
      logger,
    })
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`Creating SES template '${params.templateName}'`)

    const client = createSESClient({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    })

    try {
      const result = await createTemplate(client, {
        templateName: params.templateName,
        subjectPart: params.subjectPart,
        textPart: params.textPart,
        htmlPart: params.htmlPart,
      })

      logger.info(`Template '${params.templateName}' created successfully`)

      return NextResponse.json(result)
    } finally {
      client.destroy()
    }
  } catch (error) {
    logger.error('Failed to create template:', error)

    return NextResponse.json(
      { error: `Failed to create template: ${toError(error).message}` },
      { status: 500 }
    )
  }
})
