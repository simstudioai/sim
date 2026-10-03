import { toBooleanOrNull, toStringOrNull } from '@sim/utils/coerce'
import { isRecordLike, toRecord } from '@sim/utils/object'
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

type JsonRecord = Record<string, unknown>

/**
 * Coerces an unknown single-resource response body to a record so the
 * normalizers can run on it; non-object bodies normalize to all-null fields.
 */
export function asVantaRecord(value: unknown): JsonRecord {
  return toRecord(value)
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
    const nested = toStringOrNull(data.error.message) ?? toStringOrNull(data.error.code)
    if (nested) return nested
  }

  return (
    toStringOrNull(data.message) ??
    toStringOrNull(data.error_description) ??
    toStringOrNull(data.error) ??
    fallback
  )
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
    startCursor: toStringOrNull(value.startCursor),
    endCursor: toStringOrNull(value.endCursor),
    hasNextPage: toBooleanOrNull(value.hasNextPage) ?? false,
    hasPreviousPage: toBooleanOrNull(value.hasPreviousPage) ?? false,
  }
}

function normalizeVantaOwner(value: unknown): VantaOwner | null {
  if (!isRecordLike(value)) return null
  return {
    id: toStringOrNull(value.id),
    displayName: toStringOrNull(value.displayName),
    emailAddress: toStringOrNull(value.emailAddress),
  }
}

function normalizeVantaCustomFields(value: unknown): VantaCustomField[] {
  return getRecordArray(value).map((field) => ({
    label: toStringOrNull(field.label),
    value: Array.isArray(field.value) ? getStringArray(field.value) : toStringOrNull(field.value),
  }))
}

export function normalizeVantaFramework(resource: JsonRecord): VantaFramework {
  return {
    id: toStringOrNull(resource.id),
    displayName: toStringOrNull(resource.displayName),
    shorthandName: toStringOrNull(resource.shorthandName),
    description: toStringOrNull(resource.description),
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
    id: toStringOrNull(resource.id),
    externalId: toStringOrNull(resource.externalId),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
  }
}

function normalizeVantaFrameworkRequirement(resource: JsonRecord): VantaFrameworkRequirement {
  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    shorthand: toStringOrNull(resource.shorthand),
    description: toStringOrNull(resource.description),
    controls: getRecordArray(resource.controls).map(normalizeVantaFrameworkRequirementControl),
  }
}

function normalizeVantaFrameworkRequirementCategory(
  resource: JsonRecord
): VantaFrameworkRequirementCategory {
  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    shorthand: toStringOrNull(resource.shorthand),
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
    id: toStringOrNull(resource.id),
    externalId: toStringOrNull(resource.externalId),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
    source: toStringOrNull(resource.source),
    domains: getStringArray(resource.domains),
    owner: normalizeVantaOwner(resource.owner),
    role: toStringOrNull(resource.role),
    customFields: normalizeVantaCustomFields(resource.customFields),
    creationDate: toStringOrNull(resource.creationDate),
    modificationDate: toStringOrNull(resource.modificationDate),
  }
}

export function normalizeVantaControlDetail(resource: JsonRecord): VantaControlDetail {
  return {
    ...normalizeVantaControl(resource),
    note: toStringOrNull(resource.note),
    status: toStringOrNull(resource.status),
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
        isDeactivated: toBooleanOrNull(resource.deactivatedStatusInfo.isDeactivated),
        deactivatedReason: toStringOrNull(resource.deactivatedStatusInfo.deactivatedReason),
        lastUpdatedDate: toStringOrNull(resource.deactivatedStatusInfo.lastUpdatedDate),
      }
    : null
  const remediationStatusInfo = isRecordLike(resource.remediationStatusInfo)
    ? {
        status: toStringOrNull(resource.remediationStatusInfo.status),
        soonestRemediateByDate: toStringOrNull(
          resource.remediationStatusInfo.soonestRemediateByDate
        ),
        itemCount: getNumber(resource.remediationStatusInfo.itemCount),
      }
    : null

  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
    failureDescription: toStringOrNull(resource.failureDescription),
    remediationDescription: toStringOrNull(resource.remediationDescription),
    category: toStringOrNull(resource.category),
    status: toStringOrNull(resource.status),
    integrations: getStringArray(resource.integrations),
    lastTestRunDate: toStringOrNull(resource.lastTestRunDate),
    latestFlipDate: toStringOrNull(resource.latestFlipDate),
    version,
    deactivatedStatusInfo,
    remediationStatusInfo,
    owner: normalizeVantaOwner(resource.owner),
  }
}

export function normalizeVantaTestEntity(resource: JsonRecord): VantaTestEntity {
  return {
    id: toStringOrNull(resource.id),
    entityStatus: toStringOrNull(resource.entityStatus),
    displayName: toStringOrNull(resource.displayName),
    responseType: toStringOrNull(resource.responseType),
    deactivatedReason: toStringOrNull(resource.deactivatedReason),
    createdDate: toStringOrNull(resource.createdDate),
    lastUpdatedDate: toStringOrNull(resource.lastUpdatedDate),
  }
}

export function normalizeVantaDocument(resource: JsonRecord): VantaDocument {
  return {
    id: toStringOrNull(resource.id),
    title: toStringOrNull(resource.title),
    description: toStringOrNull(resource.description),
    category: toStringOrNull(resource.category),
    ownerId: toStringOrNull(resource.ownerId),
    isSensitive: toBooleanOrNull(resource.isSensitive),
    uploadStatus: toStringOrNull(resource.uploadStatus),
    uploadStatusDate: toStringOrNull(resource.uploadStatusDate),
    url: toStringOrNull(resource.url),
  }
}

export function normalizeVantaDocumentDetail(resource: JsonRecord): VantaDocumentDetail {
  const deactivatedStatus = isRecordLike(resource.deactivatedStatus)
    ? {
        isDeactivated: toBooleanOrNull(resource.deactivatedStatus.isDeactivated),
        reason: toStringOrNull(resource.deactivatedStatus.reason),
        creationDate: toStringOrNull(resource.deactivatedStatus.creationDate),
        expiration: toStringOrNull(resource.deactivatedStatus.expiration),
      }
    : null

  return {
    ...normalizeVantaDocument(resource),
    note: toStringOrNull(resource.note),
    nextRenewalDate: toStringOrNull(resource.nextRenewalDate),
    renewalCadence: toStringOrNull(resource.renewalCadence),
    reminderWindow: toStringOrNull(resource.reminderWindow),
    subscribers: getStringArray(resource.subscribers),
    deactivatedStatus,
  }
}

export function normalizeVantaUploadedFile(resource: JsonRecord): VantaUploadedFile {
  const uploadedBy = isRecordLike(resource.uploadedBy)
    ? { id: toStringOrNull(resource.uploadedBy.id), type: toStringOrNull(resource.uploadedBy.type) }
    : null

  return {
    id: toStringOrNull(resource.id),
    fileName: toStringOrNull(resource.fileName),
    title: toStringOrNull(resource.title),
    description: toStringOrNull(resource.description),
    mimeType: toStringOrNull(resource.mimeType),
    uploadedBy,
    creationDate: toStringOrNull(resource.creationDate),
    updatedDate: toStringOrNull(resource.updatedDate),
    deletionDate: toStringOrNull(resource.deletionDate),
    effectiveDate: toStringOrNull(resource.effectiveDate),
    url: toStringOrNull(resource.url),
  }
}

export function normalizeVantaPerson(resource: JsonRecord): VantaPerson {
  const name = isRecordLike(resource.name)
    ? {
        first: toStringOrNull(resource.name.first),
        last: toStringOrNull(resource.name.last),
        display: toStringOrNull(resource.name.display),
      }
    : null
  const employment = isRecordLike(resource.employment)
    ? {
        status: toStringOrNull(resource.employment.status),
        startDate: toStringOrNull(resource.employment.startDate),
        endDate: toStringOrNull(resource.employment.endDate),
        jobTitle: toStringOrNull(resource.employment.jobTitle),
      }
    : null
  const leaveInfo = isRecordLike(resource.leaveInfo)
    ? {
        status: toStringOrNull(resource.leaveInfo.status),
        startDate: toStringOrNull(resource.leaveInfo.startDate),
        endDate: toStringOrNull(resource.leaveInfo.endDate),
      }
    : null
  const tasksSummary = isRecordLike(resource.tasksSummary)
    ? {
        status: toStringOrNull(resource.tasksSummary.status),
        dueDate: toStringOrNull(resource.tasksSummary.dueDate),
        completionDate: toStringOrNull(resource.tasksSummary.completionDate),
      }
    : null

  return {
    id: toStringOrNull(resource.id),
    userId: toStringOrNull(resource.userId),
    emailAddress: toStringOrNull(resource.emailAddress),
    name,
    employment,
    leaveInfo,
    groupIds: getStringArray(resource.groupIds),
    tasksSummary,
  }
}

function normalizeVantaPolicyDocument(resource: JsonRecord): VantaPolicyDocument {
  return {
    language: toStringOrNull(resource.language),
    slugId: toStringOrNull(resource.slugId),
    url: toStringOrNull(resource.url),
  }
}

export function normalizeVantaPolicy(resource: JsonRecord): VantaPolicy {
  const latestApprovedVersion = isRecordLike(resource.latestApprovedVersion)
    ? {
        versionId: toStringOrNull(resource.latestApprovedVersion.versionId),
        documents: getRecordArray(resource.latestApprovedVersion.documents).map(
          normalizeVantaPolicyDocument
        ),
      }
    : null

  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
    status: toStringOrNull(resource.status),
    approvedAtDate: toStringOrNull(resource.approvedAtDate),
    latestVersionStatus: isRecordLike(resource.latestVersion)
      ? toStringOrNull(resource.latestVersion.status)
      : null,
    latestApprovedVersion,
  }
}

export function normalizeVantaVendor(resource: JsonRecord): VantaVendor {
  const authDetails = isRecordLike(resource.authDetails)
    ? {
        method: toStringOrNull(resource.authDetails.method),
        passwordMFA: toBooleanOrNull(resource.authDetails.passwordMFA),
        passwordMinimumLength: getNumber(resource.authDetails.passwordMinimumLength),
        passwordRequiresNumber: toBooleanOrNull(resource.authDetails.passwordRequiresNumber),
        passwordRequiresSymbol: toBooleanOrNull(resource.authDetails.passwordRequiresSymbol),
      }
    : null
  const contractAmount = isRecordLike(resource.contractAmount)
    ? {
        amount: getNumber(resource.contractAmount.amount),
        currency: toStringOrNull(resource.contractAmount.currency),
      }
    : null
  const latestDecision = isRecordLike(resource.latestDecision)
    ? {
        status: toStringOrNull(resource.latestDecision.status),
        lastUpdatedAt: toStringOrNull(resource.latestDecision.lastUpdatedAt),
      }
    : null
  const procurementRequest = isRecordLike(resource.linkedTaskTrackerTaskProcurementRequest)
    ? {
        url: toStringOrNull(resource.linkedTaskTrackerTaskProcurementRequest.url),
        service: toStringOrNull(resource.linkedTaskTrackerTaskProcurementRequest.service),
      }
    : null

  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    status: toStringOrNull(resource.status),
    websiteUrl: toStringOrNull(resource.websiteUrl),
    category: isRecordLike(resource.category)
      ? toStringOrNull(resource.category.displayName)
      : null,
    servicesProvided: toStringOrNull(resource.servicesProvided),
    additionalNotes: toStringOrNull(resource.additionalNotes),
    accountManagerName: toStringOrNull(resource.accountManagerName),
    accountManagerEmail: toStringOrNull(resource.accountManagerEmail),
    securityOwnerUserId: toStringOrNull(resource.securityOwnerUserId),
    businessOwnerUserId: toStringOrNull(resource.businessOwnerUserId),
    inherentRiskLevel: toStringOrNull(resource.inherentRiskLevel),
    residualRiskLevel: toStringOrNull(resource.residualRiskLevel),
    isRiskAutoScored: toBooleanOrNull(resource.isRiskAutoScored),
    isVisibleToAuditors: toBooleanOrNull(resource.isVisibleToAuditors),
    riskAttributeIds: getStringArray(resource.riskAttributeIds),
    vendorHeadquarters: toStringOrNull(resource.vendorHeadquarters),
    contractStartDate: toStringOrNull(resource.contractStartDate),
    contractRenewalDate: toStringOrNull(resource.contractRenewalDate),
    contractTerminationDate: toStringOrNull(resource.contractTerminationDate),
    contractAmount,
    nextSecurityReviewDueDate: toStringOrNull(resource.nextSecurityReviewDueDate),
    lastSecurityReviewCompletionDate: toStringOrNull(resource.lastSecurityReviewCompletionDate),
    authDetails,
    customFields: normalizeVantaCustomFields(resource.customFields),
    latestDecision,
    linkedTaskTrackerTaskProcurementRequest: procurementRequest,
  }
}

function getComputerStatusOutcome(value: unknown): string | null {
  return isRecordLike(value) ? toStringOrNull(value.outcome) : null
}

export function normalizeVantaMonitoredComputer(resource: JsonRecord): VantaMonitoredComputer {
  const operatingSystem = isRecordLike(resource.operatingSystem)
    ? {
        type: toStringOrNull(resource.operatingSystem.type),
        version: toStringOrNull(resource.operatingSystem.version),
      }
    : null

  return {
    id: toStringOrNull(resource.id),
    integrationId: toStringOrNull(resource.integrationId),
    lastCheckDate: toStringOrNull(resource.lastCheckDate),
    screenlock: getComputerStatusOutcome(resource.screenlock),
    diskEncryption: getComputerStatusOutcome(resource.diskEncryption),
    passwordManager: getComputerStatusOutcome(resource.passwordManager),
    antivirusInstallation: getComputerStatusOutcome(resource.antivirusInstallation),
    operatingSystem,
    owner: normalizeVantaOwner(resource.owner),
    serialNumber: toStringOrNull(resource.serialNumber),
    udid: toStringOrNull(resource.udid),
  }
}

export function normalizeVantaRiskScenario(resource: JsonRecord): VantaRiskScenario {
  return {
    riskId: toStringOrNull(resource.riskId),
    description: toStringOrNull(resource.description),
    likelihood: getNumber(resource.likelihood),
    impact: getNumber(resource.impact),
    residualLikelihood: getNumber(resource.residualLikelihood),
    residualImpact: getNumber(resource.residualImpact),
    categories: getStringArray(resource.categories),
    ciaCategories: getStringArray(resource.ciaCategories),
    treatment: toStringOrNull(resource.treatment),
    owner: toStringOrNull(resource.owner),
    note: toStringOrNull(resource.note),
    riskRegister: toStringOrNull(resource.riskRegister),
    customFields: normalizeVantaCustomFields(resource.customFields),
    isArchived: toBooleanOrNull(resource.isArchived),
    reviewStatus: toStringOrNull(resource.reviewStatus),
    requiredApprovers: getStringArray(resource.requiredApprovers),
    type: toStringOrNull(resource.type),
    identificationDate: toStringOrNull(resource.identificationDate),
  }
}

export function normalizeVantaVulnerabilityRemediation(
  resource: JsonRecord
): VantaVulnerabilityRemediation {
  return {
    id: toStringOrNull(resource.id),
    vulnerabilityId: toStringOrNull(resource.vulnerabilityId),
    vulnerableAssetId: toStringOrNull(resource.vulnerableAssetId),
    severity: toStringOrNull(resource.severity),
    detectedDate: toStringOrNull(resource.detectedDate),
    slaDeadlineDate: toStringOrNull(resource.slaDeadlineDate),
    remediationDate: toStringOrNull(resource.remediationDate),
  }
}

function normalizeVantaVulnerableAssetScanner(resource: JsonRecord): VantaVulnerableAssetScanner {
  return {
    resourceId: toStringOrNull(resource.resourceId),
    integrationId: toStringOrNull(resource.integrationId),
    targetId: toStringOrNull(resource.targetId),
    imageDigest: toStringOrNull(resource.imageDigest),
    imagePushedAtDate: toStringOrNull(resource.imagePushedAtDate),
    imageTags: getStringArray(resource.imageTags),
    assetTags: getRecordArray(resource.assetTags).map((tag) => ({
      key: toStringOrNull(tag.key),
      value: toStringOrNull(tag.value),
    })),
    parentAccountOrOrganization: toStringOrNull(resource.parentAccountOrOrganization),
    biosUuid: toStringOrNull(resource.biosUuid),
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
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    assetType: toStringOrNull(resource.assetType),
    hasBeenScanned: toBooleanOrNull(resource.hasBeenScanned),
    imageScanTag: toStringOrNull(resource.imageScanTag),
    scanners: getRecordArray(resource.scanners).map(normalizeVantaVulnerableAssetScanner),
  }
}

export function normalizeVantaVulnerability(resource: JsonRecord): VantaVulnerability {
  const deactivateMetadata = isRecordLike(resource.deactivateMetadata)
    ? {
        isVulnDeactivatedIndefinitely: toBooleanOrNull(
          resource.deactivateMetadata.isVulnDeactivatedIndefinitely
        ),
        deactivatedUntilDate: toStringOrNull(resource.deactivateMetadata.deactivatedUntilDate),
        deactivationReason: toStringOrNull(resource.deactivateMetadata.deactivationReason),
        deactivatedOnDate: toStringOrNull(resource.deactivateMetadata.deactivatedOnDate),
        deactivatedBy: toStringOrNull(resource.deactivateMetadata.deactivatedBy),
      }
    : null

  return {
    id: toStringOrNull(resource.id),
    name: toStringOrNull(resource.name),
    description: toStringOrNull(resource.description),
    severity: toStringOrNull(resource.severity),
    vulnerabilityType: toStringOrNull(resource.vulnerabilityType),
    integrationId: toStringOrNull(resource.integrationId),
    targetId: toStringOrNull(resource.targetId),
    packageIdentifier: toStringOrNull(resource.packageIdentifier),
    cvssSeverityScore: getNumber(resource.cvssSeverityScore),
    scannerScore: getNumber(resource.scannerScore),
    isFixable: toBooleanOrNull(resource.isFixable),
    fixedVersion: toStringOrNull(resource.fixedVersion),
    remediateByDate: toStringOrNull(resource.remediateByDate),
    firstDetectedDate: toStringOrNull(resource.firstDetectedDate),
    sourceDetectedDate: toStringOrNull(resource.sourceDetectedDate),
    lastDetectedDate: toStringOrNull(resource.lastDetectedDate),
    scanSource: toStringOrNull(resource.scanSource),
    externalURL: toStringOrNull(resource.externalURL),
    relatedVulns: getStringArray(resource.relatedVulns),
    relatedUrls: getStringArray(resource.relatedUrls),
    deactivateMetadata,
  }
}
