import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { validateAlphanumericId } from '@/lib/security/input-validation'

export const dynamic = 'force-dynamic'

const logger = createLogger('AsanaGetProjectsAPI')

export async function POST(request: Request) {
  try {
    const { accessToken, workspace } = await request.json()

    if (!accessToken) {
      logger.error('Missing access token in request')
      return NextResponse.json({ error: 'Access token is required' }, { status: 400 })
    }

    if (!workspace) {
      logger.error('Missing workspace in request')
      return NextResponse.json({ error: 'Workspace is required' }, { status: 400 })
    }

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
      output: {
        ts: new Date().toISOString(),
        projects: projects.map((project: any) => ({
          gid: project.gid,
          name: project.name,
          resource_type: project.resource_type,
        })),
      },
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
}
