import { z } from 'zod'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
  selectorProviderStatusError,
} from '@/lib/selectors/server/providers/http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type HelpScoutSelectorKey = Extract<ServerSelectorKey, 'helpscout.mailboxes' | 'helpscout.users'>

const HELPSCOUT_API_BASE = 'https://api.helpscout.net/v2'
const HELPSCOUT_ID_PATTERN = /^\d{1,16}$/
const MAX_PAGE_ITEMS = 1_000

const mailboxSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  name: z.string().max(1_000).nullable().optional(),
  email: z.string().max(1_000).nullable().optional(),
})

const userSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  firstName: z.string().max(1_000).nullable().optional(),
  lastName: z.string().max(1_000).nullable().optional(),
  email: z.string().max(1_000).nullable().optional(),
})

function pageSchema<T extends z.ZodTypeAny>(key: string, item: T) {
  return z.object({
    _embedded: z.object({ [key]: z.array(item).max(MAX_PAGE_ITEMS) }).optional(),
    _links: z.object({ next: z.object({ href: z.string() }).optional() }).optional(),
  })
}

const mailboxPageSchema = pageSchema('mailboxes', mailboxSchema)
const userPageSchema = pageSchema('users', userSchema)

type HelpScoutMailbox = z.infer<typeof mailboxSchema>
type HelpScoutUser = z.infer<typeof userSchema>

function mailboxOption(mailbox: HelpScoutMailbox) {
  const id = String(mailbox.id)
  return { id, label: mailbox.name?.trim() || mailbox.email?.trim() || `Inbox ${id}` }
}

function userOption(user: HelpScoutUser) {
  const id = String(user.id)
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  return { id, label: name || user.email?.trim() || `User ${id}` }
}

async function helpScoutHeaders(args: ExecuteServerSelectorArgs): Promise<Record<string, string>> {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  const token = await resolveSelectorOAuthAccessToken({
    credential: args.credential,
    serviceId: 'helpscout',
    protectedValues: args.protectedValues,
  })
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

function requireHelpScoutId(value: string): string {
  const id = value.trim()
  if (!HELPSCOUT_ID_PATTERN.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new SelectorContextUnavailableError()
  }
  return id
}

function requirePageCursor(cursor: string | undefined): number {
  if (!cursor) return 1
  const page = Number(cursor)
  if (!Number.isSafeInteger(page) || page < 1) throw new SelectorContextUnavailableError()
  return page
}

/**
 * Help Scout paginates by page number and includes a `next` link only when another page exists,
 * so the selector cursor is simply the following page number.
 */
function nextPageCursor(links: { next?: unknown } | undefined, requested: number) {
  return links?.next ? String(requested + 1) : undefined
}

async function fetchDetail<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  schema: T
): Promise<z.infer<T> | null> {
  const result = await fetchProviderJsonWithStatus<unknown>(
    `${HELPSCOUT_API_BASE}${path}`,
    {
      headers: await helpScoutHeaders(args),
      signal: args.signal,
    },
    { passthroughStatuses: [404] }
  )
  if (!result.ok) {
    if (result.status === 404) return null
    throw selectorProviderStatusError(result.status)
  }
  const parsed = schema.safeParse(result.data)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return parsed.data
}

async function executeMailboxes(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const id = requireHelpScoutId(args.request.id)
    const mailbox = await fetchDetail(args, `/mailboxes/${id}`, mailboxSchema)
    return detailSelectorResult(mailbox ? mailboxOption(mailbox) : null)
  }

  const request = requireListRequest(args.selectorKey, args.request)
  const page = requirePageCursor(request.cursor)
  const url = new URL(`${HELPSCOUT_API_BASE}/mailboxes`)
  url.searchParams.set('page', String(page))
  const parsed = mailboxPageSchema.safeParse(
    await fetchProviderJson<unknown>(url, {
      headers: await helpScoutHeaders(args),
      signal: args.signal,
    })
  )
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return listSelectorResult(
    (parsed.data._embedded?.mailboxes ?? []).map(mailboxOption),
    nextPageCursor(parsed.data._links, page)
  )
}

async function executeUsers(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const id = requireHelpScoutId(args.request.id)
    const user = await fetchDetail(args, `/users/${id}`, userSchema)
    return detailSelectorResult(user ? userOption(user) : null)
  }

  const request = requireListRequest(args.selectorKey, args.request)
  const page = requirePageCursor(request.cursor)
  const url = new URL(`${HELPSCOUT_API_BASE}/users`)
  url.searchParams.set('page', String(page))
  const parsed = userPageSchema.safeParse(
    await fetchProviderJson<unknown>(url, {
      headers: await helpScoutHeaders(args),
      signal: args.signal,
    })
  )
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return listSelectorResult(
    (parsed.data._embedded?.users ?? []).map(userOption),
    nextPageCursor(parsed.data._links, page)
  )
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['helpscout'] } as const

export const helpScoutSelectorAttachments = {
  'helpscout.mailboxes': { credential, destination: 'fixed', execute: executeMailboxes },
  'helpscout.users': { credential, destination: 'fixed', execute: executeUsers },
} satisfies ServerSelectorAttachmentMap<HelpScoutSelectorKey>
