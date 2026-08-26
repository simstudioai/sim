import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { isEnvVarReference } from '@/executor/constants'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

function slackCredentialQueryKey(credential: string | undefined): string {
  if (!credential) return 'none'
  return credential.startsWith('xoxb-') ? 'direct-bot-token' : credential
}

function slackCredentialHasServerSecret(credential: string | undefined): boolean {
  return Boolean(credential && (credential.startsWith('xoxb-') || isEnvVarReference(credential)))
}

export const slackSelectors = {
  'slack.channels': {
    key: 'slack.channels',
    contracts: [selectorContracts.slackChannelsSelectorContract],
    serverResolvedContextFields: ['oauthCredential'],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.channels',
      slackCredentialQueryKey(context.oauthCredential),
    ],
    enabled: ({ context }) =>
      Boolean(
        context.oauthCredential &&
          (!slackCredentialHasServerSecret(context.oauthCredential) || context.workflowId)
      ),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'slack.channels')
      const data = await requestJson(selectorContracts.slackChannelsSelectorContract, {
        body: {
          credential: credentialId,
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
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
    serverResolvedContextFields: ['oauthCredential'],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.users',
      slackCredentialQueryKey(context.oauthCredential),
    ],
    enabled: ({ context }) =>
      Boolean(
        context.oauthCredential &&
          (!slackCredentialHasServerSecret(context.oauthCredential) || context.workflowId)
      ),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'slack.users')
      const data = await requestJson(selectorContracts.slackUsersSelectorContract, {
        body: {
          credential: credentialId,
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
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
