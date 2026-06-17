import { isRecordLike } from '@sim/utils/object'
import type {
  VantaControl,
  VantaControlDetail,
  VantaCustomField,
  VantaDocument,
  VantaDocumentDetail,
  VantaFramework,
  VantaFrameworkDetail,
  VantaFrameworkRequirement,
  VantaFrameworkRequirementCategory,
  VantaFrameworkRequirementControl,
  VantaMonitoredComputer,
  VantaOwner,
  VantaPageInfo,
  VantaPerson,
  VantaPolicy,
  VantaPolicyDocument,
  VantaRegion,
  VantaRiskScenario,
  VantaTest,
  VantaTestEntity,
  VantaUploadedFile,
  VantaVendor,
  VantaVulnerability,
  VantaVulnerabilityRemediation,
  VantaVulnerableAsset,
  VantaVulnerableAssetScanner,
} from '@/tools/vanta/types'

export const VANTA_API_BASE_URLS: Record<VantaRegion, string> = {
  us: 'https://api.vanta.com',
  gov: 'https://api.vanta-gov.com',
}

/** Read-only scope used by every query and download operation. */
export const VANTA_READ_SCOPE = 'vanta-api.all:read'

/** Read-write scope used by write operations that do not upload files. */
export const VANTA_WRITE_SCOPE = 'vanta-api.all:read vanta-api.all:write'

/**
 * Scope string for document evidence uploads, taken verbatim from Vanta's
 * "Upload a document" guide (the upload scope cannot be requested alone).
 */
export const VANTA_DOCUMENT_UPLOAD_SCOPE =
  'vanta-api.all:read vanta-api.all:write vanta-api.documents:upload'

export function getVantaBaseUrl(region: VantaRegion | undefined): string {
  return VANTA_API_BASE_URLS[region ?? 'us']
}

export const VANTA_QUERY_ROUTE = '/api/tools/vanta/query'

/**
 * Builds the standard transformResponse for Vanta tools, which call internal
 * API routes that return `{ success, output }` JSON or `{ success: false,
 * error }` on failure.
 */
export function createVantaTransformResponse<R extends { success: boolean; output: unknown }>(
  fallbackError: string
) {
  return async (response: Response): Promise<R> => {
    const data = await response.json()
    if (!response.ok || data.success === false) {
      throw new Error(data.error || fallbackError)
    }
    return { success: true, output: data.output } as R
  }
}

type JsonRecord = Record<string, unknown>

/**
 * Coerces an unknown single-resource response body to a record so the
 * normalizers can run on it; non-object bodies normalize to all-null fields.
 */
export function asVantaRecord(value: unknown): JsonRecord {
  return isRecordLike(value) ? value : {}
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function getRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecordLike)
}

/**
 * Extracts a human-readable error message from a Vanta API error body.
 */
export function extractVantaError(data: unknown, fallback: string): string {
  if (!isRecordLike(data)) return fallback

  if (isRecordLike(data.error)) {
    const nested = getString(data.error.message) ?? getString(data.error.code)
    if (nested) return nested
  }

  return (
    getString(data.message) ??
    getString(data.error_description) ??
    getString(data.error) ??
    fallback
  )
}

export interface VantaTokenParams {
  clientId: string
  clientSecret: string
  region?: VantaRegion
  scope: string
}

interface VantaCachedToken {
  token: string
  expiresAt: number
}

/**
 * In-memory token cache. Vanta only keeps one access token active per
 * application — requesting a new token revokes the previous one — so reusing
 * a cached token keeps concurrent tool executions with the same credentials
 * from revoking each other's tokens mid-flight.
 */
const vantaTokenCache = new Map<string, VantaCachedToken>()

/**
 * In-flight token exchanges, keyed like the cache. Concurrent callers that
 * miss the cache join the same exchange instead of issuing competing ones
 * that would revoke each other's tokens.
 */
const vantaTokenExchanges = new Map<string, Promise<string>>()

/** Evict cached tokens well before their one-hour expiry. */
const VANTA_TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000

/**
 * Hard deadline on the token-endpoint exchange. The exchange promise is
 * shared across concurrent callers, so a hung endpoint without this bound
 * would wedge every joiner until the undici socket defaults (~5 min) gave up.
 */
const VANTA_TOKEN_EXCHANGE_TIMEOUT_MS = 15_000

/**
 * Derives the cache key for a credential set. The client secret is included
 * only as a SHA-256 digest so plaintext secrets never persist in the
 * long-lived cache maps.
 */
async function vantaTokenCacheKey(params: VantaTokenParams): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${params.clientId}:${params.clientSecret}`)
  )
  const secretHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return [params.region ?? 'us', params.scope, params.clientId, secretHash].join('|')
}

async function exchangeVantaToken(params: VantaTokenParams, cacheKey: string): Promise<string> {
  const response = await fetch(`${getVantaBaseUrl(params.region)}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      scope: params.scope,
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(VANTA_TOKEN_EXCHANGE_TIMEOUT_MS),
  })

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(extractVantaError(data, 'Failed to authenticate with Vanta'))
  }

  if (!isRecordLike(data) || typeof data.access_token !== 'string') {
    throw new Error('Vanta authentication did not return an access token')
  }

  const expiresInMs = (getNumber(data.expires_in) ?? 0) * 1000
  if (expiresInMs > VANTA_TOKEN_EXPIRY_BUFFER_MS) {
    vantaTokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs - VANTA_TOKEN_EXPIRY_BUFFER_MS,
    })
  }

  return data.access_token
}

/**
 * Returns a bearer token for the Vanta API, exchanging OAuth client
 * credentials and caching the result until shortly before expiry. Concurrent
 * callers share a single in-flight exchange. Pass `forceRefresh` when a
 * cached token has been revoked (e.g., by another process exchanging the
 * same credentials); a force refresh still joins any exchange already in
 * flight, since that exchange yields an equally fresh token.
 */
export async function getVantaAccessToken(
  params: VantaTokenParams,
  options?: { forceRefresh?: boolean }
): Promise<string> {
  const cacheKey = await vantaTokenCacheKey(params)
  if (!options?.forceRefresh) {
    const cached = vantaTokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }
  }

  const inFlight = vantaTokenExchanges.get(cacheKey)
  if (inFlight) {
    return inFlight
  }

  vantaTokenCache.delete(cacheKey)
  const exchange = exchangeVantaToken(params, cacheKey)
  vantaTokenExchanges.set(cacheKey, exchange)
  try {
    return await exchange
  } finally {
    vantaTokenExchanges.delete(cacheKey)
  }
}

/**
 * Performs an authenticated Vanta API request. When the request comes back
 * 401 — typically because another process exchanged the same credentials and
 * revoked the cached token — it retries once with a freshly exchanged token.
 */
export async function fetchVantaWithAuth(
  tokenParams: VantaTokenParams,
  doFetch: (accessToken: string) => Promise<Response>
): Promise<Response> {
  const accessToken = await getVantaAccessToken(tokenParams)
  const response = await doFetch(accessToken)
  if (response.status !== 401) {
    return response
  }

  const freshToken = await getVantaAccessToken(tokenParams, { forceRefresh: true })
  return doFetch(freshToken)
}

/**
 * Builds a Vanta v1 API URL, appending only query parameters that have a
 * value. Array values are appended as repeated parameters.
 */
export function buildVantaUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | string[] | null | undefined>
): string {
  const url = new URL(`${baseUrl}/v1${path}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue
      if (Array.isArray(value)) {
        for (const entry of value) {
          url.searchParams.append(key, entry)
        }
      } else {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

/**
 * Splits a comma-separated filter value into trimmed entries, returning
 * undefined when no usable entries remain.
 */
export function splitVantaCommaList(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.length > 0 ? entries : undefined
}

/**
 * Unwraps the `{ results: { data, pageInfo } }` envelope that every Vanta
 * list endpoint returns.
 */
export function getVantaListResults(data: unknown): {
  data: JsonRecord[]
  pageInfo: VantaPageInfo | null
} {
  if (!isRecordLike(data) || !isRecordLike(data.results)) {
    return { data: [], pageInfo: null }
  }
  return {
    data: getRecordArray(data.results.data),
    pageInfo: normalizeVantaPageInfo(data.results.pageInfo),
  }
}

export function normalizeVantaPageInfo(value: unknown): VantaPageInfo | null {
  if (!isRecordLike(value)) return null
  return {
    startCursor: getString(value.startCursor),
    endCursor: getString(value.endCursor),
    hasNextPage: getBoolean(value.hasNextPage) ?? false,
    hasPreviousPage: getBoolean(value.hasPreviousPage) ?? false,
  }
}

function normalizeVantaOwner(value: unknown): VantaOwner | null {
  if (!isRecordLike(value)) return null
  return {
    id: getString(value.id),
    displayName: getString(value.displayName),
    emailAddress: getString(value.emailAddress),
  }
}

function normalizeVantaCustomFields(value: unknown): VantaCustomField[] {
  return getRecordArray(value).map((field) => ({
    label: getString(field.label),
    value: Array.isArray(field.value) ? getStringArray(field.value) : getString(field.value),
  }))
}

export function normalizeVantaFramework(resource: JsonRecord): VantaFramework {
  return {
    id: getString(resource.id),
    displayName: getString(resource.displayName),
    shorthandName: getString(resource.shorthandName),
    description: getString(resource.description),
    numControlsCompleted: getNumber(resource.numControlsCompleted),
    numControlsTotal: getNumber(resource.numControlsTotal),
    numDocumentsPassing: getNumber(resource.numDocumentsPassing),
    numDocumentsTotal: getNumber(resource.numDocumentsTotal),
    numTestsPassing: getNumber(resource.numTestsPassing),
    numTestsTotal: getNumber(resource.numTestsTotal),
  }
}

function normalizeVantaFrameworkRequirementControl(
  resource: JsonRecord
): VantaFrameworkRequirementControl {
  return {
    id: getString(resource.id),
    externalId: getString(resource.externalId),
    name: getString(resource.name),
    description: getString(resource.description),
  }
}

function normalizeVantaFrameworkRequirement(resource: JsonRecord): VantaFrameworkRequirement {
  return {
    id: getString(resource.id),
    name: getString(resource.name),
    shorthand: getString(resource.shorthand),
    description: getString(resource.description),
    controls: getRecordArray(resource.controls).map(normalizeVantaFrameworkRequirementControl),
  }
}

function normalizeVantaFrameworkRequirementCategory(
  resource: JsonRecord
): VantaFrameworkRequirementCategory {
  return {
    id: getString(resource.id),
    name: getString(resource.name),
    shorthand: getString(resource.shorthand),
    requirements: getRecordArray(resource.requirements).map(normalizeVantaFrameworkRequirement),
  }
}

export function normalizeVantaFrameworkDetail(resource: JsonRecord): VantaFrameworkDetail {
  return {
    ...normalizeVantaFramework(resource),
    requirementCategories: getRecordArray(resource.requirementCategories).map(
      normalizeVantaFrameworkRequirementCategory
    ),
  }
}

export function normalizeVantaControl(resource: JsonRecord): VantaControl {
  return {
    id: getString(resource.id),
    externalId: getString(resource.externalId),
    name: getString(resource.name),
    description: getString(resource.description),
    source: getString(resource.source),
    domains: getStringArray(resource.domains),
    owner: normalizeVantaOwner(resource.owner),
    role: getString(resource.role),
    customFields: normalizeVantaCustomFields(resource.customFields),
    creationDate: getString(resource.creationDate),
    modificationDate: getString(resource.modificationDate),
  }
}

export function normalizeVantaControlDetail(resource: JsonRecord): VantaControlDetail {
  return {
    ...normalizeVantaControl(resource),
    note: getString(resource.note),
    status: getString(resource.status),
    numDocumentsPassing: getNumber(resource.numDocumentsPassing),
    numDocumentsTotal: getNumber(resource.numDocumentsTotal),
    numTestsPassing: getNumber(resource.numTestsPassing),
    numTestsTotal: getNumber(resource.numTestsTotal),
  }
}

export function normalizeVantaTest(resource: JsonRecord): VantaTest {
  const version = isRecordLike(resource.version)
    ? { major: getNumber(resource.version.major), minor: getNumber(resource.version.minor) }
    : null
  const deactivatedStatusInfo = isRecordLike(resource.deactivatedStatusInfo)
    ? {
        isDeactivated: getBoolean(resource.deactivatedStatusInfo.isDeactivated),
        deactivatedReason: getString(resource.deactivatedStatusInfo.deactivatedReason),
        lastUpdatedDate: getString(resource.deactivatedStatusInfo.lastUpdatedDate),
      }
    : null
  const remediationStatusInfo = isRecordLike(resource.remediationStatusInfo)
    ? {
        status: getString(resource.remediationStatusInfo.status),
        soonestRemediateByDate: getString(resource.remediationStatusInfo.soonestRemediateByDate),
        itemCount: getNumber(resource.remediationStatusInfo.itemCount),
      }
    : null

  return {
    id: getString(resource.id),
    name: getString(resource.name),
    description: getString(resource.description),
    failureDescription: getString(resource.failureDescription),
    remediationDescription: getString(resource.remediationDescription),
    category: getString(resource.category),
    status: getString(resource.status),
    integrations: getStringArray(resource.integrations),
    lastTestRunDate: getString(resource.lastTestRunDate),
    latestFlipDate: getString(resource.latestFlipDate),
    version,
    deactivatedStatusInfo,
    remediationStatusInfo,
    owner: normalizeVantaOwner(resource.owner),
  }
}

export function normalizeVantaTestEntity(resource: JsonRecord): VantaTestEntity {
  return {
    id: getString(resource.id),
    entityStatus: getString(resource.entityStatus),
    displayName: getString(resource.displayName),
    responseType: getString(resource.responseType),
    deactivatedReason: getString(resource.deactivatedReason),
    createdDate: getString(resource.createdDate),
    lastUpdatedDate: getString(resource.lastUpdatedDate),
  }
}

export function normalizeVantaDocument(resource: JsonRecord): VantaDocument {
  return {
    id: getString(resource.id),
    title: getString(resource.title),
    description: getString(resource.description),
    category: getString(resource.category),
    ownerId: getString(resource.ownerId),
    isSensitive: getBoolean(resource.isSensitive),
    uploadStatus: getString(resource.uploadStatus),
    uploadStatusDate: getString(resource.uploadStatusDate),
    url: getString(resource.url),
  }
}

export function normalizeVantaDocumentDetail(resource: JsonRecord): VantaDocumentDetail {
  const deactivatedStatus = isRecordLike(resource.deactivatedStatus)
    ? {
        isDeactivated: getBoolean(resource.deactivatedStatus.isDeactivated),
        reason: getString(resource.deactivatedStatus.reason),
        creationDate: getString(resource.deactivatedStatus.creationDate),
        expiration: getString(resource.deactivatedStatus.expiration),
      }
    : null

  return {
    ...normalizeVantaDocument(resource),
    note: getString(resource.note),
    nextRenewalDate: getString(resource.nextRenewalDate),
    renewalCadence: getString(resource.renewalCadence),
    reminderWindow: getString(resource.reminderWindow),
    subscribers: getStringArray(resource.subscribers),
    deactivatedStatus,
  }
}

export function normalizeVantaUploadedFile(resource: JsonRecord): VantaUploadedFile {
  const uploadedBy = isRecordLike(resource.uploadedBy)
    ? { id: getString(resource.uploadedBy.id), type: getString(resource.uploadedBy.type) }
    : null

  return {
    id: getString(resource.id),
    fileName: getString(resource.fileName),
    title: getString(resource.title),
    description: getString(resource.description),
    mimeType: getString(resource.mimeType),
    uploadedBy,
    creationDate: getString(resource.creationDate),
    updatedDate: getString(resource.updatedDate),
    deletionDate: getString(resource.deletionDate),
    effectiveDate: getString(resource.effectiveDate),
    url: getString(resource.url),
  }
}

export function normalizeVantaPerson(resource: JsonRecord): VantaPerson {
  const name = isRecordLike(resource.name)
    ? {
        first: getString(resource.name.first),
        last: getString(resource.name.last),
        display: getString(resource.name.display),
      }
    : null
  const employment = isRecordLike(resource.employment)
    ? {
        status: getString(resource.employment.status),
        startDate: getString(resource.employment.startDate),
        endDate: getString(resource.employment.endDate),
        jobTitle: getString(resource.employment.jobTitle),
      }
    : null
  const leaveInfo = isRecordLike(resource.leaveInfo)
    ? {
        status: getString(resource.leaveInfo.status),
        startDate: getString(resource.leaveInfo.startDate),
        endDate: getString(resource.leaveInfo.endDate),
      }
    : null
  const tasksSummary = isRecordLike(resource.tasksSummary)
    ? {
        status: getString(resource.tasksSummary.status),
        dueDate: getString(resource.tasksSummary.dueDate),
        completionDate: getString(resource.tasksSummary.completionDate),
      }
    : null

  return {
    id: getString(resource.id),
    userId: getString(resource.userId),
    emailAddress: getString(resource.emailAddress),
    name,
    employment,
    leaveInfo,
    groupIds: getStringArray(resource.groupIds),
    tasksSummary,
  }
}

function normalizeVantaPolicyDocument(resource: JsonRecord): VantaPolicyDocument {
  return {
    language: getString(resource.language),
    slugId: getString(resource.slugId),
    url: getString(resource.url),
  }
}

export function normalizeVantaPolicy(resource: JsonRecord): VantaPolicy {
  const latestApprovedVersion = isRecordLike(resource.latestApprovedVersion)
    ? {
        versionId: getString(resource.latestApprovedVersion.versionId),
        documents: getRecordArray(resource.latestApprovedVersion.documents).map(
          normalizeVantaPolicyDocument
        ),
      }
    : null

  return {
    id: getString(resource.id),
    name: getString(resource.name),
    description: getString(resource.description),
    status: getString(resource.status),
    approvedAtDate: getString(resource.approvedAtDate),
    latestVersionStatus: isRecordLike(resource.latestVersion)
      ? getString(resource.latestVersion.status)
      : null,
    latestApprovedVersion,
  }
}

export function normalizeVantaVendor(resource: JsonRecord): VantaVendor {
  const authDetails = isRecordLike(resource.authDetails)
    ? {
        method: getString(resource.authDetails.method),
        passwordMFA: getBoolean(resource.authDetails.passwordMFA),
        passwordMinimumLength: getNumber(resource.authDetails.passwordMinimumLength),
        passwordRequiresNumber: getBoolean(resource.authDetails.passwordRequiresNumber),
        passwordRequiresSymbol: getBoolean(resource.authDetails.passwordRequiresSymbol),
      }
    : null
  const contractAmount = isRecordLike(resource.contractAmount)
    ? {
        amount: getNumber(resource.contractAmount.amount),
        currency: getString(resource.contractAmount.currency),
      }
    : null
  const latestDecision = isRecordLike(resource.latestDecision)
    ? {
        status: getString(resource.latestDecision.status),
        lastUpdatedAt: getString(resource.latestDecision.lastUpdatedAt),
      }
    : null
  const procurementRequest = isRecordLike(resource.linkedTaskTrackerTaskProcurementRequest)
    ? {
        url: getString(resource.linkedTaskTrackerTaskProcurementRequest.url),
        service: getString(resource.linkedTaskTrackerTaskProcurementRequest.service),
      }
    : null

  return {
    id: getString(resource.id),
    name: getString(resource.name),
    status: getString(resource.status),
    websiteUrl: getString(resource.websiteUrl),
    category: isRecordLike(resource.category) ? getString(resource.category.displayName) : null,
    servicesProvided: getString(resource.servicesProvided),
    additionalNotes: getString(resource.additionalNotes),
    accountManagerName: getString(resource.accountManagerName),
    accountManagerEmail: getString(resource.accountManagerEmail),
    securityOwnerUserId: getString(resource.securityOwnerUserId),
    businessOwnerUserId: getString(resource.businessOwnerUserId),
    inherentRiskLevel: getString(resource.inherentRiskLevel),
    residualRiskLevel: getString(resource.residualRiskLevel),
    isRiskAutoScored: getBoolean(resource.isRiskAutoScored),
    isVisibleToAuditors: getBoolean(resource.isVisibleToAuditors),
    riskAttributeIds: getStringArray(resource.riskAttributeIds),
    vendorHeadquarters: getString(resource.vendorHeadquarters),
    contractStartDate: getString(resource.contractStartDate),
    contractRenewalDate: getString(resource.contractRenewalDate),
    contractTerminationDate: getString(resource.contractTerminationDate),
    contractAmount,
    nextSecurityReviewDueDate: getString(resource.nextSecurityReviewDueDate),
    lastSecurityReviewCompletionDate: getString(resource.lastSecurityReviewCompletionDate),
    authDetails,
    customFields: normalizeVantaCustomFields(resource.customFields),
    latestDecision,
    linkedTaskTrackerTaskProcurementRequest: procurementRequest,
  }
}

function getComputerStatusOutcome(value: unknown): string | null {
  return isRecordLike(value) ? getString(value.outcome) : null
}

export function normalizeVantaMonitoredComputer(resource: JsonRecord): VantaMonitoredComputer {
  const operatingSystem = isRecordLike(resource.operatingSystem)
    ? {
        type: getString(resource.operatingSystem.type),
        version: getString(resource.operatingSystem.version),
      }
    : null

  return {
    id: getString(resource.id),
    integrationId: getString(resource.integrationId),
    lastCheckDate: getString(resource.lastCheckDate),
    screenlock: getComputerStatusOutcome(resource.screenlock),
    diskEncryption: getComputerStatusOutcome(resource.diskEncryption),
    passwordManager: getComputerStatusOutcome(resource.passwordManager),
    antivirusInstallation: getComputerStatusOutcome(resource.antivirusInstallation),
    operatingSystem,
    owner: normalizeVantaOwner(resource.owner),
    serialNumber: getString(resource.serialNumber),
    udid: getString(resource.udid),
  }
}

export function normalizeVantaRiskScenario(resource: JsonRecord): VantaRiskScenario {
  return {
    riskId: getString(resource.riskId),
    description: getString(resource.description),
    likelihood: getNumber(resource.likelihood),
    impact: getNumber(resource.impact),
    residualLikelihood: getNumber(resource.residualLikelihood),
    residualImpact: getNumber(resource.residualImpact),
    categories: getStringArray(resource.categories),
    ciaCategories: getStringArray(resource.ciaCategories),
    treatment: getString(resource.treatment),
    owner: getString(resource.owner),
    note: getString(resource.note),
    riskRegister: getString(resource.riskRegister),
    customFields: normalizeVantaCustomFields(resource.customFields),
    isArchived: getBoolean(resource.isArchived),
    reviewStatus: getString(resource.reviewStatus),
    requiredApprovers: getStringArray(resource.requiredApprovers),
    type: getString(resource.type),
    identificationDate: getString(resource.identificationDate),
  }
}

export function normalizeVantaVulnerabilityRemediation(
  resource: JsonRecord
): VantaVulnerabilityRemediation {
  return {
    id: getString(resource.id),
    vulnerabilityId: getString(resource.vulnerabilityId),
    vulnerableAssetId: getString(resource.vulnerableAssetId),
    severity: getString(resource.severity),
    detectedDate: getString(resource.detectedDate),
    slaDeadlineDate: getString(resource.slaDeadlineDate),
    remediationDate: getString(resource.remediationDate),
  }
}

function normalizeVantaVulnerableAssetScanner(resource: JsonRecord): VantaVulnerableAssetScanner {
  return {
    resourceId: getString(resource.resourceId),
    integrationId: getString(resource.integrationId),
    targetId: getString(resource.targetId),
    imageDigest: getString(resource.imageDigest),
    imagePushedAtDate: getString(resource.imagePushedAtDate),
    imageTags: getStringArray(resource.imageTags),
    assetTags: getRecordArray(resource.assetTags).map((tag) => ({
      key: getString(tag.key),
      value: getString(tag.value),
    })),
    parentAccountOrOrganization: getString(resource.parentAccountOrOrganization),
    biosUuid: getString(resource.biosUuid),
    ipv4s: getStringArray(resource.ipv4s),
    ipv6s: getStringArray(resource.ipv6s),
    macAddresses: getStringArray(resource.macAddresses),
    hostnames: getStringArray(resource.hostnames),
    fqdns: getStringArray(resource.fqdns),
    operatingSystems: getStringArray(resource.operatingSystems),
  }
}

export function normalizeVantaVulnerableAsset(resource: JsonRecord): VantaVulnerableAsset {
  return {
    id: getString(resource.id),
    name: getString(resource.name),
    assetType: getString(resource.assetType),
    hasBeenScanned: getBoolean(resource.hasBeenScanned),
    imageScanTag: getString(resource.imageScanTag),
    scanners: getRecordArray(resource.scanners).map(normalizeVantaVulnerableAssetScanner),
  }
}

export function normalizeVantaVulnerability(resource: JsonRecord): VantaVulnerability {
  const deactivateMetadata = isRecordLike(resource.deactivateMetadata)
    ? {
        isVulnDeactivatedIndefinitely: getBoolean(
          resource.deactivateMetadata.isVulnDeactivatedIndefinitely
        ),
        deactivatedUntilDate: getString(resource.deactivateMetadata.deactivatedUntilDate),
        deactivationReason: getString(resource.deactivateMetadata.deactivationReason),
        deactivatedOnDate: getString(resource.deactivateMetadata.deactivatedOnDate),
        deactivatedBy: getString(resource.deactivateMetadata.deactivatedBy),
      }
    : null

  return {
    id: getString(resource.id),
    name: getString(resource.name),
    description: getString(resource.description),
    severity: getString(resource.severity),
    vulnerabilityType: getString(resource.vulnerabilityType),
    integrationId: getString(resource.integrationId),
    targetId: getString(resource.targetId),
    packageIdentifier: getString(resource.packageIdentifier),
    cvssSeverityScore: getNumber(resource.cvssSeverityScore),
    scannerScore: getNumber(resource.scannerScore),
    isFixable: getBoolean(resource.isFixable),
    fixedVersion: getString(resource.fixedVersion),
    remediateByDate: getString(resource.remediateByDate),
    firstDetectedDate: getString(resource.firstDetectedDate),
    sourceDetectedDate: getString(resource.sourceDetectedDate),
    lastDetectedDate: getString(resource.lastDetectedDate),
    scanSource: getString(resource.scanSource),
    externalURL: getString(resource.externalURL),
    relatedVulns: getStringArray(resource.relatedVulns),
    relatedUrls: getStringArray(resource.relatedUrls),
    deactivateMetadata,
  }
}
