import { LinearClient, LinearError } from '@linear/sdk'
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
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type LinearSelectorKey = Extract<ServerSelectorKey, 'linear.teams' | 'linear.projects'>

const LINEAR_SCOPES = getScopesForService('linear')
const LINEAR_PAGE_SIZE = 250
const MAX_SELECTED_TEAMS = 100
const MAX_LINEAR_CURSOR_LENGTH = 4_096

function throwLinearSelectorError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw error
  if (error instanceof SelectorContextUnavailableError) throw error
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

function requireLinearId(value: string): string {
  const id = value.trim()
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new SelectorContextUnavailableError()
  return id
}

function linearCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined
  if (cursor.length > MAX_LINEAR_CURSOR_LENGTH) throw new SelectorContextUnavailableError()
  return cursor
}

interface LinearProjectsCursor {
  teamIndex: number
  after?: string
}

function parseProjectsCursor(cursor: string | undefined): LinearProjectsCursor {
  if (!cursor) return { teamIndex: 0 }
  if (cursor.length > MAX_LINEAR_CURSOR_LENGTH) throw new SelectorContextUnavailableError()

  const params = new URLSearchParams(cursor)
  if ([...params.keys()].some((key) => key !== 'team' && key !== 'after')) {
    throw new SelectorContextUnavailableError()
  }
  const team = params.get('team')
  const after = params.get('after') || undefined
  if (!team || !/^\d{1,3}$/.test(team) || params.getAll('team').length !== 1) {
    throw new SelectorContextUnavailableError()
  }
  if (params.getAll('after').length > 1) throw new SelectorContextUnavailableError()

  const teamIndex = Number(team)
  if (!Number.isSafeInteger(teamIndex) || teamIndex < 0 || teamIndex >= MAX_SELECTED_TEAMS) {
    throw new SelectorContextUnavailableError()
  }
  return { teamIndex, ...(after ? { after } : {}) }
}

function projectsCursor(cursor: LinearProjectsCursor): string {
  const params = new URLSearchParams({ team: String(cursor.teamIndex) })
  if (cursor.after) params.set('after', cursor.after)
  return params.toString()
}

async function executeTeams(args: ExecuteServerSelectorArgs) {
  const client = await linearClient(args)
  try {
    if (args.request.kind === 'detail') {
      const team = await client.team(requireLinearId(args.request.id))
      return detailSelectorResult({ id: team.id, label: team.name })
    }
    const request = requireListRequest(args.selectorKey, args.request)
    const result = await client.teams({
      first: LINEAR_PAGE_SIZE,
      after: linearCursor(request.cursor),
    })
    const nextCursor =
      result.pageInfo.hasNextPage && result.pageInfo.endCursor
        ? result.pageInfo.endCursor
        : undefined
    return listSelectorResult(
      result.nodes.map((team) => ({ id: team.id, label: team.name })),
      nextCursor
    )
  } catch (error) {
    throwLinearSelectorError(error, args.signal)
  }
}

async function executeProjects(args: ExecuteServerSelectorArgs) {
  const client = await linearClient(args)
  try {
    if (args.request.kind === 'detail') {
      const project = await client.project(requireLinearId(args.request.id))
      return detailSelectorResult({ id: project.id, label: project.name })
    }
    const request = requireListRequest(args.selectorKey, args.request)
    const teamIds = selectedTeamIds(args.context.teamId)
    const cursor = parseProjectsCursor(request.cursor)
    if (cursor.teamIndex >= teamIds.length) throw new SelectorContextUnavailableError()

    const team = await client.team(teamIds[cursor.teamIndex])
    const result = await team.projects({ first: LINEAR_PAGE_SIZE, after: cursor.after })
    let nextCursor: string | undefined
    if (result.pageInfo.hasNextPage && result.pageInfo.endCursor) {
      nextCursor = projectsCursor({
        teamIndex: cursor.teamIndex,
        after: result.pageInfo.endCursor,
      })
    } else if (cursor.teamIndex + 1 < teamIds.length) {
      nextCursor = projectsCursor({ teamIndex: cursor.teamIndex + 1 })
    }
    return listSelectorResult(
      result.nodes.map((project) => ({ id: project.id, label: project.name })),
      nextCursor
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
