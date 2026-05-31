import type { Team } from '@linear/sdk'
import { LinearClient } from '@linear/sdk'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { linearTeamsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinearTeamsAPI')

/** Linear's maximum page size for a single connection request. */
const LINEAR_PAGE_SIZE = 250

/**
 * Upper bound on pages to drain from the teams connection. At 250 teams/page
 * this covers 2,500 teams; the cap guards against runaway loops on a broken
 * `hasNextPage` rather than a realistic limit.
 */
const MAX_TEAMS_PAGES = 10

/**
 * Drains the full Linear teams connection by following
 * `pageInfo.endCursor` until `hasNextPage` is false. Bounded by
 * `MAX_TEAMS_PAGES`; logs a warning if the cap is hit so a truncated list is
 * visible rather than silently dropped.
 */
async function fetchAllTeams(linearClient: LinearClient): Promise<Team[]> {
  const teams: Team[] = []
  let after: string | undefined

  for (let page = 0; page < MAX_TEAMS_PAGES; page++) {
    const result = await linearClient.teams({ first: LINEAR_PAGE_SIZE, after })
    teams.push(...result.nodes)

    if (!result.pageInfo.hasNextPage) {
      return teams
    }
    after = result.pageInfo.endCursor ?? undefined
    if (!after) {
      return teams
    }
    if (page === MAX_TEAMS_PAGES - 1) {
      logger.warn('Linear teams pagination hit cap; team list may be incomplete', {
        cap: MAX_TEAMS_PAGES,
        fetched: teams.length,
      })
    }
  }

  return teams
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(linearTeamsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId } = parsed.data.body

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
    const allTeams = await fetchAllTeams(linearClient)
    const teams = allTeams.map((team: Team) => ({
      id: team.id,
      name: team.name,
    }))

    return NextResponse.json({ teams })
  } catch (error) {
    logger.error('Error processing Linear teams request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Linear teams', details: (error as Error).message },
      { status: 500 }
    )
  }
})
