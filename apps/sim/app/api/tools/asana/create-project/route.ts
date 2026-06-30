import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { asanaCreateProjectContract } from '@/lib/api/contracts/tools/asana'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaCreateProjectAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(asanaCreateProjectContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, workspace, name, notes } = parsed.data.body

    const workspaceValidation = validateAlphanumericId(workspace, 'workspace', 100)
    if (!workspaceValidation.isValid) {
      return NextResponse.json({ error: workspaceValidation.error }, { status: 400 })
    }

    const projectData: Record<string, unknown> = { name, workspace }
    if (notes) {
      projectData.notes = notes
    }

    const response = await fetch('https://app.asana.com/api/1.0/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: projectData }),
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
    const project = result.data

    return NextResponse.json({
      success: true,
      ts: new Date().toISOString(),
      gid: project.gid,
      name: project.name,
      notes: project.notes || '',
      archived: project.archived ?? false,
      color: project.color ?? null,
      created_at: project.created_at,
      modified_at: project.modified_at,
      permalink_url: project.permalink_url,
    })
  } catch (error) {
    logger.error('Error creating Asana project:', {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: getErrorMessage(error, 'Internal server error'), success: false },
      { status: 500 }
    )
  }
})
