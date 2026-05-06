import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const linearSelectors = {
  'linear.teams': {
    key: 'linear.teams',
    contracts: [selectorContracts.linearTeamsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'linear.teams',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'linear.teams')
      const data = await requestJson(selectorContracts.linearTeamsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.teams || []).map((team) => ({
        id: team.id,
        label: team.name,
      }))
    },
  },
  'linear.projects': {
    key: 'linear.projects',
    contracts: [selectorContracts.linearProjectsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'linear.projects',
      context.oauthCredential ?? 'none',
      context.teamId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.teamId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'linear.projects')
      if (!context.teamId) {
        throw new Error('Missing team ID for linear.projects selector')
      }
      const data = await requestJson(selectorContracts.linearProjectsSelectorContract, {
        body: {
          credential: credentialId,
          teamId: context.teamId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.projects || []).map((project) => ({
        id: project.id,
        label: project.name,
      }))
    },
  },
} satisfies Record<Extract<SelectorKey, 'linear.teams' | 'linear.projects'>, SelectorDefinition>
