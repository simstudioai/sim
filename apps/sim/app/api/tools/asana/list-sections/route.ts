import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaListSectionsContract } from '@/lib/api/contracts/tools/asana'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaListSectionsAPI')

interface AsanaSection {
  gid: string
  name: string
  resource_type?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(asanaListSectionsContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, projectGid } = parsed.data.body

    const projectGidValidation = validateAlphanumericId(projectGid, 'projectGid', 100)
    if (!projectGidValidation.isValid) {
      return NextResponse.json({ error: projectGidValidation.error }, { status: 400 })
    }

    const url = `https://app.asana.com/api/1.0/projects/${projectGid}/sections`

    const response = await fetch(url, {
      method: 'GET',
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

    const result = await response.json()
    const sections: AsanaSection[] = Array.isArray(result.data) ? result.data : []

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      sections: sections.map((section) => ({
        gid: section.gid,
        name: section.name,
        resource_type: section.resource_type,
      })),
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Asana sections', details: (error as Error).message },
      { status: 500 }
    )
  }
})
