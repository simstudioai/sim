import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
} from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import { detailSelectorResult, listSelectorResult } from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type WebflowSelectorKey = Extract<
  ServerSelectorKey,
  'webflow.sites' | 'webflow.collections' | 'webflow.items'
>

const WEBFLOW_ITEM_PAGE_SIZE = 100

interface WebflowItem {
  id?: unknown
  fieldData?: {
    name?: unknown
    title?: unknown
    slug?: unknown
  }
}

interface WebflowItemPage {
  items?: unknown
  pagination?: {
    limit?: unknown
    offset?: unknown
    total?: unknown
  }
}

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

function parseItemOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) throw new SelectorContextUnavailableError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SelectorContextUnavailableError()
  return offset
}

function projectItem(item: WebflowItem): SafeSelectorOption | null {
  if (typeof item.id !== 'string' || !item.id) return null
  const { name, title, slug } = item.fieldData ?? {}
  const label = [name, title, slug].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  )
  return { id: item.id, label: label ?? item.id }
}

function requirePaginationNumber(value: unknown, options: { positive?: boolean } = {}): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (options.positive && (value as number) === 0)
  ) {
    throw new SelectorOptionsUnavailableError()
  }
  return value as number
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

async function listItems(args: ExecuteServerSelectorArgs) {
  if (args.request.kind !== 'list') throw new SelectorContextUnavailableError()
  const offset = parseItemOffset(args.request.cursor)
  const collectionId = requireWebflowId(args.context.collectionId, 'collectionId')
  const token = await tokenFor(args)
  const url = new URL(
    `https://api.webflow.com/v2/collections/${encodeURIComponent(collectionId)}/items`
  )
  url.searchParams.set('limit', String(WEBFLOW_ITEM_PAGE_SIZE))
  url.searchParams.set('offset', String(offset))
  const search = args.request.search?.trim()
  if (search) url.searchParams.set('filter[name][contains]', search)

  const data = await fetchProviderJson<WebflowItemPage>(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: args.signal,
    redirect: 'error',
  })
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.items) ||
    !data.pagination ||
    typeof data.pagination !== 'object' ||
    Array.isArray(data.pagination)
  ) {
    throw new SelectorOptionsUnavailableError()
  }

  const reportedLimit = requirePaginationNumber(data.pagination.limit, { positive: true })
  const reportedOffset = requirePaginationNumber(data.pagination.offset)
  const reportedTotal = requirePaginationNumber(data.pagination.total)
  if (
    reportedLimit > WEBFLOW_ITEM_PAGE_SIZE ||
    reportedOffset !== offset ||
    data.items.length > reportedLimit
  ) {
    throw new SelectorOptionsUnavailableError()
  }
  if (data.items.length === 0 && reportedOffset < reportedTotal) {
    throw new SelectorOptionsUnavailableError()
  }

  const nextOffset = reportedOffset + data.items.length
  if (
    !Number.isSafeInteger(nextOffset) ||
    (nextOffset <= reportedOffset && data.items.length > 0)
  ) {
    throw new SelectorOptionsUnavailableError()
  }
  const items = data.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const option = projectItem(item as WebflowItem)
    return option ? [option] : []
  })
  return listSelectorResult(
    items,
    data.items.length > 0 && nextOffset < reportedTotal ? String(nextOffset) : undefined
  )
}

async function getItem(args: ExecuteServerSelectorArgs) {
  if (args.request.kind !== 'detail') throw new SelectorContextUnavailableError()
  const collectionId = requireWebflowId(args.context.collectionId, 'collectionId')
  const itemId = requireWebflowId(args.request.id, 'itemId')
  const token = await tokenFor(args)
  const result = await fetchProviderJsonWithStatus<WebflowItem>(
    `https://api.webflow.com/v2/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
    {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: args.signal,
      redirect: 'error',
    },
    { passthroughStatuses: [404] }
  )
  if (!result.ok) return detailSelectorResult(null)
  if (!result.data || typeof result.data !== 'object') {
    throw new SelectorOptionsUnavailableError()
  }
  const item = projectItem(result.data)
  if (!item || item.id !== itemId) throw new SelectorOptionsUnavailableError()
  return detailSelectorResult(item)
}

function executeItems(args: ExecuteServerSelectorArgs) {
  return args.request.kind === 'detail' ? getItem(args) : listItems(args)
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
    execute: executeItems,
  },
} satisfies ServerSelectorAttachmentMap<WebflowSelectorKey>
