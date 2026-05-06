import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { fetchOAuthToken } from '@/hooks/selectors/helpers'
import { ensureCredential, ensureDomain, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

function formatConfluenceSpaceLabel(space: { name: string; key: string; status?: string }): string {
  const base = `${space.name} (${space.key})`
  return space.status === 'archived' ? `${base} — archived` : base
}

export const confluenceSelectors = {
  'confluence.spaces': {
    key: 'confluence.spaces',
    contracts: [selectorContracts.confluenceSpacesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'confluence.spaces',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'confluence.spaces')
      const domain = ensureDomain(context, 'confluence.spaces')
      const collected: { id: string; label: string }[] = []
      let cursor: string | undefined
      do {
        const data = await requestJson(selectorContracts.confluenceSpacesSelectorContract, {
          body: {
            credential: credentialId,
            workflowId: context.workflowId,
            domain,
            cursor,
          },
          signal,
        })
        for (const space of data.spaces || []) {
          collected.push({ id: space.id, label: formatConfluenceSpaceLabel(space) })
        }
        cursor = data.nextCursor
      } while (cursor)
      return collected
    },
    fetchPage: async ({ context, cursor, signal }) => {
      const credentialId = ensureCredential(context, 'confluence.spaces')
      const domain = ensureDomain(context, 'confluence.spaces')
      const data = await requestJson(selectorContracts.confluenceSpacesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          domain,
          cursor,
        },
        signal,
      })
      return {
        items: (data.spaces || []).map((space) => ({
          id: space.id,
          label: formatConfluenceSpaceLabel(space),
        })),
        nextCursor: data.nextCursor,
      }
    },
    /**
     * Resolves a single space label. Hits only the first page — the dropdown's
     * `fetchPage` stream populates the options cache for spaces beyond page 1,
     * and `useSelectorOptionMap` merges them in. Walking all pages here would
     * double API load since the stream is already running in parallel.
     */
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'confluence.spaces')
      const domain = ensureDomain(context, 'confluence.spaces')
      const data = await requestJson(selectorContracts.confluenceSpacesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          domain,
        },
        signal,
      })
      const space = (data.spaces || []).find((s) => s.id === detailId) ?? null
      if (!space) return null
      return { id: space.id, label: formatConfluenceSpaceLabel(space) }
    },
  },
  'confluence.pages': {
    key: 'confluence.pages',
    contracts: [
      selectorContracts.confluencePagesSelectorContract,
      selectorContracts.confluencePageSelectorContract,
    ],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'confluence.pages',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'confluence.pages')
      const domain = ensureDomain(context, 'confluence.pages')
      const bundle = await fetchOAuthToken(credentialId, context.workflowId)
      if (!bundle) {
        throw new Error('Missing Confluence access token')
      }
      const data = await requestJson(selectorContracts.confluencePagesSelectorContract, {
        body: {
          domain,
          accessToken: bundle.accessToken,
          cloudId: bundle.cloudId,
          title: search,
        },
        signal,
      })
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'confluence.pages')
      const domain = ensureDomain(context, 'confluence.pages')
      const bundle = await fetchOAuthToken(credentialId, context.workflowId)
      if (!bundle) {
        throw new Error('Missing Confluence access token')
      }
      const data = await requestJson(selectorContracts.confluencePageSelectorContract, {
        body: {
          domain,
          accessToken: bundle.accessToken,
          cloudId: bundle.cloudId,
          pageId: detailId,
        },
        signal,
      })
      return { id: data.id, label: data.title }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'confluence.spaces' | 'confluence.pages'>,
  SelectorDefinition
>
