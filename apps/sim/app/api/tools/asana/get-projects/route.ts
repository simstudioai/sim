import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaGetProjectsContract } from '@/lib/api/contracts/tools/asana'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaGetProjectsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(asanaGetProjectsContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, workspace } = parsed.data.body

    const workspaceValidation = validateAlphanumericId(workspace, 'workspace', 100)
    if (!workspaceValidation.isValid) {
      return NextResponse.json({ error: workspaceValidation.error }, { status: 400 })
    }

    const url = `https://app.asana.com/api/1.0/projects?workspace=${workspace}`

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
        {
          success: false,
          error: errorMessage,
          details: errorText,
        },
        { status: response.status }
      )
    }

    const result = await response.json()
    const projects = result.data

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      projects: projects.map((project: { gid: string; name: string; resource_type: string }) => ({
        gid: project.gid,
        name: project.name,
        resource_type: project.resource_type,
      })),
    })
  } catch (error) {
    logger.error('Error processing request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Asana projects',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
})
