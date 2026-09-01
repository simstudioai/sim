import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { validatePathSegment, validateWorkdayTenantUrl } from '@/lib/core/security/input-validation'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  htmlToPlainText,
  joinTagArray,
  looksLikeHtml,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'
import { workdayConnectorMeta } from '@/connectors/workday/meta'

const logger = createLogger('WorkdayConnector')

/**
 * Maximum `limit` the `helpArticle` v1 service accepts on `GET /articleVersions`
 * and `GET /articleStatuses`; both document a default of 20 and a maximum of 100.
 */
const PAGE_SIZE = 100

/** `GET /values/common/audiences/` documents a default *and* maximum of 1000. */
const VALUES_PAGE_SIZE = 1000

/**
 * Hard stop on the value-lookup pagination that turns audience and status names
 * into Workday IDs, so a tenant with an unexpectedly large prompt-value list
 * cannot pull an unbounded number of rows into memory.
 */
const MAX_VALUE_LOOKUP_ROWS = 5000

/** How many available values an unresolved-name error is allowed to name. */
const MAX_ERROR_DESCRIPTORS = 20

/**
 * Workday resolves REST services as `/ccx/api/{service}/{version}/{tenant}/...`,
 * where `{service}/{version}` is the `basePath` the service's OpenAPI document
 * declares — `/helpArticle/v1` here.
 */
const API_BASE_PATH = '/ccx/api/helpArticle/v1'

/** Sentinel status choice meaning "do not filter by status at all". */
const ALL_STATUSES = 'all'

/**
 * A Workday instance identifier as `INSTANCE_MODEL_REFERENCE` declares it: a
 * 32-character lowercase Workday ID, or a `Type=Value` reference ID. Config
 * values matching it are passed to the API untouched instead of being looked up
 * as display names.
 */
const WORKDAY_INSTANCE_ID = /^(?:[0-9a-f]{32}|\S+=\S+)$/

/** Refresh a bearer token this far before it actually expires. */
const TOKEN_EXPIRY_SKEW_MS = 60_000

/** Workday documents its access tokens as valid for 3600 seconds. */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600

/**
 * A Workday instance reference (`INSTANCE_MODEL_REFERENCE`): a Workday ID or
 * reference ID, plus the display name Workday renders for it.
 */
interface WorkdayInstance {
  id?: string
  descriptor?: string
  href?: string
}

/** The `{ total, data }` envelope every collection in this service returns. */
interface WorkdayCollection<T> {
  total?: number
  data?: T[]
}

/**
 * One article version from `GET /articleVersions` and `GET /articleVersions/{ID}`,
 * which share the `articleVersionDetails` schema. Every field is optional because
 * the schema marks none of them required and Workday omits what the caller is not
 * permitted to see.
 */
interface WorkdayArticleVersion {
  id?: string
  title?: string
  content?: string
  version?: number
  createdDate?: string
  lastUpdatedDate?: string
  viewLink?: string
  latestPublishedVersionViewURL?: string
  status?: WorkdayInstance
  category?: WorkdayInstance
  language?: WorkdayInstance
  location?: WorkdayInstance
  parentArticle?: WorkdayInstance
  tags?: WorkdayInstance[]
  audience?: WorkdayInstance[]
}

/**
 * Workday's error body: a message in `error`, plus per-field detail in `errors`
 * for validation failures.
 */
interface WorkdayErrorBody {
  error?: string
  errors?: { error?: string; field?: string }[]
}

/** A bearer token cached for the remainder of a sync run, with its expiry. */
interface WorkdayBearerToken {
  value: string
  expiresAt: number
}

/**
 * Tenant coordinates resolved from `sourceConfig`, with the host already checked
 * against the Workday domain allowlist and reduced to a bare origin.
 */
interface WorkdayTenant {
  origin: string
  tenant: string
  clientId: string
}

/** The status and audience filters, resolved from display names to Workday IDs. */
interface WorkdayFilters {
  status: string[]
  audience: string[]
}

/**
 * Reduces the configured tenant host to an origin the API paths can be appended
 * to. `validateWorkdayTenantUrl` only reports whether a URL is well-formed and
 * on a Workday domain — it returns the string as written — so a value carrying a
 * path, a query, or a trailing slash would otherwise be spliced into every
 * request URL. A scheme-less host is accepted and assumed HTTPS, which is the
 * only scheme the service's OpenAPI document declares.
 */
function normalizeTenantOrigin(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  const candidate = trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed
  const validation = validateWorkdayTenantUrl(candidate || undefined)
  if (!validation.isValid) {
    throw new Error(validation.error ?? 'Invalid Workday tenant host')
  }
  return new URL(validation.sanitized ?? candidate).origin
}

function resolveTenant(sourceConfig: Record<string, unknown>): WorkdayTenant {
  const origin = normalizeTenantOrigin(sourceConfig.tenantUrl)

  const tenant = (sourceConfig.tenant as string | undefined)?.trim()
  const tenantValidation = validatePathSegment(tenant, { paramName: 'tenant', maxLength: 128 })
  if (!tenantValidation.isValid) {
    throw new Error(tenantValidation.error ?? 'Invalid Workday tenant')
  }

  const clientId = (sourceConfig.clientId as string | undefined)?.trim()
  if (!clientId) {
    throw new Error('Client ID is required')
  }

  return { origin, tenant: tenant as string, clientId }
}

/**
 * Splits the stored key into the client secret and refresh token. Both are
 * secrets, so they share the connector's single encrypted field rather than one
 * of them sitting in plaintext `sourceConfig`. Only the first colon separates
 * them — a secret may legitimately contain further colons.
 */
function splitCredentials(accessToken: string): { clientSecret: string; refreshToken: string } {
  const separator = accessToken.indexOf(':')
  if (separator <= 0 || separator === accessToken.length - 1) {
    throw new Error('Credential must be in the form clientSecret:refreshToken')
  }
  return {
    clientSecret: accessToken.slice(0, separator),
    refreshToken: accessToken.slice(separator + 1),
  }
}

/**
 * Exchanges the refresh token for a bearer access token at the tenant's token
 * endpoint (`POST /ccx/oauth2/{tenant}/token`), authenticating the API client
 * with HTTP Basic. Workday access tokens live an hour, so the result is cached
 * on `syncContext` with its expiry and reused across the pages of a sync run.
 */
async function getBearerToken(
  accessToken: string,
  wd: WorkdayTenant,
  syncContext?: Record<string, unknown>,
  retryOptions?: RetryOptions,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh) {
    const cached = syncContext?.workdayBearerToken as WorkdayBearerToken | undefined
    if (cached?.value && cached.expiresAt > Date.now()) return cached.value
  }

  const { clientSecret, refreshToken } = splitCredentials(accessToken)
  const basic = Buffer.from(`${wd.clientId}:${clientSecret}`, 'utf8').toString('base64')

  const response = await fetchWithRetry(
    `${wd.origin}/ccx/oauth2/${encodeURIComponent(wd.tenant)}/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    },
    retryOptions
  )

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    /**
     * A refresh token is the one credential this connector cannot repair on its
     * own: it lives in the encrypted key the user typed, and a sync has nowhere
     * to write a replacement. Say so, rather than reporting a bare 400 that
     * looks like a transient outage.
     */
    if (response.status === 400 || response.status === 401) {
      throw new Error(
        `Workday rejected the stored refresh token (HTTP ${response.status}). Sim cannot replace a refresh token that the tenant rotated, expired, or revoked — reissue one with the "Manage Refresh Tokens for Integrations" task and re-enter the credential as clientSecret:refreshToken.${detail ? ` Workday said: ${detail}` : ''}`
      )
    }
    throw new Error(
      `Workday token exchange failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`
    )
  }

  const body = (await response.json()) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
  }
  if (!body.access_token) {
    throw new Error('Workday token response did not include an access token')
  }

  /**
   * A tenant configured to rotate refresh tokens invalidates the stored one the
   * first time it is redeemed, so the next sync fails no matter what this run
   * does. Nothing here can persist the replacement, so record the cause up front
   * — the failure it produces an hour later reads as an unexplained 400.
   */
  if (body.refresh_token && body.refresh_token !== refreshToken) {
    logger.warn(
      'Workday returned a rotated refresh token that Sim cannot persist; register the API client with a non-expiring refresh token or this connector will stop syncing',
      { tenant: wd.tenant }
    )
  }

  const lifetimeSeconds =
    typeof body.expires_in === 'number' && body.expires_in > 0
      ? body.expires_in
      : DEFAULT_TOKEN_LIFETIME_SECONDS

  if (syncContext) {
    syncContext.workdayBearerToken = {
      value: body.access_token,
      expiresAt: Date.now() + lifetimeSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS,
    } satisfies WorkdayBearerToken
  }
  return body.access_token
}

/**
 * Issues an authenticated GET, retrying once with a fresh bearer token on a 401.
 * A sync run can outlive the hour-long token, and a cached token that expires
 * between pages would otherwise fail the run rather than the request.
 */
async function workdayGet(
  url: string,
  accessToken: string,
  wd: WorkdayTenant,
  syncContext?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<Response> {
  const send = async (bearer: string) =>
    fetchWithRetry(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } },
      retryOptions
    )

  const response = await send(await getBearerToken(accessToken, wd, syncContext, retryOptions))
  if (response.status !== 401) return response

  return send(await getBearerToken(accessToken, wd, syncContext, retryOptions, true))
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  if (!text) return `HTTP ${response.status}`
  try {
    const body = JSON.parse(text) as WorkdayErrorBody
    if (body.error) {
      const details = (body.errors ?? [])
        .map((entry) => (entry.field ? `${entry.field}: ${entry.error}` : entry.error))
        .filter((detail): detail is string => Boolean(detail))
      return details.length > 0 ? `${body.error} (${details.join('; ')})` : body.error
    }
  } catch {
    /* Workday returns HTML for some gateway failures; fall through to the raw body. */
  }
  return text.slice(0, 300)
}

function tenantResourceUrl(wd: WorkdayTenant, resource: string, query?: URLSearchParams): string {
  const suffix = query ? `?${query.toString()}` : ''
  return `${wd.origin}${API_BASE_PATH}/${encodeURIComponent(wd.tenant)}${resource}${suffix}`
}

/**
 * Reads a whole prompt-value collection so display names can be resolved to
 * Workday IDs. Both `/articleStatuses` and `/values/common/audiences/` use the
 * service's `limit`/`offset` paging and `{ total, data }` envelope.
 */
async function fetchInstances(
  resource: string,
  pageSize: number,
  accessToken: string,
  wd: WorkdayTenant,
  syncContext?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<WorkdayInstance[]> {
  const instances: WorkdayInstance[] = []

  for (let offset = 0; offset < MAX_VALUE_LOOKUP_ROWS; offset += pageSize) {
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
    const response = await workdayGet(
      tenantResourceUrl(wd, resource, query),
      accessToken,
      wd,
      syncContext,
      retryOptions
    )
    if (!response.ok) {
      throw new Error(`Workday ${resource} lookup failed: ${await readErrorMessage(response)}`)
    }

    const body = (await response.json()) as WorkdayCollection<WorkdayInstance>
    const page = body.data ?? []
    instances.push(...page)

    if (page.length < pageSize) break
    if (typeof body.total === 'number' && instances.length >= body.total) break
  }

  if (instances.length >= MAX_VALUE_LOOKUP_ROWS) {
    logger.warn('Workday value lookup hit its row cap; names beyond it cannot be resolved', {
      resource,
      rows: instances.length,
    })
  }

  return instances
}

/**
 * Names the values the lookup did return, capped. An audience list runs to as
 * many rows as {@link MAX_VALUE_LOOKUP_ROWS} allows, and the whole list would
 * otherwise be interpolated into an error string the knowledge base UI renders.
 */
function availableSuffix(descriptors: string[]): string {
  if (descriptors.length === 0) return ''
  const shown = descriptors.slice(0, MAX_ERROR_DESCRIPTORS)
  const omitted = descriptors.length - shown.length
  return `. Available: ${shown.join(', ')}${omitted > 0 ? `, and ${omitted} more` : ''}`
}

/**
 * Turns configured display names into the Workday IDs the `status` and
 * `audience` query parameters take. A value already shaped like a Workday ID or
 * a `Type=Value` reference ID is passed through, so an operator who has the ID
 * to hand never has to match a descriptor exactly.
 */
async function resolveInstanceIds(
  values: string[],
  loadInstances: () => Promise<WorkdayInstance[]>,
  label: string
): Promise<string[]> {
  /**
   * Every value already being an ID is the common case for an operator who
   * pasted Workday IDs, and the lookup it would otherwise run reads the tenant's
   * whole prompt-value collection.
   */
  if (values.every((value) => WORKDAY_INSTANCE_ID.test(value))) return values

  const instances = await loadInstances()
  const idByDescriptor = new Map<string, string>()
  const descriptors: string[] = []
  for (const instance of instances) {
    const descriptor = instance.descriptor?.trim()
    if (!descriptor || !instance.id) continue
    const key = descriptor.toLowerCase()
    if (idByDescriptor.has(key)) continue
    idByDescriptor.set(key, instance.id)
    descriptors.push(descriptor)
  }

  return values.map((value) => {
    if (WORKDAY_INSTANCE_ID.test(value)) return value
    const resolved = idByDescriptor.get(value.toLowerCase())
    if (resolved) return resolved
    throw new Error(
      `Your Workday tenant has no ${label} named "${value}"${availableSuffix(descriptors)}`
    )
  })
}

/**
 * Resolves the configured status and audience filters once per sync run and
 * caches them on `syncContext`, so later pages reuse the lookup.
 *
 * Status is required and has no default: `/articleVersions` returns one row per
 * article *revision*, and the service offers no latest-version filter, so the
 * scope of a sync has to be a decision the operator made rather than one this
 * code made silently.
 */
async function resolveFilters(
  accessToken: string,
  wd: WorkdayTenant,
  sourceConfig: Record<string, unknown>,
  syncContext?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<WorkdayFilters> {
  const cached = syncContext?.workdayFilters as WorkdayFilters | undefined
  if (cached) return cached

  const statusChoice = typeof sourceConfig.status === 'string' ? sourceConfig.status.trim() : ''
  if (!statusChoice) {
    throw new Error(
      'Article Status is required: choose which article versions to sync, or "Every status" to index every historical revision.'
    )
  }

  const status =
    statusChoice === ALL_STATUSES
      ? []
      : await resolveInstanceIds(
          [statusChoice],
          () =>
            fetchInstances(
              '/articleStatuses',
              PAGE_SIZE,
              accessToken,
              wd,
              syncContext,
              retryOptions
            ),
          'article status'
        )

  const audienceNames = parseMultiValue(sourceConfig.audience)
  const audience =
    audienceNames.length === 0
      ? []
      : await resolveInstanceIds(
          audienceNames,
          () =>
            fetchInstances(
              '/values/common/audiences/',
              VALUES_PAGE_SIZE,
              accessToken,
              wd,
              syncContext,
              retryOptions
            ),
          'audience'
        )

  const filters: WorkdayFilters = { status, audience }
  if (syncContext) syncContext.workdayFilters = filters
  return filters
}

function descriptorsOf(instances: WorkdayInstance[] | undefined): string[] {
  return (instances ?? [])
    .map((instance) => instance.descriptor)
    .filter((descriptor): descriptor is string => Boolean(descriptor))
}

/**
 * Builds the indexable document for one article version.
 *
 * `contentHash` is derived only from fields the list response already carries —
 * the version number Workday increments on edit, and `lastUpdatedDate` — and
 * `GET /articleVersions/{ID}` returns the same `articleVersionDetails` schema, so
 * the hash is identical by construction whichever call produced the row.
 */
function articleToDocument(article: WorkdayArticleVersion): ExternalDocument | null {
  const externalId = article.id
  if (!externalId) return null

  /**
   * The service documents `content` as the article body "displayed in plain
   * text", so it is indexed as written. `looksLikeHtml` is the shared markup
   * test rather than an unconditional strip: a tenant that emits real markup has
   * it reduced, while plain text that merely contains angle brackets — an email
   * address, a bare autolink — survives untouched.
   */
  const rawContent = article.content ?? ''
  const content = looksLikeHtml(rawContent) ? htmlToPlainText(rawContent) : rawContent

  /**
   * `viewLink` addresses this version and is populated only once the article is
   * published; `latestPublishedVersionViewURL` points at the article's newest
   * published version, which is the closest link a draft or archived revision has.
   */
  const sourceUrl = article.viewLink || article.latestPublishedVersionViewURL || undefined

  return {
    externalId,
    title: article.title || 'Untitled article',
    content,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash: `workday:${externalId}:${article.version ?? ''}:${article.lastUpdatedDate ?? ''}`,
    metadata: {
      article: article.parentArticle?.descriptor,
      category: article.category?.descriptor,
      status: article.status?.descriptor,
      language: article.language?.descriptor,
      audience: descriptorsOf(article.audience),
      articleTags: descriptorsOf(article.tags),
      version: article.version,
      created: article.createdDate,
      lastUpdated: article.lastUpdatedDate,
    },
  }
}

function buildListUrl(
  wd: WorkdayTenant,
  filters: WorkdayFilters,
  offset: number,
  limit: number
): string {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  for (const status of filters.status) query.append('status', status)
  for (const audience of filters.audience) query.append('audience', audience)
  return tenantResourceUrl(wd, '/articleVersions', query)
}

/**
 * Reads the optional version cap: `0` when none was configured, the floored
 * count when one was, and `-1` when a value was supplied that is not a positive
 * number, which {@link workdayConnector.validateConfig} rejects.
 *
 * The field is a short-input so the value normally arrives as a string, but a
 * `sourceConfig` persisted with a JSON number must not crash the sync — reading
 * it as a string and calling `.trim()` on it would.
 */
function parseMaxVersions(value: unknown): number {
  const raw = typeof value === 'string' ? value.trim() : value
  if (raw === '' || raw === null || raw === undefined) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : -1
}

export const workdayConnector: ConnectorConfig = {
  ...workdayConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const wd = resolveTenant(sourceConfig)
    const filters = await resolveFilters(accessToken, wd, sourceConfig, syncContext)

    const offset = cursor ? Number(cursor) : 0
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error(`Invalid pagination cursor: ${cursor}`)
    }

    const maxVersions = Math.max(parseMaxVersions(sourceConfig.maxVersions), 0)
    const alreadyFetched = offset
    const remaining = maxVersions > 0 ? maxVersions - alreadyFetched : PAGE_SIZE
    const limit = Math.min(PAGE_SIZE, Math.max(remaining, 0))

    if (limit === 0) {
      if (syncContext) syncContext.listingCapped = true
      return { documents: [], hasMore: false }
    }

    const response = await workdayGet(
      buildListUrl(wd, filters, offset, limit),
      accessToken,
      wd,
      syncContext
    )

    if (!response.ok) {
      throw new Error(`Workday article listing failed: ${await readErrorMessage(response)}`)
    }

    const body = (await response.json()) as WorkdayCollection<WorkdayArticleVersion>
    const page = body.data ?? []

    const documents: ExternalDocument[] = []
    for (const article of page) {
      const document = articleToDocument(article)
      if (document) documents.push(document)
    }

    const fetched = alreadyFetched + page.length
    const total = typeof body.total === 'number' ? body.total : undefined
    const sourceExhausted = page.length < limit || (total !== undefined && fetched >= total)
    const hitCap = maxVersions > 0 && fetched >= maxVersions

    /**
     * The sync engine hard-deletes any stored document the listing did not return,
     * so a listing the cap truncated while Workday still has more article versions
     * must say so. Reaching the cap exactly at source exhaustion is a complete
     * listing and must still reconcile deletions.
     */
    if (syncContext && hitCap && !sourceExhausted) {
      syncContext.listingCapped = true
    }

    const hasMore = !sourceExhausted && !hitCap

    logger.info('Listed Workday article versions', {
      tenant: wd.tenant,
      offset,
      returned: page.length,
      /** Rows Workday returned without an `id`, which cannot be addressed or indexed. */
      unidentified: page.length - documents.length,
      total,
      hasMore,
    })

    return {
      documents,
      nextCursor: hasMore ? String(fetched) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const wd = resolveTenant(sourceConfig)

    const response = await workdayGet(
      tenantResourceUrl(wd, `/articleVersions/${encodeURIComponent(externalId)}`),
      accessToken,
      wd,
      syncContext
    )

    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Workday article fetch failed: ${await readErrorMessage(response)}`)
    }

    const article = (await response.json()) as WorkdayArticleVersion
    return articleToDocument(article)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    if (parseMaxVersions(sourceConfig.maxVersions) < 0) {
      return { valid: false, error: 'Max article versions must be a positive number' }
    }

    const statusChoice = typeof sourceConfig.status === 'string' ? sourceConfig.status.trim() : ''

    try {
      const wd = resolveTenant(sourceConfig)

      /** Scratch context so validation buys one bearer token, not one per call. */
      const validationContext: Record<string, unknown> = {}

      /**
       * Resolving the filters exercises the token exchange and the status and
       * audience lookups, so a mistyped audience name or a credential without the
       * Help Article REST API domain fails here rather than mid-sync.
       */
      const filters = await resolveFilters(
        accessToken,
        wd,
        sourceConfig,
        validationContext,
        VALIDATE_RETRY_OPTIONS
      )

      const response = await workdayGet(
        buildListUrl(wd, filters, 0, 1),
        accessToken,
        wd,
        validationContext,
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        return {
          valid: false,
          error: `Workday returned ${response.status}: ${await readErrorMessage(response)}`,
        }
      }

      /**
       * The `helpArticle` OpenAPI document declares `status` as an untyped
       * `array` of `string` with no enum, no `$ref` and — unlike the sibling
       * `audience` parameter, whose model carries
       * `x-workday-populated-by: /values/common/audiences` — no declared value
       * source. Whether it binds to an `/articleStatuses` Workday ID cannot be
       * settled from the published spec, so the one request validation already
       * makes is read back: a tenant that ignored the filter answers with a
       * version in some other status, and the connector says so at configuration
       * time instead of silently indexing the wrong scope on every sync.
       */
      const sample = ((await response.json()) as WorkdayCollection<WorkdayArticleVersion>).data?.[0]
      const returnedStatus = sample?.status?.descriptor
      if (
        statusChoice !== ALL_STATUSES &&
        returnedStatus &&
        returnedStatus.toLowerCase() !== statusChoice.toLowerCase()
      ) {
        return {
          valid: false,
          error: `Workday ignored the article status filter: the first article version it returned is "${returnedStatus}", not "${statusChoice}". Choose "Every status" to sync every revision, or ask your Workday administrator whether the Help Article REST API accepts a status filter in this tenant.`,
        }
      }

      return { valid: true }
    } catch (error) {
      logger.warn('Workday connector validation failed', { error: getErrorMessage(error) })
      return { valid: false, error: getErrorMessage(error, 'Failed to reach Workday') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    for (const key of ['article', 'category', 'status', 'language'] as const) {
      const value = metadata[key]
      if (typeof value === 'string' && value) result[key] = value
    }

    for (const key of ['audience', 'articleTags'] as const) {
      const value = joinTagArray(metadata[key])
      if (value) result[key] = value
    }

    if (metadata.version != null) {
      const version = Number(metadata.version)
      if (!Number.isNaN(version)) result.version = version
    }

    for (const key of ['created', 'lastUpdated'] as const) {
      const value = parseTagDate(metadata[key])
      if (value) result[key] = value
    }

    return result
  },
}
