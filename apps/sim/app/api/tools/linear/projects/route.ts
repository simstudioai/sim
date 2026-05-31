import type { Project, Team } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { linearProjectsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinearProjectsAPI')

/** Linear's maximum page size for a single connection request. */
const LINEAR_PAGE_SIZE = 250

/**
 * Upper bound on pages to drain from a single team's projects connection. At
 * 250 projects/page this covers 2,500 projects per team; the cap guards
 * against runaway loops on a broken `hasNextPage` rather than a realistic
 * limit.
 */
const MAX_PROJECTS_PAGES = 10

/**
 * Drains a single team's projects connection by following
 * `pageInfo.endCursor` until `hasNextPage` is false. Bounded by
 * `MAX_PROJECTS_PAGES`; logs a warning if the cap is hit so a truncated list
 * is visible rather than silently dropped.
 */
async function fetchAllTeamProjects(team: Team): Promise<Project[]> {
  const projects: Project[] = []
  let after: string | undefined

  for (let page = 0; page < MAX_PROJECTS_PAGES; page++) {
    const result = await team.projects({ first: LINEAR_PAGE_SIZE, after })
    projects.push(...result.nodes)

    if (!result.pageInfo.hasNextPage) {
      return projects
    }
    after = result.pageInfo.endCursor ?? undefined
    if (!after) {
      return projects
    }
    if (page === MAX_PROJECTS_PAGES - 1) {
      logger.warn('Linear projects pagination hit cap; project list may be incomplete', {
        teamId: team.id,
        cap: MAX_PROJECTS_PAGES,
        fetched: projects.length,
      })
    }
  }

  return projects
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(linearProjectsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, teamId, workflowId } = parsed.data.body

    const requestId = generateRequestId()
    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const linearClient = new LinearClient({ accessToken })

    /**
     * teamId may be a single ID or a comma-separated list when the basic-mode
     * team selector is in multi-select. Fetch projects from each team in
     * parallel and dedupe by project ID (Linear projects can be cross-team).
     */
    const teamIds = teamId
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const perTeam = await Promise.all(
      teamIds.map(async (id) => {
        const team = await linearClient.team(id)
        const teamProjects = await fetchAllTeamProjects(team)
        return teamProjects.map((project: Project) => ({
          id: project.id,
          name: project.name,
        }))
      })
    )

    const seen = new Set<string>()
    const projects: Array<{ id: string; name: string }> = []
    for (const teamProjects of perTeam) {
      for (const project of teamProjects) {
        if (seen.has(project.id)) continue
        seen.add(project.id)
        projects.push(project)
      }
    }

    if (projects.length === 0) {
      logger.info('No projects found for team(s)', { teamIds })
    }

    return NextResponse.json({ projects })
  } catch (error) {
    logger.error('Error processing Linear projects request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Linear projects', details: (error as Error).message },
      { status: 500 }
    )
  }
})
