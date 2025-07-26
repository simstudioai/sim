import type { Project } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinearProjectsAPI')

export async function POST(request: Request) {
  try {
    const session = await getSession()
    const body = await request.json()
    const { credential, teamId, workflowId } = body

    if (!credential || !teamId) {
      logger.error('Missing credential or teamId in request')
      return NextResponse.json({ error: 'Credential and teamId are required' }, { status: 400 })
    }

    const userId = session?.user?.id || ''
    if (!userId) {
      logger.error('No user ID found in session')
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(credential, userId, workflowId)
    if (!accessToken) {
      logger.error('Failed to get access token', { credentialId: credential, userId })
      return NextResponse.json(
        {
          error: 'Could not retrieve access token',
          authRequired: true,
        },
        { status: 401 }
      )
    }

    const linearClient = new LinearClient({ accessToken })
    let projects = []

    const team = await linearClient.team(teamId)
    const projectsResult = await team.projects()
    projects = projectsResult.nodes.map((project: Project) => ({
      id: project.id,
      name: project.name,
    }))

    if (projects.length === 0) {
      logger.info('No projects found for team', { teamId })
    }

    return NextResponse.json({ projects })
  } catch (error) {
    logger.error('Error processing Linear projects request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Linear projects', details: (error as Error).message },
      { status: 500 }
    )
  }
}
