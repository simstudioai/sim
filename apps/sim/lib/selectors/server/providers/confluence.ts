import { getScopesForService } from '@/lib/oauth/utils'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorAtlassianCloudId } from '@/lib/selectors/server/providers/atlassian'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type ConfluenceSelectorKey = Extract<ServerSelectorKey, 'confluence.spaces' | 'confluence.pages'>

const CONFLUENCE_SCOPES = getScopesForService('confluence')
const SPACE_PAGE_LIMIT = 250
const PAGE_LIST_LIMIT = 50

type SpaceStatus = 'current' | 'archived'

interface ConfluenceSpace {
  id: string
  name: string
  key: string
  status?: SpaceStatus
}

interface ConfluenceSpacesResponse {
  results?: ConfluenceSpace[]
  _links?: { next?: string }
}

interface ConfluencePage {
  id: string
  title: string
}

interface ConfluencePagesResponse {
  results?: ConfluencePage[]
}

function isPublicSelectorError(
  error: unknown
): error is
  | SelectorContextUnavailableError
  | SelectorConnectionUnavailableError
  | SelectorOptionsUnavailableError {
  return (
    error instanceof SelectorContextUnavailableError ||
    error instanceof SelectorConnectionUnavailableError ||
    error instanceof SelectorOptionsUnavailableError
  )
}

function parseSpaceCursor(raw: string | undefined): { status: SpaceStatus; inner?: string } {
  if (!raw) return { status: 'current' }
  const separator = raw.indexOf(':')
  if (separator < 0) return { status: 'current' }
  const status = raw.slice(0, separator) === 'archived' ? 'archived' : 'current'
  const inner = raw.slice(separator + 1)
  return { status, ...(inner ? { inner } : {}) }
}

function spaceOption(space: ConfluenceSpace, fallbackStatus: SpaceStatus) {
  const status = space.status ?? fallbackStatus
  const base = `${space.name} (${space.key})`
  return {
    id: space.key,
    label: status === 'archived' ? `${base} — archived` : base,
  }
}

async function resolveConfluenceAuth(args: ExecuteServerSelectorArgs) {
  const domain = args.context.domain
  if (!domain) throw new SelectorContextUnavailableError()

  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    scopes: CONFLUENCE_SCOPES,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: 'confluence',
  })
  const cloudId = await resolveSelectorAtlassianCloudId({
    accessToken: bundle.accessToken,
    domain,
    providedCloudId: bundle.cloudId,
    providedDomain: bundle.domain,
    product: 'Confluence',
    signal: args.signal,
  })
  return { accessToken: bundle.accessToken, cloudId }
}

async function requestSpaces(input: {
  accessToken: string
  cloudId: string
  params: URLSearchParams
  signal?: AbortSignal
}): Promise<ConfluenceSpacesResponse> {
  const url = new URL(`https://api.atlassian.com/ex/confluence/${input.cloudId}/wiki/api/v2/spaces`)
  url.search = input.params.toString()
  return fetchProviderJson<ConfluenceSpacesResponse>(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${input.accessToken}` },
    signal: input.signal,
  })
}

async function executeSpaces(args: ExecuteServerSelectorArgs) {
  const auth = await resolveConfluenceAuth(args)

  if (args.request.kind === 'detail') {
    const key = args.request.id.trim()
    if (!key || key.length > 255) throw new SelectorContextUnavailableError()
    const paramsFor = (status: SpaceStatus) =>
      new URLSearchParams({
        keys: key,
        limit: String(SPACE_PAGE_LIMIT),
        status,
      })
    const [current, archived] = await Promise.allSettled([
      requestSpaces({ ...auth, params: paramsFor('current'), signal: args.signal }),
      requestSpaces({ ...auth, params: paramsFor('archived'), signal: args.signal }),
    ])
    args.signal?.throwIfAborted()
    if (current.status === 'rejected' && archived.status === 'rejected') {
      for (const result of [current, archived]) {
        if (isPublicSelectorError(result.reason)) throw result.reason
      }
      throw new SelectorOptionsUnavailableError()
    }
    const spaces = [
      ...(current.status === 'fulfilled'
        ? (current.value.results ?? []).map((space) => ({ space, status: 'current' as const }))
        : []),
      ...(archived.status === 'fulfilled'
        ? (archived.value.results ?? []).map((space) => ({ space, status: 'archived' as const }))
        : []),
    ]
    const match = spaces.find(({ space }) => space.key === key)
    return detailSelectorResult(match ? spaceOption(match.space, match.status) : null)
  }

  const { status, inner } = parseSpaceCursor(args.request.cursor)
  const params = new URLSearchParams({ limit: String(SPACE_PAGE_LIMIT), status })
  if (inner) params.set('cursor', inner)
  const data = await requestSpaces({ ...auth, params, signal: args.signal })

  let nextInner: string | undefined
  if (data._links?.next) {
    try {
      nextInner =
        new URL(data._links.next, 'https://api.atlassian.com').searchParams.get('cursor') ||
        undefined
    } catch {
      nextInner = undefined
    }
  }
  const nextCursor = nextInner
    ? `${status}:${nextInner}`
    : status === 'current'
      ? 'archived:'
      : undefined
  return listSelectorResult(
    (data.results ?? []).map((space) => spaceOption(space, status)),
    nextCursor
  )
}

async function executePages(args: ExecuteServerSelectorArgs) {
  const auth = await resolveConfluenceAuth(args)
  if (args.request.kind === 'detail') {
    const pageId = args.request.id.trim()
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(pageId)) {
      throw new SelectorContextUnavailableError()
    }
    const page = await fetchProviderJson<ConfluencePage>(
      `https://api.atlassian.com/ex/confluence/${auth.cloudId}/wiki/api/v2/pages/${pageId}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.accessToken}`,
        },
        signal: args.signal,
      }
    )
    if (!page.id || !page.title) throw new SelectorOptionsUnavailableError()
    return detailSelectorResult({ id: page.id, label: page.title })
  }

  const url = new URL(`https://api.atlassian.com/ex/confluence/${auth.cloudId}/wiki/api/v2/pages`)
  url.searchParams.set('limit', String(PAGE_LIST_LIMIT))
  if (args.request.search) url.searchParams.set('title', args.request.search)
  const data = await fetchProviderJson<ConfluencePagesResponse>(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    signal: args.signal,
  })
  return listSelectorResult(
    (data.results ?? [])
      .filter((page) => page.id && page.title)
      .map((page) => ({
        id: page.id,
        label: page.title,
      }))
  )
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['confluence'] } as const

export const confluenceSelectorAttachments = {
  'confluence.spaces': { credential, destination: 'fixed', execute: executeSpaces },
  'confluence.pages': {
    credential,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: executePages,
  },
} satisfies ServerSelectorAttachmentMap<ConfluenceSelectorKey>
