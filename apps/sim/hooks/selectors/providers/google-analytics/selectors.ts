import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

/** Strips the `properties/` or `accounts/` prefix down to the numeric id the tools take. */
function toResourceId(resourceName: string): string {
  const slash = resourceName.lastIndexOf('/')
  return slash === -1 ? resourceName : resourceName.slice(slash + 1)
}

interface PropertySummary {
  property: string
  displayName?: string
  accountDisplayName?: string
}

/**
 * Labels a property with its account so two properties named "Website" under
 * different accounts remain distinguishable in the dropdown.
 */
function toPropertyOption(property: PropertySummary) {
  const id = toResourceId(property.property)
  const name = property.displayName || id
  return {
    id,
    label: property.accountDisplayName ? `${name} (${property.accountDisplayName})` : name,
  }
}

export const googleAnalyticsSelectors = {
  'googleAnalytics.properties': {
    key: 'googleAnalytics.properties',
    contracts: [selectorContracts.googleAnalyticsPropertiesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'googleAnalytics.properties',
      context.oauthCredential ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'googleAnalytics.properties')
      const data = await requestJson(selectorContracts.googleAnalyticsPropertiesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.properties || []).map(toPropertyOption)
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'googleAnalytics.properties')
      const data = await requestJson(selectorContracts.googleAnalyticsPropertiesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      const match =
        (data.properties || []).find((p) => toResourceId(p.property) === detailId) ?? null
      return match ? toPropertyOption(match) : null
    },
  },
  'googleAnalytics.accounts': {
    key: 'googleAnalytics.accounts',
    contracts: [selectorContracts.googleAnalyticsAccountsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'googleAnalytics.accounts',
      context.oauthCredential ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'googleAnalytics.accounts')
      const data = await requestJson(selectorContracts.googleAnalyticsAccountsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.accounts || []).map((account) => ({
        id: toResourceId(account.name),
        label: account.displayName || toResourceId(account.name),
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'googleAnalytics.accounts')
      const data = await requestJson(selectorContracts.googleAnalyticsAccountsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      const match = (data.accounts || []).find((a) => toResourceId(a.name) === detailId) ?? null
      if (!match) return null
      return {
        id: toResourceId(match.name),
        label: match.displayName || toResourceId(match.name),
      }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'googleAnalytics.properties' | 'googleAnalytics.accounts'>,
  SelectorDefinition
>
