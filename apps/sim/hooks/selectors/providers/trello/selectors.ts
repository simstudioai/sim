import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const trelloSelectors = {
  'trello.boards': {
    key: 'trello.boards',
    contracts: [selectorContracts.trelloBoardsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'trello.boards',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'trello.boards')
      const data = await requestJson(selectorContracts.trelloBoardsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.boards || [])
        .filter((board) => !board.closed)
        .map((board) => ({ id: board.id, label: board.name }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'trello.boards')
      const data = await requestJson(selectorContracts.trelloBoardsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const board = (data.boards || []).find((b) => b.id === detailId) ?? null
      if (!board) return null
      return { id: board.id, label: board.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'trello.boards'>, SelectorDefinition>
