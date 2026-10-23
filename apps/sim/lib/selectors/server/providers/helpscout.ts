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
import { HELPSCOUT_API_BASE, parseIdText } from '@/tools/helpscout/utils'

type HelpScoutSelectorKey = Extract<
  ServerSelectorKey,
  'helpscout.mailboxes' | 'helpscout.assignees'
>

const MAX_PAGE_ITEMS = 1_000
/** Help Scout documents no single-team endpoint, so a team detail scans the teams list. */
const MAX_TEAM_DETAIL_PAGES = 200

const idSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const mailboxSchema = z.object({
  id: idSchema,
  name: z.string().max(1_000).nullable().optional(),
  email: z.string().max(1_000).nullable().optional(),
})

const userSchema = z.object({
  id: idSchema,
  firstName: z.string().max(1_000).nullable().optional(),
  lastName: z.string().max(1_000).nullable().optional(),
  email: z.string().max(1_000).nullable().optional(),
})

const teamSchema = z.object({
  id: idSchema,
  name: z.string().max(1_000).nullable().optional(),
})

function pageSchema<T extends z.ZodTypeAny>(key: string, item: T) {
  return z.object({
    _embedded: z.object({ [key]: z.array(item).max(MAX_PAGE_ITEMS) }).optional(),
    _links: z.object({ next: z.object({ href: z.string() }).optional() }).optional(),
  })
}

const mailboxPageSchema = pageSchema('mailboxes', mailboxSchema)
const userPageSchema = pageSchema('users', userSchema)
const teamPageSchema = pageSchema('teams', teamSchema)

function mailboxOption(mailbox: z.infer<typeof mailboxSchema>) {
  const id = String(mailbox.id)
  return { id, label: mailbox.name?.trim() || mailbox.email?.trim() || `Inbox ${id}` }
}

function userOption(user: z.infer<typeof userSchema>) {
  const id = String(user.id)
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  return { id, label: name || user.email?.trim() || `User ${id}` }
}

function teamOption(team: z.infer<typeof teamSchema>) {
  const id = String(team.id)
  return { id, label: `Team: ${team.name?.trim() || id}` }
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
  if (parseIdText(id) === null) throw new SelectorContextUnavailableError()
  return id
}

function parsePageNumber(value: string | undefined): number {
  if (!value) return 1
  const page = Number(value)
  if (!Number.isSafeInteger(page) || page < 1) throw new SelectorContextUnavailableError()
  return page
}

async function fetchPage<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  page: number,
  schema: T
): Promise<z.infer<T>> {
  const url = new URL(`${HELPSCOUT_API_BASE}${path}`)
  url.searchParams.set('page', String(page))
  const parsed = schema.safeParse(
    await fetchProviderJson<unknown>(url, {
      headers: await helpScoutHeaders(args),
      signal: args.signal,
    })
  )
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return parsed.data
}

async function fetchDetail<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  schema: T
): Promise<z.infer<T> | null> {
  const result = await fetchProviderJsonWithStatus<unknown>(
    `${HELPSCOUT_API_BASE}${path}`,
    { headers: await helpScoutHeaders(args), signal: args.signal },
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
    const mailbox = await fetchDetail(
      args,
      `/mailboxes/${requireHelpScoutId(args.request.id)}`,
      mailboxSchema
    )
    return detailSelectorResult(mailbox ? mailboxOption(mailbox) : null)
  }
  const request = requireListRequest(args.selectorKey, args.request)
  const page = parsePageNumber(request.cursor)
  const data = await fetchPage(args, '/mailboxes', page, mailboxPageSchema)
  return listSelectorResult(
    (data._embedded?.mailboxes ?? []).map(mailboxOption),
    data._links?.next ? String(page + 1) : undefined
  )
}

/**
 * Users then teams, since a conversation can be assigned to either and both share one ID space.
 * The cursor names the list and page (`u:2`, `t:1`); Help Scout includes a `next` link only
 * while another page exists.
 */
async function executeAssignees(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const id = requireHelpScoutId(args.request.id)
    const user = await fetchDetail(args, `/users/${id}`, userSchema)
    if (user) return detailSelectorResult(userOption(user))
    for (let page = 1; page <= MAX_TEAM_DETAIL_PAGES; page++) {
      const data = await fetchPage(args, '/teams', page, teamPageSchema)
      const team = (data._embedded?.teams ?? []).find((entry) => String(entry.id) === id)
      if (team) return detailSelectorResult(teamOption(team))
      if (!data._links?.next) break
    }
    return detailSelectorResult(null)
  }

  const request = requireListRequest(args.selectorKey, args.request)
  const [list, pageText] = request.cursor ? request.cursor.split(':') : ['u', '1']
  if (list !== 'u' && list !== 't') throw new SelectorContextUnavailableError()
  const page = parsePageNumber(pageText)
  if (list === 'u') {
    const data = await fetchPage(args, '/users', page, userPageSchema)
    return listSelectorResult(
      (data._embedded?.users ?? []).map(userOption),
      data._links?.next ? `u:${page + 1}` : 't:1'
    )
  }
  const data = await fetchPage(args, '/teams', page, teamPageSchema)
  return listSelectorResult(
    (data._embedded?.teams ?? []).map(teamOption),
    data._links?.next ? `t:${page + 1}` : undefined
  )
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['helpscout'] } as const

export const helpScoutSelectorAttachments = {
  'helpscout.mailboxes': { credential, destination: 'fixed', execute: executeMailboxes },
  'helpscout.assignees': { credential, destination: 'fixed', execute: executeAssignees },
} satisfies ServerSelectorAttachmentMap<HelpScoutSelectorKey>
