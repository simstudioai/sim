import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const mondaySelectors = {
  'monday.boards': {
    key: 'monday.boards',
    contracts: [selectorContracts.mondayBoardsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'monday.boards',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'monday.boards')
      const data = await requestJson(selectorContracts.mondayBoardsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.boards || []).map((board) => ({
        id: board.id,
        label: board.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'monday.boards')
      const data = await requestJson(selectorContracts.mondayBoardsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const board = (data.boards || []).find((b) => b.id === detailId) ?? null
      if (!board) return null
      return { id: board.id, label: board.name }
    },
  },
  'monday.groups': {
    key: 'monday.groups',
    contracts: [selectorContracts.mondayGroupsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'monday.groups',
      context.oauthCredential ?? 'none',
      context.boardId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.boardId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'monday.groups')
      if (!context.boardId) {
        throw new Error('Missing board ID for monday.groups selector')
      }
      const data = await requestJson(selectorContracts.mondayGroupsSelectorContract, {
        body: {
          credential: credentialId,
          boardId: context.boardId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.groups || []).map((group) => ({
        id: group.id,
        label: group.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'monday.groups')
      if (!context.boardId) return null
      const data = await requestJson(selectorContracts.mondayGroupsSelectorContract, {
        body: {
          credential: credentialId,
          boardId: context.boardId,
          workflowId: context.workflowId,
        },
        signal,
      })
      const group = (data.groups || []).find((g) => g.id === detailId) ?? null
      if (!group) return null
      return { id: group.id, label: group.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'monday.boards' | 'monday.groups'>, SelectorDefinition>
