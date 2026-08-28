import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type WebflowSelectorKey = Extract<
  ServerSelectorKey,
  'webflow.sites' | 'webflow.collections' | 'webflow.items'
>

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['webflow'],
} as const

async function tokenFor(args: ExecuteServerSelectorArgs): Promise<string> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'webflow',
    protectedValues: args.protectedValues,
  })
}

function requireWebflowId(value: string | undefined, name: string): string {
  if (!value) throw new SelectorContextUnavailableError()
  const validation = validateAlphanumericId(value, name)
  if (!validation.isValid) throw new SelectorContextUnavailableError()
  return validation.sanitized ?? value
}

async function listSites(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const token = await tokenFor(args)
  const data = await fetchProviderJson<{
    sites?: Array<{ id: string; displayName?: string; shortName?: string }>
  }>('https://api.webflow.com/v2/sites', {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: args.signal,
    redirect: 'error',
  })
  return (data.sites ?? []).map((site) => ({
    id: site.id,
    label: site.displayName || site.shortName || site.id,
  }))
}

async function listCollections(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const siteId = requireWebflowId(args.context.siteId, 'siteId')
  const token = await tokenFor(args)
  const data = await fetchProviderJson<{
    collections?: Array<{ id: string; displayName?: string; slug?: string }>
  }>(`https://api.webflow.com/v2/sites/${encodeURIComponent(siteId)}/collections`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: args.signal,
    redirect: 'error',
  })
  return (data.collections ?? []).map((collection) => ({
    id: collection.id,
    label: collection.displayName || collection.slug || collection.id,
  }))
}

async function listItems(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const collectionId = requireWebflowId(args.context.collectionId, 'collectionId')
  const token = await tokenFor(args)
  const items: Array<{
    id: string
    fieldData?: { name?: string; title?: string; slug?: string }
  }> = []
  let offset = 0
  for (let page = 0; page < 50; page++) {
    const url = new URL(
      `https://api.webflow.com/v2/collections/${encodeURIComponent(collectionId)}/items`
    )
    url.searchParams.set('limit', '100')
    url.searchParams.set('offset', String(offset))
    const data = await fetchProviderJson<{
      items?: typeof items
      pagination?: { total?: number }
    }>(url, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: args.signal,
      redirect: 'error',
    })
    const pageItems = data.items ?? []
    items.push(...pageItems)
    offset += pageItems.length
    if (
      pageItems.length === 0 ||
      (typeof data.pagination?.total === 'number' && items.length >= data.pagination.total)
    ) {
      break
    }
  }

  const search = args.request.kind === 'list' ? args.request.search?.toLowerCase() : undefined
  return items.flatMap((item) => {
    if (!item.id) return []
    const label = item.fieldData?.name || item.fieldData?.title || item.fieldData?.slug || item.id
    return search && !label.toLowerCase().includes(search) ? [] : [{ id: item.id, label }]
  })
}

export const webflowSelectorAttachments = {
  'webflow.sites': {
    credential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listSites(args)),
  },
  'webflow.collections': {
    credential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listCollections(args)),
  },
  'webflow.items': {
    credential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listItems(args)),
  },
} satisfies ServerSelectorAttachmentMap<WebflowSelectorKey>
