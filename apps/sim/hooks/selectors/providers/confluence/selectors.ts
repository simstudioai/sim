import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { fetchOAuthToken } from '@/hooks/selectors/helpers'
import { ensureCredential, ensureDomain, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

function formatConfluenceSpaceLabel(space: { name: string; key: string; status?: string }): string {
  const base = `${space.name} (${space.key})`
  return space.status === 'archived' ? `${base} — archived` : base
}

function toSpaceOption(space: { name: string; key: string; status?: string }): {
  id: string
  label: string
} {
  return { id: space.key, label: formatConfluenceSpaceLabel(space) }
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
    /**
     * Drives pagination through {@link useSelectorOptions}, which drains every
     * page via this callback. No `fetchList` — the paged path supersedes it.
     */
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
        items: (data.spaces || []).map(toSpaceOption),
        nextCursor: data.nextCursor,
      }
    },
    /**
     * Resolves a single space by key in one request via the server's exact-key
     * lookup. Previously this fetched the first page and scanned it, so a space
     * that sorts beyond page 1 never resolved — on a large site that is most of
     * them. Keyed resolution is independent of how far the page drain has run.
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
          spaceKey: detailId,
        },
        signal,
      })
      const space = (data.spaces || []).find((s) => s.key === detailId) ?? null
      if (!space) return null
      return toSpaceOption(space)
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
    /**
     * Deliberately a single request, not a drain. `/pages` is cursor-paginated and
     * this list is therefore capped at `limit`, which is a real gap — but draining it
     * is worse: with no search term `title` is unset, so the drain would walk the
     * entire site (up to `MAX_AUTO_DRAIN_PAGES` requests) every time the dropdown
     * opens, and the route does not forward an abort signal upstream, so superseded
     * drains still bill the tenant's rate limit. Fixing this properly needs
     * server-side search whose `title` semantics have been confirmed against a live
     * instance, not brute-force loading.
     */
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
