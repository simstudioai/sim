import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type TrelloSelectorKey = Extract<ServerSelectorKey, 'trello.boards'>

export const trelloSelectorAttachments = {
  'trello.boards': {
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['trello'],
    },
    destination: 'fixed',
    execute: async (args) => {
      if (!args.credential) throw new SelectorConnectionUnavailableError()
      const apiKey = process.env.TRELLO_API_KEY
      if (!apiKey) throw new SelectorOptionsUnavailableError()
      args.protectedValues.add(apiKey)
      const token = await resolveSelectorOAuthAccessToken({
        credential: args.credential,
        serviceId: 'trello',
        protectedValues: args.protectedValues,
      })
      const url = new URL('https://api.trello.com/1/members/me/boards')
      url.searchParams.set('key', apiKey)
      url.searchParams.set('token', token)
      url.searchParams.set('fields', 'id,name,closed')
      const data = await fetchProviderJson<unknown>(url, {
        headers: { Accept: 'application/json' },
        signal: args.signal,
        redirect: 'error',
      })
      if (!Array.isArray(data)) throw new SelectorOptionsUnavailableError()
      const boards = data.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const board = value as { id?: unknown; name?: unknown; closed?: unknown }
        if (typeof board.id !== 'string' || typeof board.name !== 'string') return []
        return [{ id: board.id, label: board.name, closed: board.closed === true }]
      })
      if (args.request.kind === 'detail') {
        const detailId = args.request.id
        const board = boards.find((item) => item.id === detailId)
        return detailSelectorResult(board ? { id: board.id, label: board.label } : null)
      }
      return listSelectorResult(
        boards.filter((board) => !board.closed).map(({ id, label }) => ({ id, label }))
      )
    },
  },
} satisfies ServerSelectorAttachmentMap<TrelloSelectorKey>
