import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { appendSelectorOptions } from '@/lib/selectors/server/option-budget'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import {
  fetchProviderJson,
  fetchProviderJsonWithStatus,
} from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachment,
  type ServerSelectorAttachmentMap,
  type ServerSelectorExecutionResult,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { buildCodaUrl, codaHeaders } from '@/tools/coda/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

type CodaSelectorKey = Extract<ServerSelectorKey, `coda.${string}`>

const CODA_PAGE_SIZE = 100
const CODA_MAX_FLAT_PAGES = 20
const CODA_PAGE_TOKEN_PATTERN = /^[\x21-\x7e]{1,4096}$/

const namedItemSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().optional(),
})

const tableItemSchema = namedItemSchema.extend({ tableType: z.string().max(64).optional() })

const columnItemSchema = namedItemSchema.extend({
  format: z
    .object({ type: z.string().max(64).optional() })
    .passthrough()
    .optional(),
})

const permissionItemSchema = z.object({
  id: z.string().min(1).max(512),
  access: z.string().max(64),
  principal: z
    .object({
      type: z.string().max(64).optional(),
      email: z.string().max(1_024).optional(),
      groupName: z.string().max(1_024).optional(),
      domain: z.string().max(1_024).optional(),
      workspaceId: z.string().max(512).optional(),
    })
    .optional(),
})

function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item).max(1_000).optional(),
    nextPageToken: z.string().max(4_096).optional(),
  })
}

type NamedItem = z.infer<typeof namedItemSchema>
type TableItem = z.infer<typeof tableItemSchema>
type ColumnItem = z.infer<typeof columnItemSchema>
type PermissionItem = z.infer<typeof permissionItemSchema>

async function codaAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  const { accessToken } = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  return accessToken
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

function docPath(args: ExecuteServerSelectorArgs): string {
  return `/docs/${segment(args.context.docId, 'docId')}`
}

function tablePath(args: ExecuteServerSelectorArgs): string {
  return `${docPath(args)}/tables/${segment(args.context.tableId, 'tableId')}`
}

function requireCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  if (!CODA_PAGE_TOKEN_PATTERN.test(cursor)) throw new SelectorContextUnavailableError()
  return cursor
}

async function fetchPage<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  accessToken: string,
  path: string,
  schema: T,
  query: Record<string, string | number | undefined>
): Promise<z.infer<ReturnType<typeof pageSchema<T>>>> {
  const body = await fetchProviderJson<unknown>(buildCodaUrl(path, query), {
    headers: codaHeaders(accessToken),
    signal: args.signal,
  })
  const parsed = pageSchema(schema).safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return parsed.data
}

/** Reads every page of a bounded Coda list into one flat option set. */
async function listAllPages<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  schema: T,
  toOption: (item: z.infer<T>) => SafeSelectorOption
): Promise<ServerSelectorExecutionResult> {
  const accessToken = await codaAccessToken(args)
  const options: SafeSelectorOption[] = []
  let pageToken: string | undefined
  let truncated = false

  for (let page = 0; page < CODA_MAX_FLAT_PAGES; page++) {
    const data = await fetchPage(args, accessToken, path, schema, {
      limit: CODA_PAGE_SIZE,
      pageToken,
    })
    const appended = appendSelectorOptions(options, (data.items ?? []).map(toOption))
    pageToken = data.nextPageToken
    if (!pageToken) {
      if (appended.overflow) truncated = true
      break
    }
    if (appended.full || page === CODA_MAX_FLAT_PAGES - 1) {
      truncated = true
      break
    }
  }

  return listSelectorResult(
    options,
    undefined,
    truncated
      ? {
          truncated: {
            reason: 'provider-cap',
            limit: MAX_SELECTOR_OPTIONS,
            pages: CODA_MAX_FLAT_PAGES,
          },
        }
      : undefined
  )
}

/** Resolves one resource by id; a missing or deleted resource resolves to no option. */
async function getDetail<T extends z.ZodTypeAny>(
  args: ExecuteServerSelectorArgs,
  path: string,
  schema: T,
  toOption: (item: z.infer<T>) => SafeSelectorOption
): Promise<ServerSelectorExecutionResult> {
  const accessToken = await codaAccessToken(args)
  const result = await fetchProviderJsonWithStatus<unknown>(
    buildCodaUrl(path),
    { headers: codaHeaders(accessToken), signal: args.signal },
    { passthroughStatuses: [404, 410] }
  )
  if (!result.ok) return detailSelectorResult(null)
  const parsed = schema.safeParse(result.data)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return detailSelectorResult(toOption(parsed.data))
}

function namedOption(item: NamedItem): SafeSelectorOption {
  return { id: item.id, label: truncate(item.name?.trim() || item.id, 200) }
}

function tableOption(item: TableItem): SafeSelectorOption {
  const name = truncate(item.name?.trim() || item.id, 200)
  return {
    id: item.id,
    label: item.tableType === 'view' ? `${name} (view)` : name,
    ...(item.tableType ? { meta: { tableType: item.tableType } } : {}),
  }
}

function columnOption(item: ColumnItem): SafeSelectorOption {
  const formatType = item.format?.type
  return {
    id: item.id,
    label: truncate(item.name?.trim() || item.id, 200),
    ...(formatType ? { meta: { formatType } } : {}),
  }
}

function permissionOption(item: PermissionItem): SafeSelectorOption {
  const principal = item.principal
  const who =
    principal?.type === 'anyone'
      ? 'Anyone with the link'
      : principal?.email ||
        principal?.groupName ||
        principal?.domain ||
        principal?.workspaceId ||
        item.id
  return {
    id: item.id,
    label: `${who} (${item.access})`,
    meta: { access: item.access, ...(principal?.type ? { principalType: principal.type } : {}) },
  }
}

/**
 * Docs and rows can number in the thousands, so they page through the selector
 * cursor instead of being read eagerly. Docs support Coda's server-side search.
 */
async function executeDocs(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return getDetail(
      args,
      `/docs/${segment(args.request.id, 'docId')}`,
      namedItemSchema,
      namedOption
    )
  }
  const accessToken = await codaAccessToken(args)
  const data = await fetchPage(args, accessToken, '/docs', namedItemSchema, {
    limit: CODA_PAGE_SIZE,
    query: args.request.search?.trim() || undefined,
    pageToken: requireCursor(args.request.cursor),
  })
  return listSelectorResult((data.items ?? []).map(namedOption), data.nextPageToken)
}

async function executeRows(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return getDetail(
      args,
      `${tablePath(args)}/rows/${segment(args.request.id, 'rowId')}`,
      namedItemSchema,
      namedOption
    )
  }
  const accessToken = await codaAccessToken(args)
  const data = await fetchPage(args, accessToken, `${tablePath(args)}/rows`, namedItemSchema, {
    limit: CODA_PAGE_SIZE,
    pageToken: requireCursor(args.request.cursor),
  })
  return listSelectorResult((data.items ?? []).map(namedOption), data.nextPageToken)
}

function docScopedAttachment<T extends z.ZodTypeAny>(input: {
  collection: string
  idParam: string
  schema: T
  toOption: (item: z.infer<T>) => SafeSelectorOption
  scope?: (args: ExecuteServerSelectorArgs) => string
}): ServerSelectorAttachment {
  const scope = input.scope ?? docPath
  return {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: async (args) =>
      args.request.kind === 'detail'
        ? getDetail(
            args,
            `${scope(args)}/${input.collection}/${segment(args.request.id, input.idParam)}`,
            input.schema,
            input.toOption
          )
        : listAllPages(args, `${scope(args)}/${input.collection}`, input.schema, input.toOption),
  }
}

async function executePermissions(args: ExecuteServerSelectorArgs) {
  const listed = await listAllPages(
    args,
    `${docPath(args)}/acl/permissions`,
    permissionItemSchema,
    permissionOption
  )
  if (args.request.kind === 'list' || listed.kind !== 'list') return listed
  const id = args.request.id
  return {
    ...detailSelectorResult(listed.items.find((item) => item.id === id) ?? null),
    ...(listed.diagnostics ? { diagnostics: listed.diagnostics } : {}),
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['coda'],
} as const

/**
 * The integration this selector reaches. Declared rather than derived: Coda is an
 * API-key integration with no entry in the deployment OAuth catalog, so its
 * service id maps to no block type.
 */
const integrationBlockTypes = ['coda'] as const

export const codaSelectorAttachments = {
  'coda.docs': { credential, integrationBlockTypes, destination: 'fixed', execute: executeDocs },
  'coda.pages': docScopedAttachment({
    collection: 'pages',
    idParam: 'pageId',
    schema: namedItemSchema,
    toOption: namedOption,
  }),
  'coda.tables': docScopedAttachment({
    collection: 'tables',
    idParam: 'tableId',
    schema: tableItemSchema,
    toOption: tableOption,
  }),
  'coda.columns': docScopedAttachment({
    collection: 'columns',
    idParam: 'columnId',
    schema: columnItemSchema,
    toOption: columnOption,
    scope: tablePath,
  }),
  'coda.rows': { credential, integrationBlockTypes, destination: 'fixed', execute: executeRows },
  'coda.formulas': docScopedAttachment({
    collection: 'formulas',
    idParam: 'formulaId',
    schema: namedItemSchema,
    toOption: namedOption,
  }),
  'coda.controls': docScopedAttachment({
    collection: 'controls',
    idParam: 'controlId',
    schema: namedItemSchema,
    toOption: namedOption,
  }),
  'coda.folders': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: async (args) =>
      args.request.kind === 'detail'
        ? getDetail(
            args,
            `/folders/${segment(args.request.id, 'folderId')}`,
            namedItemSchema,
            namedOption
          )
        : listAllPages(args, '/folders', namedItemSchema, namedOption),
  },
  'coda.permissions': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    execute: executePermissions,
  },
} satisfies ServerSelectorAttachmentMap<CodaSelectorKey>
