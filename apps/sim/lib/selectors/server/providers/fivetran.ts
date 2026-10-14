import { toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
} from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
  type ServerSelectorExecutionResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { safeUrlPathSegment } from '@/tools/url-path'

type FivetranSelectorKey = Extract<ServerSelectorKey, `fivetran.${string}`>

const FIVETRAN_API_BASE_URL = 'https://api.fivetran.com/v1'
const FIVETRAN_PAGE_SIZE = 100
const FIVETRAN_CURSOR_PATTERN = /^[\x21-\x7e]{1,4096}$/

const groupSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().max(1_024).nullish(),
})

const connectionSchema = z.object({
  id: z.string().min(1).max(512),
  schema: z.string().max(1_024).nullish(),
  service: z.string().max(256).nullish(),
})

type Group = z.infer<typeof groupSchema>
type Connection = z.infer<typeof connectionSchema>

function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.object({
      items: z.array(item).max(1_000),
      next_cursor: z.string().max(4_096).nullish(),
    }),
  })
}

async function fivetranHeaders(args: ExecuteServerSelectorArgs): Promise<Record<string, string>> {
  const { accessToken } = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  return { Authorization: `Basic ${accessToken}`, Accept: 'application/json' }
}

function requireCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  if (!FIVETRAN_CURSOR_PATTERN.test(cursor)) throw new SelectorContextUnavailableError()
  return cursor
}

/** Encodes a context value or requested id as one path segment, rejecting traversal input. */
function segment(value: string | undefined, paramName: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new SelectorContextUnavailableError()
  try {
    return safeUrlPathSegment(trimmed, paramName)
  } catch {
    throw new SelectorContextUnavailableError()
  }
}

async function listPage<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  item: T
): Promise<{ items: z.infer<T>[]; nextCursor?: string }> {
  const url = new URL(`${FIVETRAN_API_BASE_URL}${path}`)
  url.searchParams.set('limit', String(FIVETRAN_PAGE_SIZE))
  const cursor = requireCursor(args.request.kind === 'list' ? args.request.cursor : undefined)
  if (cursor) url.searchParams.set('cursor', cursor)
  const body = await fetchProviderJson<unknown>(url, {
    headers: await fivetranHeaders(args),
    signal: args.signal,
  })
  const parsed = pageSchema(item).safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return {
    items: parsed.data.data.items,
    nextCursor: parsed.data.data.next_cursor || undefined,
  }
}

/** Resolves one resource by id; a missing resource resolves to no option. */
async function getDetail<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  item: T,
  toOption: (value: z.infer<T>) => SafeSelectorOption
): Promise<ServerSelectorExecutionResult> {
  const result = await fetchProviderJsonWithStatus<unknown>(
    `${FIVETRAN_API_BASE_URL}${path}`,
    { headers: await fivetranHeaders(args), signal: args.signal },
    { passthroughStatuses: [404] }
  )
  if (!result.ok) return detailSelectorResult(null)
  const parsed = item.safeParse(toRecord(result.data).data)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return detailSelectorResult(toOption(parsed.data))
}

function groupOption(group: Group): SafeSelectorOption {
  return { id: group.id, label: truncate(group.name?.trim() || group.id, 200) }
}

function connectionOption(connection: Connection): SafeSelectorOption {
  const name = connection.schema?.trim() || connection.id
  const service = connection.service?.trim()
  return {
    id: connection.id,
    label: truncate(service ? `${name} (${service})` : name, 200),
    ...(service ? { meta: { service } } : {}),
  }
}

async function executeGroups(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return getDetail(
      args,
      `/groups/${segment(args.request.id, 'groupId')}`,
      groupSchema,
      groupOption
    )
  }
  const page = await listPage(args, '/groups', groupSchema)
  return listSelectorResult(page.items.map(groupOption), page.nextCursor)
}

async function executeConnections(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return getDetail(
      args,
      `/connections/${segment(args.request.id, 'connectionId')}`,
      connectionSchema,
      connectionOption
    )
  }
  const page = await listPage(args, '/connections', connectionSchema)
  return listSelectorResult(page.items.map(connectionOption), page.nextCursor)
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['fivetran'],
} as const

/** Declared so the integration gate never depends on how the catalog classifies Fivetran's auth. */
const integrationBlockTypes = ['fivetran'] as const

export const fivetranSelectorAttachments = {
  'fivetran.groups': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: executeGroups,
  },
  'fivetran.connections': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: executeConnections,
  },
} satisfies ServerSelectorAttachmentMap<FivetranSelectorKey>
