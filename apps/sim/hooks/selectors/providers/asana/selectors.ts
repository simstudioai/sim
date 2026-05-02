import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const asanaSelectors = {
  'asana.workspaces': {
    key: 'asana.workspaces',
    contracts: [selectorContracts.asanaWorkspacesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'asana.workspaces',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'asana.workspaces')
      const data = await requestJson(selectorContracts.asanaWorkspacesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.workspaces || []).map((ws) => ({ id: ws.id, label: ws.name }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'asana.workspaces')
      const data = await requestJson(selectorContracts.asanaWorkspacesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const ws = (data.workspaces || []).find((w) => w.id === detailId) ?? null
      if (!ws) return null
      return { id: ws.id, label: ws.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'asana.workspaces'>, SelectorDefinition>
