import type { ToolResponse } from '@/tools/types'

export type VantaRegion = 'us' | 'gov'

export interface VantaBaseParams {
  clientId: string
  clientSecret: string
  region?: VantaRegion
}

export interface VantaPaginationParams {
  pageSize?: number
  pageCursor?: string
}

export interface VantaListFrameworksParams extends VantaBaseParams, VantaPaginationParams {}

export interface VantaGetFrameworkParams extends VantaBaseParams {
  frameworkId: string
}

export interface VantaListFrameworkControlsParams extends VantaBaseParams, VantaPaginationParams {
  frameworkId: string
}

export interface VantaListControlsParams extends VantaBaseParams, VantaPaginationParams {
  frameworkMatchesAny?: string
}

export interface VantaGetControlParams extends VantaBaseParams {
  controlId: string
}

export interface VantaListControlTestsParams extends VantaBaseParams, VantaPaginationParams {
  controlId: string
}

export interface VantaListControlDocumentsParams extends VantaBaseParams, VantaPaginationParams {
  controlId: string
}

export interface VantaListTestsParams extends VantaBaseParams, VantaPaginationParams {
  statusFilter?: string
  categoryFilter?: string
  frameworkFilter?: string
  integrationFilter?: string
  controlFilter?: string
  ownerFilter?: string
  isInRollout?: boolean
}

export interface VantaGetTestParams extends VantaBaseParams {
  testId: string
}

export interface VantaListTestEntitiesParams extends VantaBaseParams, VantaPaginationParams {
  testId: string
  entityStatus?: string
}

export interface VantaListDocumentsParams extends VantaBaseParams, VantaPaginationParams {
  frameworkMatchesAny?: string
  statusMatchesAny?: string
}

export interface VantaGetDocumentParams extends VantaBaseParams {
  documentId: string
}

export interface VantaListDocumentUploadsParams extends VantaBaseParams, VantaPaginationParams {
  documentId: string
}

export interface VantaUploadDocumentFileParams extends VantaBaseParams {
  documentId: string
  file?: unknown
  fileContent?: string
  fileName?: string
  mimeType?: string
  description?: string
  effectiveAtDate?: string
}

export interface VantaDownloadDocumentFileParams extends VantaBaseParams {
  documentId: string
  uploadedFileId: string
}

export interface VantaSubmitDocumentParams extends VantaBaseParams {
  documentId: string
}

export interface VantaListPeopleParams extends VantaBaseParams, VantaPaginationParams {
  emailAndNameFilter?: string
  employmentStatus?: string
  groupIdsMatchesAny?: string
  tasksSummaryStatusMatchesAny?: string
  taskTypeMatchesAny?: string
  taskStatusMatchesAny?: string
}

export interface VantaGetPersonParams extends VantaBaseParams {
  personId: string
}

export interface VantaListPoliciesParams extends VantaBaseParams, VantaPaginationParams {}

export interface VantaGetPolicyParams extends VantaBaseParams {
  policyId: string
}

export interface VantaListMonitoredComputersParams extends VantaBaseParams, VantaPaginationParams {
  complianceStatusFilterMatchesAny?: string
}

export interface VantaListRiskScenariosParams extends VantaBaseParams, VantaPaginationParams {
  searchString?: string
  includeIgnored?: boolean
  type?: string
  ownerMatchesAny?: string
  categoryMatchesAny?: string
  ciaCategoryMatchesAny?: string
  treatmentTypeMatchesAny?: string
  inherentScoreGroupMatchesAny?: string
  residualScoreGroupMatchesAny?: string
  reviewStatusMatchesAny?: string
  orderBy?: string
}

export interface VantaGetRiskScenarioParams extends VantaBaseParams {
  riskScenarioId: string
}

export interface VantaListVulnerabilityRemediationsParams
  extends VantaBaseParams,
    VantaPaginationParams {
  integrationId?: string
  severity?: string
  isRemediatedOnTime?: boolean
  remediatedAfterDate?: string
  remediatedBeforeDate?: string
}

export interface VantaListVulnerableAssetsParams extends VantaBaseParams, VantaPaginationParams {
  q?: string
  integrationId?: string
  assetType?: string
  assetExternalAccountId?: string
}

export interface VantaGetVulnerableAssetParams extends VantaBaseParams {
  vulnerableAssetId: string
}

export interface VantaListVendorsParams extends VantaBaseParams, VantaPaginationParams {
  name?: string
  statusMatchesAny?: string
}

export interface VantaGetVendorParams extends VantaBaseParams {
  vendorId: string
}

export interface VantaListVulnerabilitiesParams extends VantaBaseParams, VantaPaginationParams {
  q?: string
  severity?: string
  isFixAvailable?: boolean
  isDeactivated?: boolean
  includeVulnerabilitiesWithoutSlas?: boolean
  packageIdentifier?: string
  externalVulnerabilityId?: string
  integrationId?: string
  vulnerableAssetId?: string
  slaDeadlineAfterDate?: string
  slaDeadlineBeforeDate?: string
}

export interface VantaPageInfo {
  startCursor: string | null
  endCursor: string | null
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export interface VantaOwner {
  id: string | null
  displayName: string | null
  emailAddress: string | null
}

export interface VantaCustomField {
  label: string | null
  value: string | string[] | null
}

export interface VantaFramework {
  id: string | null
  displayName: string | null
  shorthandName: string | null
  description: string | null
  numControlsCompleted: number | null
  numControlsTotal: number | null
  numDocumentsPassing: number | null
  numDocumentsTotal: number | null
  numTestsPassing: number | null
  numTestsTotal: number | null
}

export interface VantaFrameworkRequirementControl {
  id: string | null
  externalId: string | null
  name: string | null
  description: string | null
}

export interface VantaFrameworkRequirement {
  id: string | null
  name: string | null
  shorthand: string | null
  description: string | null
  controls: VantaFrameworkRequirementControl[]
}

export interface VantaFrameworkRequirementCategory {
  id: string | null
  name: string | null
  shorthand: string | null
  requirements: VantaFrameworkRequirement[]
}

export interface VantaFrameworkDetail extends VantaFramework {
  requirementCategories: VantaFrameworkRequirementCategory[]
}

export interface VantaControl {
  id: string | null
  externalId: string | null
  name: string | null
  description: string | null
  source: string | null
  domains: string[]
  owner: VantaOwner | null
  role: string | null
  customFields: VantaCustomField[]
  creationDate: string | null
  modificationDate: string | null
}

export interface VantaControlDetail extends VantaControl {
  note: string | null
  status: string | null
  numDocumentsPassing: number | null
  numDocumentsTotal: number | null
  numTestsPassing: number | null
  numTestsTotal: number | null
}

export interface VantaTestVersion {
  major: number | null
  minor: number | null
}

export interface VantaTestDeactivatedStatusInfo {
  isDeactivated: boolean | null
  deactivatedReason: string | null
  lastUpdatedDate: string | null
}

export interface VantaTestRemediationStatusInfo {
  status: string | null
  soonestRemediateByDate: string | null
  itemCount: number | null
}

export interface VantaTest {
  id: string | null
  name: string | null
  description: string | null
  failureDescription: string | null
  remediationDescription: string | null
  category: string | null
  status: string | null
  integrations: string[]
  lastTestRunDate: string | null
  latestFlipDate: string | null
  version: VantaTestVersion | null
  deactivatedStatusInfo: VantaTestDeactivatedStatusInfo | null
  remediationStatusInfo: VantaTestRemediationStatusInfo | null
  owner: VantaOwner | null
}

export interface VantaTestEntity {
  id: string | null
  entityStatus: string | null
  displayName: string | null
  responseType: string | null
  deactivatedReason: string | null
  createdDate: string | null
  lastUpdatedDate: string | null
}

export interface VantaDocument {
  id: string | null
  title: string | null
  description: string | null
  category: string | null
  ownerId: string | null
  isSensitive: boolean | null
  uploadStatus: string | null
  uploadStatusDate: string | null
  url: string | null
}

export interface VantaDocumentDeactivatedStatus {
  isDeactivated: boolean | null
  reason: string | null
  creationDate: string | null
  expiration: string | null
}

export interface VantaDocumentDetail extends VantaDocument {
  note: string | null
  nextRenewalDate: string | null
  renewalCadence: string | null
  reminderWindow: string | null
  subscribers: string[]
  deactivatedStatus: VantaDocumentDeactivatedStatus | null
}

export interface VantaUploadedByActor {
  id: string | null
  type: string | null
}

export interface VantaUploadedFile {
  id: string | null
  fileName: string | null
  title: string | null
  description: string | null
  mimeType: string | null
  uploadedBy: VantaUploadedByActor | null
  creationDate: string | null
  updatedDate: string | null
  deletionDate: string | null
  effectiveDate: string | null
  url: string | null
}

export interface VantaPersonName {
  first: string | null
  last: string | null
  display: string | null
}

export interface VantaPersonEmployment {
  status: string | null
  startDate: string | null
  endDate: string | null
  jobTitle: string | null
}

export interface VantaPersonLeaveInfo {
  status: string | null
  startDate: string | null
  endDate: string | null
}

export interface VantaPersonTasksSummary {
  status: string | null
  dueDate: string | null
  completionDate: string | null
}

export interface VantaPerson {
  id: string | null
  userId: string | null
  emailAddress: string | null
  name: VantaPersonName | null
  employment: VantaPersonEmployment | null
  leaveInfo: VantaPersonLeaveInfo | null
  groupIds: string[]
  tasksSummary: VantaPersonTasksSummary | null
}

export interface VantaPolicyDocument {
  language: string | null
  slugId: string | null
  url: string | null
}

export interface VantaPolicyLatestApprovedVersion {
  versionId: string | null
  documents: VantaPolicyDocument[]
}

export interface VantaPolicy {
  id: string | null
  name: string | null
  description: string | null
  status: string | null
  approvedAtDate: string | null
  latestVersionStatus: string | null
  latestApprovedVersion: VantaPolicyLatestApprovedVersion | null
}

export interface VantaVendorAuthDetails {
  method: string | null
  passwordMFA: boolean | null
  passwordMinimumLength: number | null
  passwordRequiresNumber: boolean | null
  passwordRequiresSymbol: boolean | null
}

export interface VantaVendorContractAmount {
  amount: number | null
  currency: string | null
}

export interface VantaVendorDecision {
  status: string | null
  lastUpdatedAt: string | null
}

export interface VantaVendorProcurementRequest {
  url: string | null
  service: string | null
}

export interface VantaVendor {
  id: string | null
  name: string | null
  status: string | null
  websiteUrl: string | null
  category: string | null
  servicesProvided: string | null
  additionalNotes: string | null
  accountManagerName: string | null
  accountManagerEmail: string | null
  securityOwnerUserId: string | null
  businessOwnerUserId: string | null
  inherentRiskLevel: string | null
  residualRiskLevel: string | null
  isRiskAutoScored: boolean | null
  isVisibleToAuditors: boolean | null
  riskAttributeIds: string[]
  vendorHeadquarters: string | null
  contractStartDate: string | null
  contractRenewalDate: string | null
  contractTerminationDate: string | null
  contractAmount: VantaVendorContractAmount | null
  nextSecurityReviewDueDate: string | null
  lastSecurityReviewCompletionDate: string | null
  authDetails: VantaVendorAuthDetails | null
  customFields: VantaCustomField[]
  latestDecision: VantaVendorDecision | null
  linkedTaskTrackerTaskProcurementRequest: VantaVendorProcurementRequest | null
}

export interface VantaVulnerabilityDeactivateMetadata {
  isVulnDeactivatedIndefinitely: boolean | null
  deactivatedUntilDate: string | null
  deactivationReason: string | null
  deactivatedOnDate: string | null
  deactivatedBy: string | null
}

export interface VantaVulnerability {
  id: string | null
  name: string | null
  description: string | null
  severity: string | null
  vulnerabilityType: string | null
  integrationId: string | null
  targetId: string | null
  packageIdentifier: string | null
  cvssSeverityScore: number | null
  scannerScore: number | null
  isFixable: boolean | null
  fixedVersion: string | null
  remediateByDate: string | null
  firstDetectedDate: string | null
  sourceDetectedDate: string | null
  lastDetectedDate: string | null
  scanSource: string | null
  externalURL: string | null
  relatedVulns: string[]
  relatedUrls: string[]
  deactivateMetadata: VantaVulnerabilityDeactivateMetadata | null
}

export interface VantaOperatingSystem {
  type: string | null
  version: string | null
}

export interface VantaMonitoredComputer {
  id: string | null
  integrationId: string | null
  lastCheckDate: string | null
  screenlock: string | null
  diskEncryption: string | null
  passwordManager: string | null
  antivirusInstallation: string | null
  operatingSystem: VantaOperatingSystem | null
  owner: VantaOwner | null
  serialNumber: string | null
  udid: string | null
}

export interface VantaRiskScenario {
  riskId: string | null
  description: string | null
  likelihood: number | null
  impact: number | null
  residualLikelihood: number | null
  residualImpact: number | null
  categories: string[]
  ciaCategories: string[]
  treatment: string | null
  owner: string | null
  note: string | null
  riskRegister: string | null
  customFields: VantaCustomField[]
  isArchived: boolean | null
  reviewStatus: string | null
  requiredApprovers: string[]
  type: string | null
  identificationDate: string | null
}

export interface VantaVulnerabilityRemediation {
  id: string | null
  vulnerabilityId: string | null
  vulnerableAssetId: string | null
  severity: string | null
  detectedDate: string | null
  slaDeadlineDate: string | null
  remediationDate: string | null
}

export interface VantaAssetTag {
  key: string | null
  value: string | null
}

export interface VantaVulnerableAssetScanner {
  resourceId: string | null
  integrationId: string | null
  targetId: string | null
  imageDigest: string | null
  imagePushedAtDate: string | null
  imageTags: string[]
  assetTags: VantaAssetTag[]
  parentAccountOrOrganization: string | null
  biosUuid: string | null
  ipv4s: string[]
  ipv6s: string[]
  macAddresses: string[]
  hostnames: string[]
  fqdns: string[]
  operatingSystems: string[]
}

export interface VantaVulnerableAsset {
  id: string | null
  name: string | null
  assetType: string | null
  hasBeenScanned: boolean | null
  imageScanTag: string | null
  scanners: VantaVulnerableAssetScanner[]
}

export interface VantaDownloadedFile {
  name: string
  mimeType: string
  data: string
  size: number
}

export interface VantaListFrameworksResponse extends ToolResponse {
  output: {
    frameworks: VantaFramework[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetFrameworkResponse extends ToolResponse {
  output: {
    framework: VantaFrameworkDetail
  }
}

export interface VantaListControlsResponse extends ToolResponse {
  output: {
    controls: VantaControl[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetControlResponse extends ToolResponse {
  output: {
    control: VantaControlDetail
  }
}

export interface VantaListTestsResponse extends ToolResponse {
  output: {
    tests: VantaTest[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetTestResponse extends ToolResponse {
  output: {
    test: VantaTest
  }
}

export interface VantaListTestEntitiesResponse extends ToolResponse {
  output: {
    entities: VantaTestEntity[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaListDocumentsResponse extends ToolResponse {
  output: {
    documents: VantaDocument[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetDocumentResponse extends ToolResponse {
  output: {
    document: VantaDocumentDetail
  }
}

export interface VantaListDocumentUploadsResponse extends ToolResponse {
  output: {
    uploads: VantaUploadedFile[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaUploadDocumentFileResponse extends ToolResponse {
  output: {
    upload: VantaUploadedFile
  }
}

export interface VantaDownloadDocumentFileResponse extends ToolResponse {
  output: {
    file: VantaDownloadedFile
    name: string
    mimeType: string
    size: number
  }
}

export interface VantaSubmitDocumentResponse extends ToolResponse {
  output: {
    documentId: string
    submitted: boolean
  }
}

export interface VantaGetPersonResponse extends ToolResponse {
  output: {
    person: VantaPerson
  }
}

export interface VantaGetPolicyResponse extends ToolResponse {
  output: {
    policy: VantaPolicy
  }
}

export interface VantaListMonitoredComputersResponse extends ToolResponse {
  output: {
    computers: VantaMonitoredComputer[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaListRiskScenariosResponse extends ToolResponse {
  output: {
    riskScenarios: VantaRiskScenario[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetRiskScenarioResponse extends ToolResponse {
  output: {
    riskScenario: VantaRiskScenario
  }
}

export interface VantaListVulnerabilityRemediationsResponse extends ToolResponse {
  output: {
    remediations: VantaVulnerabilityRemediation[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaListVulnerableAssetsResponse extends ToolResponse {
  output: {
    assets: VantaVulnerableAsset[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetVulnerableAssetResponse extends ToolResponse {
  output: {
    asset: VantaVulnerableAsset
  }
}

export interface VantaListPeopleResponse extends ToolResponse {
  output: {
    people: VantaPerson[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaListPoliciesResponse extends ToolResponse {
  output: {
    policies: VantaPolicy[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaListVendorsResponse extends ToolResponse {
  output: {
    vendors: VantaVendor[]
    pageInfo: VantaPageInfo | null
  }
}

export interface VantaGetVendorResponse extends ToolResponse {
  output: {
    vendor: VantaVendor
  }
}

export interface VantaListVulnerabilitiesResponse extends ToolResponse {
  output: {
    vulnerabilities: VantaVulnerability[]
    pageInfo: VantaPageInfo | null
  }
}

export type VantaResponse =
  | VantaListFrameworksResponse
  | VantaGetFrameworkResponse
  | VantaListControlsResponse
  | VantaGetControlResponse
  | VantaListTestsResponse
  | VantaGetTestResponse
  | VantaListTestEntitiesResponse
  | VantaListDocumentsResponse
  | VantaGetDocumentResponse
  | VantaListDocumentUploadsResponse
  | VantaUploadDocumentFileResponse
  | VantaDownloadDocumentFileResponse
  | VantaSubmitDocumentResponse
  | VantaListPeopleResponse
  | VantaGetPersonResponse
  | VantaListPoliciesResponse
  | VantaGetPolicyResponse
  | VantaListVendorsResponse
  | VantaGetVendorResponse
  | VantaListMonitoredComputersResponse
  | VantaListVulnerabilitiesResponse
  | VantaListVulnerabilityRemediationsResponse
  | VantaListVulnerableAssetsResponse
  | VantaGetVulnerableAssetResponse
  | VantaListRiskScenariosResponse
  | VantaGetRiskScenarioResponse
