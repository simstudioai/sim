import { z } from 'zod'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorOAuthAccessToken } from '@/lib/selectors/server/credentials'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { flatSelectorResult } from '@/lib/selectors/server/providers/flat-results'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import type {
  ExecuteServerSelectorArgs,
  ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type AirtableSelectorKey = Extract<ServerSelectorKey, 'airtable.bases' | 'airtable.tables'>

const AIRTABLE_MAX_BASE_PAGES = 50
const AIRTABLE_BASES_URL = 'https://api.airtable.com/v0/meta/bases'

const airtableBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

const airtableBasesPageSchema = z.object({
  bases: z.array(airtableBaseSchema).max(1_000).optional(),
  offset: z.string().min(1).max(4_096).optional(),
})

const airtableTablesResponseSchema = z.object({
  tables: z.array(airtableBaseSchema).max(10_000).optional(),
})

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

async function getAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'airtable',
    protectedValues: args.protectedValues,
  })
}

async function listBases(args: ExecuteServerSelectorArgs, accessToken: string) {
  const bases: z.infer<typeof airtableBaseSchema>[] = []
  let offset: string | undefined
  let truncated = false

  for (let page = 0; page < AIRTABLE_MAX_BASE_PAGES; page++) {
    const url = new URL(AIRTABLE_BASES_URL)
    if (offset) url.searchParams.set('offset', offset)

    const body = await fetchProviderJson<unknown>(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: args.signal,
    })
    const parsed = airtableBasesPageSchema.safeParse(body)
    if (!parsed.success) throw new SelectorOptionsUnavailableError()

    bases.push(...(parsed.data.bases ?? []))
    offset = parsed.data.offset
    if (!offset) break
    if (page === AIRTABLE_MAX_BASE_PAGES - 1) truncated = true
  }

  return {
    items: bases.map((base) => ({ id: base.id, label: base.name })),
    truncated,
  }
}

async function listTables(args: ExecuteServerSelectorArgs) {
  const baseId = args.context.baseId
  if (!baseId || !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    throw new SelectorContextUnavailableError()
  }
  const accessToken = await getAccessToken(args)

  const body = await fetchProviderJson<unknown>(
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: args.signal,
    }
  )
  const parsed = airtableTablesResponseSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()

  return (parsed.data.tables ?? []).map((table) => ({ id: table.id, label: table.name }))
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['airtable'],
} as const

export const airtableSelectorAttachments = {
  'airtable.bases': {
    credential,
    destination: 'fixed',
    async execute(args) {
      const accessToken = await getAccessToken(args)
      const { items, truncated } = await listBases(args, accessToken)
      return flatSelectorResult(
        args.request,
        items,
        true,
        truncated
          ? { truncated: { reason: 'provider-cap', pages: AIRTABLE_MAX_BASE_PAGES } }
          : undefined
      )
    },
  },
  'airtable.tables': {
    credential,
    destination: 'fixed',
    async execute(args) {
      return flatSelectorResult(args.request, await listTables(args), true)
    },
  },
} satisfies ServerSelectorAttachmentMap<AirtableSelectorKey>
