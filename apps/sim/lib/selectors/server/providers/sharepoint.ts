import {
  validateMicrosoftGraphId,
  validateSharePointSiteId,
} from '@/lib/core/security/input-validation'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

type SharePointSelectorKey = Extract<ServerSelectorKey, 'sharepoint.lists' | 'sharepoint.sites'>

const sharepointCredential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['sharepoint'],
} as const

const siteCredential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['sharepoint', 'microsoft-excel'],
} as const

async function graphToken(args: ExecuteServerSelectorArgs): Promise<string> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'sharepoint',
    protectedValues: args.protectedValues,
  })
}

interface GraphPage<T> {
  items: T[]
  nextCursor?: string
}

function graphPageUrl(cursor: string | undefined, initialUrl: string): string {
  if (!cursor) return initialUrl
  let cursorUrl: string
  try {
    cursorUrl = assertGraphNextPageUrl(cursor)
  } catch {
    throw new SelectorContextUnavailableError()
  }
  if (new URL(cursorUrl).pathname !== new URL(initialUrl).pathname) {
    throw new SelectorContextUnavailableError()
  }
  return cursorUrl
}

async function fetchGraphPage<T>(
  args: ExecuteServerSelectorArgs,
  initialUrl: string
): Promise<GraphPage<T>> {
  const request = requireListRequest(args.selectorKey, args.request)
  const requestUrl = graphPageUrl(request.cursor, initialUrl)
  const token = await graphToken(args)
  const data = await fetchProviderJson<{ value?: T[] } & Record<string, unknown>>(requestUrl, {
    headers: { Authorization: `Bearer ${token}` },
    signal: args.signal,
    redirect: 'error',
  })
  const nextLink = getGraphNextPageUrl(data)
  const nextCursor = nextLink ? graphPageUrl(nextLink, initialUrl) : undefined
  return {
    items: Array.isArray(data.value) ? data.value : [],
    ...(nextCursor ? { nextCursor } : {}),
  }
}

function requireSiteId(value: string | undefined): string {
  const validation = validateSharePointSiteId(value)
  if (!validation.isValid || !validation.sanitized) {
    throw new SelectorContextUnavailableError()
  }
  return validation.sanitized
}

function requireListId(value: string): string {
  const trimmed = value.trim()
  const validation = validateMicrosoftGraphId(trimmed, 'listId')
  if (!validation.isValid || trimmed.length > 512) {
    throw new SelectorContextUnavailableError()
  }
  return trimmed
}

async function getGraphDetail<T>(args: ExecuteServerSelectorArgs, url: string): Promise<T> {
  const token = await graphToken(args)
  return fetchProviderJson<T>(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: args.signal,
    redirect: 'error',
  })
}

async function getList(
  args: ExecuteServerSelectorArgs,
  listId: string
): Promise<SafeSelectorOption> {
  const siteId = requireSiteId(args.context.siteId)
  const requestedId = requireListId(listId)
  const list = await getGraphDetail<{ id?: string; displayName?: string | null }>(
    args,
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(requestedId)}?$select=id,displayName,list`
  )
  const providerId = typeof list.id === 'string' ? list.id.trim() : ''
  const displayName = typeof list.displayName === 'string' ? list.displayName.trim() : ''
  const label = displayName || providerId
  if (!providerId || !label) throw new SelectorOptionsUnavailableError()
  return { id: requestedId, label }
}

async function getSite(
  args: ExecuteServerSelectorArgs,
  siteId: string
): Promise<SafeSelectorOption> {
  const requestedId = requireSiteId(siteId)
  const site = await getGraphDetail<{
    id?: string
    name?: string | null
    displayName?: string | null
  }>(
    args,
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(requestedId)}?$select=id,name,displayName,webUrl`
  )
  const providerId = typeof site.id === 'string' ? site.id.trim() : ''
  const displayName = typeof site.displayName === 'string' ? site.displayName.trim() : ''
  const name = typeof site.name === 'string' ? site.name.trim() : ''
  const label = displayName || name || providerId
  if (!providerId || !label) throw new SelectorOptionsUnavailableError()
  return { id: requestedId, label }
}

async function listLists(args: ExecuteServerSelectorArgs) {
  const siteId = requireSiteId(args.context.siteId)
  const page = await fetchGraphPage<{
    id: string
    displayName: string
    list?: { hidden?: boolean }
  }>(
    args,
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/lists?$select=id,displayName,description,webUrl,list&$top=999`
  )
  return {
    items: page.items
      .filter((list) => list.list?.hidden !== true)
      .map((list) => ({ id: list.id, label: list.displayName })),
    nextCursor: page.nextCursor,
  }
}

async function listSites(args: ExecuteServerSelectorArgs) {
  const request = requireListRequest(args.selectorKey, args.request)
  const url = new URL('https://graph.microsoft.com/v1.0/sites')
  url.searchParams.set('search', request.search?.trim() || '*')
  url.searchParams.set('$select', 'id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime')
  url.searchParams.set('$top', '999')
  const page = await fetchGraphPage<{ id: string; name: string; displayName?: string }>(
    args,
    url.toString()
  )
  return {
    items: page.items.map((site) => ({ id: site.id, label: site.displayName || site.name })),
    nextCursor: page.nextCursor,
  }
}

export const sharepointSelectorAttachments = {
  'sharepoint.lists': {
    credential: sharepointCredential,
    destination: 'fixed',
    execute: async (args) => {
      if (args.request.kind === 'detail') {
        return detailSelectorResult(await getList(args, args.request.id))
      }
      const page = await listLists(args)
      return listSelectorResult(page.items, page.nextCursor)
    },
  },
  'sharepoint.sites': {
    credential: siteCredential,
    destination: 'fixed',
    execute: async (args) => {
      if (args.request.kind === 'detail') {
        return detailSelectorResult(await getSite(args, args.request.id))
      }
      const page = await listSites(args)
      return listSelectorResult(page.items, page.nextCursor)
    },
  },
} satisfies ServerSelectorAttachmentMap<SharePointSelectorKey>
