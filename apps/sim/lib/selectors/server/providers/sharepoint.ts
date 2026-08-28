import { validateSharePointSiteId } from '@/lib/core/security/input-validation'
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

async function drainGraph<T>(args: ExecuteServerSelectorArgs, initialUrl: string): Promise<T[]> {
  const token = await graphToken(args)
  const values: T[] = []
  let nextUrl: string | undefined = initialUrl
  for (let page = 0; page < 10 && nextUrl; page++) {
    const data = await fetchProviderJson<{ value?: T[] } & Record<string, unknown>>(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: args.signal,
      redirect: 'error',
    })
    if (Array.isArray(data.value)) values.push(...data.value)
    const nextLink = getGraphNextPageUrl(data)
    nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined
  }
  return values
}

async function listLists(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const siteId = args.context.siteId
  if (!siteId) throw new SelectorContextUnavailableError()
  const validation = validateSharePointSiteId(siteId)
  if (!validation.isValid) throw new SelectorContextUnavailableError()
  const lists = await drainGraph<{
    id: string
    displayName: string
    list?: { hidden?: boolean }
  }>(
    args,
    `https://graph.microsoft.com/v1.0/sites/${validation.sanitized}/lists?$select=id,displayName,description,webUrl&$expand=list($select=hidden)&$top=999`
  )
  return lists
    .filter((list) => list.list?.hidden !== true)
    .map((list) => ({ id: list.id, label: list.displayName }))
}

async function listSites(args: ExecuteServerSelectorArgs): Promise<SafeSelectorOption[]> {
  const sites = await drainGraph<{ id: string; name: string; displayName?: string }>(
    args,
    'https://graph.microsoft.com/v1.0/sites?search=*&$select=id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime&$top=999'
  )
  return sites.map((site) => ({ id: site.id, label: site.displayName || site.name }))
}

export const sharepointSelectorAttachments = {
  'sharepoint.lists': {
    credential: sharepointCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listLists(args), true),
  },
  'sharepoint.sites': {
    credential: siteCredential,
    destination: 'fixed',
    execute: async (args) => flatSelectorResult(args.request, await listSites(args), true),
  },
} satisfies ServerSelectorAttachmentMap<SharePointSelectorKey>
