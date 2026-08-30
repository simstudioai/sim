import { validateMondayNumericId } from '@/lib/core/security/input-validation'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { MONDAY_API_URL, mondayHeaders } from '@/tools/monday/utils'

type MondaySelectorKey = Extract<ServerSelectorKey, 'monday.boards' | 'monday.groups'>

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['monday'],
} as const

const PAGE_SIZE = 100
const MAX_PAGES = 50

interface MondayResponse<T> {
  errors?: Array<{ message?: string }>
  error_message?: string
  data?: T
}

function requireMondayData<T>(response: MondayResponse<T>): T | undefined {
  if (response.errors?.length || response.error_message) {
    throw new SelectorOptionsUnavailableError()
  }
  return response.data
}

async function accessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  if (!args.credential) throw new SelectorOptionsUnavailableError()
  return resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'monday',
    protectedValues: args.protectedValues,
  })
}

async function listBoards(args: ExecuteServerSelectorArgs) {
  const token = await accessToken(args)
  const items: SafeSelectorOption[] = []
  let truncated = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchProviderJson<
      MondayResponse<{ boards?: Array<{ id: string; name: string }> }>
    >(MONDAY_API_URL, {
      method: 'POST',
      headers: mondayHeaders(token),
      body: JSON.stringify({
        query: `{ boards(limit: ${PAGE_SIZE}, page: ${page}, state: active) { id name } }`,
      }),
      signal: args.signal,
      redirect: 'error',
    })
    const boards = requireMondayData(response)?.boards ?? []
    items.push(...boards.map((board) => ({ id: board.id, label: board.name })))
    if (boards.length < PAGE_SIZE) break
    if (page === MAX_PAGES) truncated = true
  }
  return { items, truncated }
}

async function listGroups(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const boardId = args.context.boardId
  if (!boardId) throw new SelectorContextUnavailableError()
  const validated = validateMondayNumericId(boardId, 'boardId')
  if (!validated.isValid) throw new SelectorContextUnavailableError()
  const token = await accessToken(args)
  const response = await fetchProviderJson<
    MondayResponse<{ boards?: Array<{ groups?: Array<{ id: string; title: string }> }> }>
  >(MONDAY_API_URL, {
    method: 'POST',
    headers: mondayHeaders(token),
    body: JSON.stringify({
      query: `{ boards(ids: [${validated.sanitized}]) { groups { id title } } }`,
    }),
    signal: args.signal,
    redirect: 'error',
  })
  const groups = requireMondayData(response)?.boards?.[0]?.groups ?? []
  return groups.map((group) => ({ id: group.id, label: group.title }))
}

export const mondaySelectorAttachments = {
  'monday.boards': {
    credential,
    destination: 'fixed',
    execute: async (args) => {
      const result = await listBoards(args)
      return flatSelectorResult(
        args.request,
        result.items,
        true,
        result.truncated ? { truncated: { reason: 'provider-cap', pages: MAX_PAGES } } : undefined
      )
    },
  },
  'monday.groups': {
    credential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listGroups(args), true),
  },
} satisfies ServerSelectorAttachmentMap<MondaySelectorKey>
