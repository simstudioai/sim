import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaDeleteTaskContract } from '@/lib/api/contracts/tools/asana'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaDeleteTaskAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(asanaDeleteTaskContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, taskGid } = parsed.data.body

    const taskGidValidation = validateAlphanumericId(taskGid, 'taskGid', 100)
    if (!taskGidValidation.isValid) {
      return NextResponse.json({ error: taskGidValidation.error }, { status: 400 })
    }

    const url = `https://app.asana.com/api/1.0/tasks/${taskGid}`

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
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

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      gid: taskGid,
      deleted: true,
    })
  } catch (error) {
    logger.error('Error deleting Asana task:', error)
    return NextResponse.json(
      { error: 'Failed to delete Asana task', details: (error as Error).message },
      { status: 500 }
    )
  }
})
