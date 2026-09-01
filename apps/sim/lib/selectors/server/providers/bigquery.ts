import { z } from 'zod'
import { getScopesForService } from '@/lib/oauth/utils'
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
} from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type BigQuerySelectorKey = Extract<ServerSelectorKey, 'bigquery.datasets' | 'bigquery.tables'>

const BIGQUERY_PAGE_SIZE = 200
const BIGQUERY_CURSOR_MAX_LENGTH = 4_096
const BIGQUERY_SCOPES = getScopesForService('google-bigquery')
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const DATASET_ID_PATTERN = /^[A-Za-z0-9_]{1,1024}$/
const TABLE_ID_PATTERN = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\p{Zs}]+$/u

const projectIdSchema = z.string().regex(PROJECT_ID_PATTERN)
const datasetIdSchema = z.string().regex(DATASET_ID_PATTERN)
const tableIdSchema = z.string().superRefine((value, context) => {
  if (
    !value ||
    new TextEncoder().encode(value).byteLength > 1_024 ||
    !TABLE_ID_PATTERN.test(value)
  ) {
    context.addIssue({ code: 'custom', message: 'Invalid BigQuery table ID' })
  }
})

const bigQueryDatasetSchema = z.object({
  datasetReference: z.object({
    datasetId: datasetIdSchema,
    projectId: projectIdSchema,
  }),
  friendlyName: z.string().optional(),
})

const bigQueryTableSchema = z.object({
  tableReference: z.object({
    datasetId: datasetIdSchema,
    projectId: projectIdSchema,
    tableId: tableIdSchema,
  }),
  friendlyName: z.string().optional(),
})

const datasetsPageSchema = z.object({
  datasets: z.array(bigQueryDatasetSchema).max(BIGQUERY_PAGE_SIZE).optional(),
  nextPageToken: z.string().min(1).max(4_096).optional(),
})

const tablesPageSchema = z.object({
  tables: z.array(bigQueryTableSchema).max(BIGQUERY_PAGE_SIZE).optional(),
  nextPageToken: z.string().min(1).max(4_096).optional(),
})

function requireCredential(args: ExecuteServerSelectorArgs) {
  if (!args.credential) throw new SelectorConnectionUnavailableError()
  return args.credential
}

function requireProjectId(value: string | undefined): string {
  const parsed = projectIdSchema.safeParse(value?.trim())
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

function requireDatasetId(value: string | undefined): string {
  const parsed = datasetIdSchema.safeParse(value?.trim())
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

function requireTableId(value: string): string {
  const parsed = tableIdSchema.safeParse(value)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  return parsed.data
}

function requireCursor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (!value.trim() || value.length > BIGQUERY_CURSOR_MAX_LENGTH) {
    throw new SelectorContextUnavailableError()
  }
  return value
}

async function getAccessToken(args: ExecuteServerSelectorArgs): Promise<string> {
  return resolveSelectorOAuthAccessToken({
    credential: requireCredential(args),
    serviceId: 'google-bigquery',
    scopes: BIGQUERY_SCOPES,
    impersonateEmail: args.context.impersonateUserEmail,
    protectedValues: args.protectedValues,
  })
}

function requestHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
}

async function listDatasets(args: ExecuteServerSelectorArgs) {
  const request = requireListRequest(args.selectorKey, args.request)
  const projectId = requireProjectId(args.context.projectId)
  const cursor = requireCursor(request.cursor)
  const accessToken = await getAccessToken(args)
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets`
  )
  url.searchParams.set('maxResults', String(BIGQUERY_PAGE_SIZE))
  if (cursor) url.searchParams.set('pageToken', cursor)

  const body = await fetchProviderJson<unknown>(url, {
    headers: requestHeaders(accessToken),
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = datasetsPageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  if (parsed.data.datasets?.some((dataset) => dataset.datasetReference.projectId !== projectId)) {
    throw new SelectorOptionsUnavailableError()
  }

  return listSelectorResult(
    (parsed.data.datasets ?? []).map((dataset) => ({
      id: dataset.datasetReference.datasetId,
      label: dataset.friendlyName || dataset.datasetReference.datasetId,
    })),
    parsed.data.nextPageToken
  )
}

async function listTables(args: ExecuteServerSelectorArgs) {
  const request = requireListRequest(args.selectorKey, args.request)
  const projectId = requireProjectId(args.context.projectId)
  const datasetId = requireDatasetId(args.context.datasetId)
  const cursor = requireCursor(request.cursor)
  const accessToken = await getAccessToken(args)
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables`
  )
  url.searchParams.set('maxResults', String(BIGQUERY_PAGE_SIZE))
  if (cursor) url.searchParams.set('pageToken', cursor)

  const body = await fetchProviderJson<unknown>(url, {
    headers: requestHeaders(accessToken),
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = tablesPageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  if (
    parsed.data.tables?.some(
      (table) =>
        table.tableReference.projectId !== projectId || table.tableReference.datasetId !== datasetId
    )
  ) {
    throw new SelectorOptionsUnavailableError()
  }

  return listSelectorResult(
    (parsed.data.tables ?? []).map((table) => ({
      id: table.tableReference.tableId,
      label: table.friendlyName || table.tableReference.tableId,
    })),
    parsed.data.nextPageToken
  )
}

async function getDataset(args: ExecuteServerSelectorArgs) {
  if (args.request.kind !== 'detail') throw new SelectorOptionsUnavailableError()
  const projectId = requireProjectId(args.context.projectId)
  const datasetId = requireDatasetId(args.request.id)
  const accessToken = await getAccessToken(args)
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}`
  )
  url.searchParams.set('datasetView', 'METADATA')

  const result = await fetchProviderJsonWithStatus<unknown>(
    url,
    {
      headers: requestHeaders(accessToken),
      redirect: 'error',
      signal: args.signal,
    },
    { passthroughStatuses: [404] }
  )
  if (!result.ok) return detailSelectorResult(null)

  const parsed = bigQueryDatasetSchema.safeParse(result.data)
  if (
    !parsed.success ||
    parsed.data.datasetReference.projectId !== projectId ||
    parsed.data.datasetReference.datasetId !== datasetId
  ) {
    throw new SelectorOptionsUnavailableError()
  }
  return detailSelectorResult({
    id: datasetId,
    label: parsed.data.friendlyName || datasetId,
  })
}

async function getTable(args: ExecuteServerSelectorArgs) {
  if (args.request.kind !== 'detail') throw new SelectorOptionsUnavailableError()
  const projectId = requireProjectId(args.context.projectId)
  const datasetId = requireDatasetId(args.context.datasetId)
  const tableId = requireTableId(args.request.id)
  const accessToken = await getAccessToken(args)
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}`
  )
  url.searchParams.set('view', 'BASIC')

  const result = await fetchProviderJsonWithStatus<unknown>(
    url,
    {
      headers: requestHeaders(accessToken),
      redirect: 'error',
      signal: args.signal,
    },
    { passthroughStatuses: [404] }
  )
  if (!result.ok) return detailSelectorResult(null)

  const parsed = bigQueryTableSchema.safeParse(result.data)
  if (
    !parsed.success ||
    parsed.data.tableReference.projectId !== projectId ||
    parsed.data.tableReference.datasetId !== datasetId ||
    parsed.data.tableReference.tableId !== tableId
  ) {
    throw new SelectorOptionsUnavailableError()
  }
  return detailSelectorResult({ id: tableId, label: parsed.data.friendlyName || tableId })
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['google-bigquery'],
} as const

export const bigQuerySelectorAttachments = {
  'bigquery.datasets': {
    credential,
    destination: 'fixed',
    async execute(args) {
      if (args.request.kind === 'detail') return getDataset(args)
      return listDatasets(args)
    },
  },
  'bigquery.tables': {
    credential,
    destination: 'fixed',
    async execute(args) {
      if (args.request.kind === 'detail') return getTable(args)
      return listTables(args)
    },
  },
} satisfies ServerSelectorAttachmentMap<BigQuerySelectorKey>
