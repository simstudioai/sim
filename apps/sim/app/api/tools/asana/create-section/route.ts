import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaCreateSectionContract } from '@/lib/api/contracts/tools/asana'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaCreateSectionAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(asanaCreateSectionContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, projectGid, name } = parsed.data.body

    const projectGidValidation = validateAlphanumericId(projectGid, 'projectGid', 100)
    if (!projectGidValidation.isValid) {
      return NextResponse.json({ error: projectGidValidation.error }, { status: 400 })
    }

    const url = `https://app.asana.com/api/1.0/projects/${projectGid}/sections`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { name } }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `Asana API error: ${response.status} ${response.statusText}`

      try {
        const errorData = JSON.parse(errorText)
        const asanaError = errorData.errors?.[0]
        if (asanaError) {
          errorMessage = `${asanaError.message || errorMessage} (${asanaError.help || ''})`
        }
        logger.error('Asana API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        })
      } catch (_e) {
        logger.error('Asana API error (unparsed):', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        })
      }

      return NextResponse.json(
        { success: false, error: errorMessage, details: errorText },
        { status: response.status }
      )
    }

    const result = await response.json()
    const section = result.data

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      gid: section.gid,
      name: section.name,
      created_at: section.created_at,
    })
  } catch (error) {
    logger.error('Error creating Asana section:', {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error'), success: false },
      { status: 500 }
    )
  }
})
