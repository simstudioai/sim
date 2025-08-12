import type { Project } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account } from '@/db/schema'

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

    const requesterUserId = session?.user?.id || ''
    if (!requesterUserId) {
      logger.error('No user ID found in session')
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Look up credential owner
    const creds = await db.select().from(account).where(eq(account.id, credential)).limit(1)
    if (!creds.length) {
      logger.error('Credential not found for Linear API', { credential })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }
    const credentialOwnerUserId = creds[0].userId

    // If requester does not own the credential, allow only if workflowId present (collab context)
    if (credentialOwnerUserId !== requesterUserId && !workflowId) {
      logger.warn('Unauthorized Linear credential access attempt without workflow context', {
        credentialOwnerUserId,
        requesterUserId,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      credentialOwnerUserId,
      workflowId || 'linear'
    )
    if (!accessToken) {
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: credentialOwnerUserId,
      })
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
