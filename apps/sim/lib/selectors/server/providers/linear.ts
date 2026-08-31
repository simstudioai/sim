import { LinearClient, LinearError, type Project, type Team } from '@linear/sdk'
import { getScopesForService } from '@/lib/oauth/utils'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type LinearSelectorKey = Extract<ServerSelectorKey, 'linear.teams' | 'linear.projects'>

const LINEAR_SCOPES = getScopesForService('linear')
const LINEAR_PAGE_SIZE = 250
const MAX_LINEAR_PAGES = 10
const MAX_SELECTED_TEAMS = 100

function throwLinearSelectorError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw error
  if (error instanceof LinearError && typeof error.status === 'number') {
    throw selectorProviderStatusError(error.status)
  }
  throw new SelectorOptionsUnavailableError()
}

async function linearClient(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const token = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'linear',
    scopes: LINEAR_SCOPES,
    protectedValues: args.protectedValues,
  })
  return token.startsWith('lin_api_')
    ? new LinearClient({ apiKey: token, redirect: 'error', signal: args.signal })
    : new LinearClient({ accessToken: token, redirect: 'error', signal: args.signal })
}

async function fetchAllTeams(client: LinearClient): Promise<{ items: Team[]; truncated: boolean }> {
  const teams: Team[] = []
  let after: string | undefined
  let truncated = false

  for (let page = 0; page < MAX_LINEAR_PAGES; page++) {
    const result = await client.teams({ first: LINEAR_PAGE_SIZE, after })
    teams.push(...result.nodes)
    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break
    after = result.pageInfo.endCursor
    if (page === MAX_LINEAR_PAGES - 1) truncated = true
  }
  return { items: teams, truncated }
}

async function fetchAllProjects(team: Team): Promise<{ items: Project[]; truncated: boolean }> {
  const projects: Project[] = []
  let after: string | undefined
  let truncated = false

  for (let page = 0; page < MAX_LINEAR_PAGES; page++) {
    const result = await team.projects({ first: LINEAR_PAGE_SIZE, after })
    projects.push(...result.nodes)
    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break
    after = result.pageInfo.endCursor
    if (page === MAX_LINEAR_PAGES - 1) truncated = true
  }
  return { items: projects, truncated }
}

function selectedTeamIds(raw: string | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length === 0 || ids.length > MAX_SELECTED_TEAMS || ids.some((id) => id.length > 100)) {
    throw new SelectorContextUnavailableError()
  }
  return ids
}

async function executeTeams(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const client = await linearClient(args)
  try {
    const { items, truncated } = await fetchAllTeams(client)
    return listSelectorResult(
      items.map((team) => ({ id: team.id, label: team.name })),
      undefined,
      truncated ? { truncated: { reason: 'provider-cap', pages: MAX_LINEAR_PAGES } } : undefined
    )
  } catch (error) {
    throwLinearSelectorError(error, args.signal)
  }
}

async function executeProjects(args: ExecuteServerSelectorArgs) {
  requireListRequest(args.selectorKey, args.request)
  const teamIds = selectedTeamIds(args.context.teamId)
  const client = await linearClient(args)
  try {
    const perTeam = await Promise.all(
      teamIds.map(async (teamId) => fetchAllProjects(await client.team(teamId)))
    )
    const seen = new Set<string>()
    const options: Array<{ id: string; label: string }> = []
    for (const result of perTeam) {
      for (const project of result.items) {
        if (seen.has(project.id)) continue
        seen.add(project.id)
        options.push({ id: project.id, label: project.name })
      }
    }
    return listSelectorResult(
      options,
      undefined,
      perTeam.some((result) => result.truncated)
        ? { truncated: { reason: 'provider-cap', pages: MAX_LINEAR_PAGES } }
        : undefined
    )
  } catch (error) {
    throwLinearSelectorError(error, args.signal)
  }
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['linear'] } as const

export const linearSelectorAttachments = {
  'linear.teams': { credential, destination: 'fixed', execute: executeTeams },
  'linear.projects': { credential, destination: 'fixed', execute: executeProjects },
} satisfies ServerSelectorAttachmentMap<LinearSelectorKey>
