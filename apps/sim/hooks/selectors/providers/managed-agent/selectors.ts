import { requestJson } from '@/lib/api/client/request'
import {
  listManagedAgentOptionsContract,
  type ManagedAgentResource,
} from '@/lib/api/contracts/managed-agents'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type {
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

/**
 * All four Managed Agent pickers read one route, distinguished only by `resource`. The route
 * decrypts the selected Claude Platform credential server-side, so the API key never reaches
 * the browser — which is why these cannot fall back to a plain client fetch.
 */
async function listResource(
  key: SelectorKey,
  resource: ManagedAgentResource,
  { context, signal }: SelectorQueryArgs
): Promise<SelectorOption[]> {
  const credentialId = ensureCredential(context, key)
  const { options } = await requestJson(listManagedAgentOptionsContract, {
    query: { credentialId, resource },
    signal,
  })
  return options
}

function resourceSelector(key: SelectorKey, resource: ManagedAgentResource): SelectorDefinition {
  return {
    key,
    contracts: [listManagedAgentOptionsContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      key,
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: (args: SelectorQueryArgs) => listResource(key, resource, args),
  }
}

export const managedAgentSelectors = {
  'managedAgent.agents': resourceSelector('managedAgent.agents', 'agents'),
  'managedAgent.vaults': resourceSelector('managedAgent.vaults', 'vaults'),
  'managedAgent.memoryStores': resourceSelector('managedAgent.memoryStores', 'memory-stores'),
  /**
   * Environments are filtered to the selected deployment mode: cloud and self-hosted expose
   * different fields (self-hosted rejects `resources`), so mixing them offers choices the rest
   * of the form cannot honour. An option whose type the API leaves unset is kept either way.
   */
  'managedAgent.environments': {
    key: 'managedAgent.environments',
    contracts: [listManagedAgentOptionsContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'managedAgent.environments',
      context.oauthCredential ?? 'none',
      context.environmentType ?? 'any',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async (args: SelectorQueryArgs) => {
      const options = await listResource('managedAgent.environments', 'environments', args)
      const mode = args.context.environmentType
      if (mode !== 'cloud' && mode !== 'self_hosted') return options
      return options.filter((option) => {
        const type = (option as { type?: string }).type
        return type === undefined || type === mode
      })
    },
  },
} satisfies Partial<Record<SelectorKey, SelectorDefinition>>
