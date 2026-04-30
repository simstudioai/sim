import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const slackSelectors = {
  'slack.channels': {
    key: 'slack.channels',
    contracts: [selectorContracts.slackChannelsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.channels',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'slack.channels')
      const data = await requestJson(selectorContracts.slackChannelsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.channels || []).map((channel) => ({
        id: channel.id,
        label: `#${channel.name}`,
      }))
    },
  },
  'slack.users': {
    key: 'slack.users',
    contracts: [selectorContracts.slackUsersSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.users',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'slack.users')
      const data = await requestJson(selectorContracts.slackUsersSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return data.users.map((user) => ({
        id: user.id,
        label: user.real_name || user.name,
      }))
    },
  },
} satisfies Record<Extract<SelectorKey, 'slack.channels' | 'slack.users'>, SelectorDefinition>
