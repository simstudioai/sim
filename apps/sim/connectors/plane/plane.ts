import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { type RetryOptions, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { planeConnectorMeta } from '@/connectors/plane/meta'
import {
  type PlaneContentConfig,
  parsePlanePage,
  planePageDocument,
  planeWorkItemDocument,
} from '@/connectors/plane/utils'
import type { ConnectorConfig, ExternalDocument } from '@/connectors/types'
import { joinTagArray, listingRequestError, parseTagDate } from '@/connectors/utils'
import { planeApiUrl, planeHeaders, planeRedirectPolicy } from '@/tools/plane/utils'
import { safeUrlPathSegment } from '@/tools/url-path'

const logger = createLogger('PlaneConnector')
const PAGE_SIZE = 100
const WORK_ITEM_FIELDS =
  'id,name,sequence_id,description_html,description_stripped,priority,state,assignees,labels,updated_at'
const PAGE_FIELDS = 'id,name,updated_at'

interface PlaneSourceConfig extends PlaneContentConfig {
  baseUrl?: string
  contentType: 'work_items' | 'pages'
  maxDocuments: number
}

function readConfig(source: Record<string, unknown>): PlaneSourceConfig {
  const workspaceSlug = typeof source.workspaceSlug === 'string' ? source.workspaceSlug.trim() : ''
  const projectId = typeof source.projectId === 'string' ? source.projectId.trim() : ''
  if (!workspaceSlug || !projectId) throw new Error('Workspace slug and project ID are required')
  safeUrlPathSegment(workspaceSlug, 'workspaceSlug')
  safeUrlPathSegment(projectId, 'projectId')
  const contentType = source.contentType || 'work_items'
  if (contentType !== 'work_items' && contentType !== 'pages')
    throw new Error('Content must be work items or project pages')
  const maxInput = source.maxDocuments
  if (
    maxInput !== undefined &&
    maxInput !== null &&
    typeof maxInput !== 'string' &&
    typeof maxInput !== 'number'
  )
    throw new Error('Max documents must be a positive integer')
  const maxDocuments =
    maxInput === undefined || maxInput === null || maxInput === '' ? 0 : Number(maxInput)
  if (
    !Number.isSafeInteger(maxDocuments) ||
    maxDocuments < 0 ||
    (maxDocuments === 0 && maxInput !== undefined && maxInput !== null && maxInput !== '')
  )
    throw new Error('Max documents must be a positive integer')
  const baseUrl =
    typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim() : undefined
  const apiOrigin = new URL(planeApiUrl(baseUrl, '/'))
  const defaultWebUrl =
    apiOrigin.origin === 'https://api.plane.so'
      ? 'https://app.plane.so'
      : `${apiOrigin.origin}${apiOrigin.pathname.replace(/\/+$/, '')}`
  const webUrl =
    typeof source.webUrl === 'string' && source.webUrl.trim() ? source.webUrl.trim() : defaultWebUrl
  const normalizedWeb = new URL(planeApiUrl(webUrl, '/'))
  return {
    workspaceSlug,
    projectId,
    contentType,
    maxDocuments,
    baseUrl,
    webUrl: `${normalizedWeb.origin}${normalizedWeb.pathname.replace(/\/+$/, '')}`,
  }
}

function resourcePath(config: PlaneSourceConfig, id?: string): string {
  const resource = config.contentType === 'pages' ? 'pages' : 'work-items'
  return `/api/v1/workspaces/${safeUrlPathSegment(config.workspaceSlug, 'workspaceSlug')}/projects/${safeUrlPathSegment(config.projectId, 'projectId')}/${resource}/${id ? `${safeUrlPathSegment(id, 'externalId')}/` : ''}`
}

async function requestPlane(
  token: string,
  config: PlaneSourceConfig,
  path: string,
  query: Record<string, unknown> = {},
  retryOptions?: RetryOptions
) {
  return secureFetchWithRetry(
    planeApiUrl(config.baseUrl, path, query),
    {
      method: 'GET',
      headers: planeHeaders(token),
      profile: 'configuredEndpoint',
      redirectPolicy: planeRedirectPolicy(),
      maxResponseBytes: 8 * 1024 * 1024,
    },
    retryOptions
  )
}

export const planeConnector: ConnectorConfig = {
  ...planeConnectorMeta,

  async listDocuments(token, sourceConfig, cursor, syncContext) {
    const config = readConfig(sourceConfig)
    const fetched =
      typeof syncContext?.totalDocsFetched === 'number' ? syncContext.totalDocsFetched : 0
    const remaining =
      config.maxDocuments > 0 ? Math.max(0, config.maxDocuments - fetched) : PAGE_SIZE
    if (remaining === 0) {
      if (syncContext) syncContext.listingCapped = true
      return { documents: [], hasMore: false, reconciliationSafe: false }
    }
    const response = await requestPlane(token, config, resourcePath(config), {
      cursor,
      per_page: PAGE_SIZE,
      fields: config.contentType === 'pages' ? PAGE_FIELDS : WORK_ITEM_FIELDS,
      ...(config.contentType === 'work_items'
        ? { expand: 'state,assignees,labels', order_by: 'created_at' }
        : {}),
    })
    if (!response.ok) throw listingRequestError('Plane listing failed', response.status)
    const page = parsePlanePage(await response.json(), cursor)
    const documents = await Promise.all(
      page.results
        .slice(0, remaining)
        .map((item) =>
          config.contentType === 'pages'
            ? planePageDocument(item, config, true)
            : planeWorkItemDocument(item, config)
        )
    )
    const total = fetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = total
    const capped =
      config.maxDocuments > 0 && total >= config.maxDocuments && page.nextCursor !== undefined
    if (capped && syncContext) syncContext.listingCapped = true
    logger.info('Listed Plane documents', {
      count: documents.length,
      hasMore: page.nextCursor !== undefined && !capped,
      capped,
    })
    return {
      documents,
      nextCursor: capped ? undefined : page.nextCursor,
      hasMore: page.nextCursor !== undefined && !capped,
      // Plane v1 cursors encode offsets, so concurrent source changes can shift records between pages.
      reconciliationSafe: false,
    }
  },

  async getDocument(token, sourceConfig, externalId): Promise<ExternalDocument | null> {
    const config = readConfig(sourceConfig)
    const prefix = config.contentType === 'pages' ? 'page:' : 'work_item:'
    if (!externalId.startsWith(prefix) || externalId.length === prefix.length) return null
    const response = await requestPlane(
      token,
      config,
      resourcePath(config, externalId.slice(prefix.length)),
      {
        fields:
          config.contentType === 'pages'
            ? 'id,name,updated_at,description_html,description_stripped,description'
            : WORK_ITEM_FIELDS,
        ...(config.contentType === 'work_items' ? { expand: 'state,assignees,labels' } : {}),
      }
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Plane document read failed (HTTP ${response.status})`)
    const payload: unknown = await response.json()
    return config.contentType === 'pages'
      ? planePageDocument(payload, config, false)
      : planeWorkItemDocument(payload, config)
  },

  async validateConfig(token, sourceConfig) {
    try {
      const config = readConfig(sourceConfig)
      const response = await requestPlane(
        token,
        config,
        resourcePath(config),
        {
          per_page: 1,
          fields: config.contentType === 'pages' ? PAGE_FIELDS : 'id,name',
        },
        VALIDATE_RETRY_OPTIONS
      )
      if (!response.ok)
        return {
          valid: false,
          error: `Plane access failed (HTTP ${response.status}). Check the token, workspace, project and edition.`,
        }
      parsePlanePage(await response.json())
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Failed to validate Plane configuration'),
      }
    }
  },

  mapTags(metadata) {
    return {
      projectId: metadata.projectId,
      state: metadata.state,
      priority: metadata.priority,
      assignees: joinTagArray(metadata.assignees),
      labels: joinTagArray(metadata.labels),
      lastModified: parseTagDate(metadata.lastModified),
    }
  },
}
