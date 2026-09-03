import { z } from 'zod'
import { getCredential } from '@/lib/oauth/credential-service'
import { extractEloquaInstanceUrl, normalizeEloquaInstanceUrl } from '@/lib/oauth/eloqua'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { waitForSelectorCredentialResolution } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type EloquaSelectorKey = Extract<
  ServerSelectorKey,
  'eloqua.campaigns' | 'eloqua.contactLists' | 'eloqua.segments' | 'eloqua.emails' | 'eloqua.forms'
>

interface EloquaSelectorDestination {
  accessToken: string
  instanceUrl: string
}

interface EloquaSelectorPaths {
  list: string
  detail: (id: string) => string
}

const PAGE_SIZE = 100
const MAX_ID_LENGTH = 100

const PATHS: Record<EloquaSelectorKey, EloquaSelectorPaths> = {
  'eloqua.campaigns': {
    list: '/api/rest/2.0/assets/campaigns',
    detail: (id) => `/api/rest/2.0/assets/campaign/${id}`,
  },
  'eloqua.contactLists': {
    list: '/api/rest/1.0/assets/contact/lists',
    detail: (id) => `/api/rest/1.0/assets/contact/list/${id}`,
  },
  'eloqua.segments': {
    list: '/api/rest/2.0/assets/contact/segments',
    detail: (id) => `/api/rest/2.0/assets/contact/segment/${id}`,
  },
  'eloqua.emails': {
    list: '/api/rest/2.0/assets/emails',
    detail: (id) => `/api/rest/2.0/assets/email/${id}`,
  },
  'eloqua.forms': {
    list: '/api/rest/2.0/assets/forms',
    detail: (id) => `/api/rest/2.0/assets/form/${id}`,
  },
}

const eloquaSelectorItemSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    name: z.string().min(1).max(1_000),
    type: z.string().max(200).optional(),
    currentStatus: z.string().max(200).optional(),
  })
  .passthrough()

const eloquaSelectorPageSchema = z.object({
  elements: z.array(eloquaSelectorItemSchema).max(PAGE_SIZE),
  page: z.number().int().positive(),
  pageSize: z.number().int().nonnegative().max(PAGE_SIZE),
  total: z.number().int().nonnegative(),
})

function escapeEloquaSearchValue(value: string): string {
  return value.replaceAll("'", "''")
}

function selectorOption(item: z.infer<typeof eloquaSelectorItemSchema>): SafeSelectorOption {
  const meta = {
    ...(item.type ? { type: item.type } : {}),
    ...(item.currentStatus ? { currentStatus: item.currentStatus } : {}),
  }
  return {
    id: item.id,
    label: item.name,
    ...(Object.keys(meta).length ? { meta } : {}),
  }
}

async function prepareEloquaDestination(
  args: ExecuteServerSelectorArgs
): Promise<EloquaSelectorDestination> {
  const selectorCredential = args.credential
  const access = selectorCredential?.access
  if (!selectorCredential || !access?.credentialOwnerUserId || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }
  try {
    selectorCredential.signal?.throwIfAborted()
    const credential = await waitForSelectorCredentialResolution(
      getCredential(
        'selector-execution',
        access.resolvedCredentialId,
        access.credentialOwnerUserId
      ),
      selectorCredential.signal
    )
    if (!credential || credential.providerId !== 'eloqua') {
      throw new SelectorConnectionUnavailableError()
    }
    selectorCredential.signal?.throwIfAborted()
    const instanceUrl = normalizeEloquaInstanceUrl(extractEloquaInstanceUrl(credential.scope))
    const bundle = await resolveSelectorCredentialBundle({
      credential: { ...selectorCredential, suppliedId: access.resolvedCredentialId },
      protectedValues: args.protectedValues,
    })
    args.protectedValues.add(instanceUrl, 'reference')
    return { accessToken: bundle.accessToken, instanceUrl }
  } catch (error) {
    if (selectorCredential.signal?.aborted) throw error
    if (error instanceof SelectorConnectionUnavailableError) throw error
    throw new SelectorConnectionUnavailableError()
  }
}

function headers(destination: EloquaSelectorDestination): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${destination.accessToken}`,
  }
}

function requireSelectorId(value: string): string {
  const id = value.trim()
  if (!/^\d+$/.test(id) || id.length > MAX_ID_LENGTH) {
    throw new SelectorContextUnavailableError()
  }
  return id
}

function cursorPage(cursor: string | undefined): number {
  if (!cursor) return 1
  if (!/^\d{1,9}$/.test(cursor)) throw new SelectorContextUnavailableError()
  const page = Number(cursor)
  if (!Number.isSafeInteger(page) || page < 1) throw new SelectorContextUnavailableError()
  return page
}

async function executeEloquaSelector(
  args: ExecuteServerSelectorArgs,
  destination: EloquaSelectorDestination
) {
  const paths = PATHS[args.selectorKey as EloquaSelectorKey]
  if (!paths) throw new SelectorOptionsUnavailableError()

  if (args.request.kind === 'detail') {
    const id = requireSelectorId(args.request.id)
    const body = await fetchProviderJson<unknown>(
      new URL(paths.detail(encodeURIComponent(id)), destination.instanceUrl),
      {
        headers: headers(destination),
        redirect: 'error',
        signal: args.signal,
      }
    )
    const parsed = eloquaSelectorItemSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()
    return detailSelectorResult(selectorOption(parsed.data))
  }

  const page = cursorPage(args.request.cursor)
  const url = new URL(paths.list, destination.instanceUrl)
  url.searchParams.set('depth', 'minimal')
  url.searchParams.set('count', String(PAGE_SIZE))
  url.searchParams.set('page', String(page))
  const search = args.request.search?.trim()
  if (search) {
    url.searchParams.set('search', `name='${escapeEloquaSearchValue(search)}*'`)
  }

  const body = await fetchProviderJson<unknown>(url, {
    headers: headers(destination),
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = eloquaSelectorPageSchema.safeParse(body)
  if (!parsed.success || parsed.data.page !== page) {
    throw new SelectorOptionsUnavailableError()
  }
  const nextPage =
    parsed.data.page * parsed.data.pageSize < parsed.data.total ? page + 1 : undefined
  return listSelectorResult(
    parsed.data.elements.map(selectorOption),
    nextPage ? String(nextPage) : undefined
  )
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['eloqua'],
} as const

const attachment = () =>
  definePreparedSelectorAttachment({
    credential,
    destination: { kind: 'credential-bound', prepare: prepareEloquaDestination },
    execute: executeEloquaSelector,
  })

export const eloquaSelectorAttachments = {
  'eloqua.campaigns': attachment(),
  'eloqua.contactLists': attachment(),
  'eloqua.emails': attachment(),
  'eloqua.forms': attachment(),
  'eloqua.segments': attachment(),
} satisfies ServerSelectorAttachmentMap<EloquaSelectorKey>
