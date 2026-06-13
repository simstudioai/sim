import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

const nullableString = z.string().nullable()
const nullableNumber = z.number().nullable()
const nullableBoolean = z.boolean().nullable()

const vantaPageInfoSchema = z
  .object({
    startCursor: nullableString,
    endCursor: nullableString,
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  })
  .nullable()

const vantaOwnerSchema = z
  .object({
    id: nullableString,
    displayName: nullableString,
    emailAddress: nullableString,
  })
  .nullable()

const vantaCustomFieldsSchema = z.array(
  z.object({
    label: nullableString,
    value: z.union([z.string(), z.array(z.string())]).nullable(),
  })
)

const vantaFrameworkSchema = z.object({
  id: nullableString,
  displayName: nullableString,
  shorthandName: nullableString,
  description: nullableString,
  numControlsCompleted: nullableNumber,
  numControlsTotal: nullableNumber,
  numDocumentsPassing: nullableNumber,
  numDocumentsTotal: nullableNumber,
  numTestsPassing: nullableNumber,
  numTestsTotal: nullableNumber,
})

const vantaFrameworkDetailSchema = vantaFrameworkSchema.extend({
  requirementCategories: z.array(
    z.object({
      id: nullableString,
      name: nullableString,
      shorthand: nullableString,
      requirements: z.array(
        z.object({
          id: nullableString,
          name: nullableString,
          shorthand: nullableString,
          description: nullableString,
          controls: z.array(
            z.object({
              id: nullableString,
              externalId: nullableString,
              name: nullableString,
              description: nullableString,
            })
          ),
        })
      ),
    })
  ),
})

const vantaControlSchema = z.object({
  id: nullableString,
  externalId: nullableString,
  name: nullableString,
  description: nullableString,
  source: nullableString,
  domains: z.array(z.string()),
  owner: vantaOwnerSchema,
  role: nullableString,
  customFields: vantaCustomFieldsSchema,
  creationDate: nullableString,
  modificationDate: nullableString,
})

const vantaControlDetailSchema = vantaControlSchema.extend({
  note: nullableString,
  status: nullableString,
  numDocumentsPassing: nullableNumber,
  numDocumentsTotal: nullableNumber,
  numTestsPassing: nullableNumber,
  numTestsTotal: nullableNumber,
})

const vantaTestSchema = z.object({
  id: nullableString,
  name: nullableString,
  description: nullableString,
  failureDescription: nullableString,
  remediationDescription: nullableString,
  category: nullableString,
  status: nullableString,
  integrations: z.array(z.string()),
  lastTestRunDate: nullableString,
  latestFlipDate: nullableString,
  version: z.object({ major: nullableNumber, minor: nullableNumber }).nullable(),
  deactivatedStatusInfo: z
    .object({
      isDeactivated: nullableBoolean,
      deactivatedReason: nullableString,
      lastUpdatedDate: nullableString,
    })
    .nullable(),
  remediationStatusInfo: z
    .object({
      status: nullableString,
      soonestRemediateByDate: nullableString,
      itemCount: nullableNumber,
    })
    .nullable(),
  owner: vantaOwnerSchema,
})

const vantaTestEntitySchema = z.object({
  id: nullableString,
  entityStatus: nullableString,
  displayName: nullableString,
  responseType: nullableString,
  deactivatedReason: nullableString,
  createdDate: nullableString,
  lastUpdatedDate: nullableString,
})

const vantaDocumentSchema = z.object({
  id: nullableString,
  title: nullableString,
  description: nullableString,
  category: nullableString,
  ownerId: nullableString,
  isSensitive: nullableBoolean,
  uploadStatus: nullableString,
  uploadStatusDate: nullableString,
  url: nullableString,
})

const vantaDocumentDetailSchema = vantaDocumentSchema.extend({
  note: nullableString,
  nextRenewalDate: nullableString,
  renewalCadence: nullableString,
  reminderWindow: nullableString,
  subscribers: z.array(z.string()),
  deactivatedStatus: z
    .object({
      isDeactivated: nullableBoolean,
      reason: nullableString,
      creationDate: nullableString,
      expiration: nullableString,
    })
    .nullable(),
})

const vantaUploadedFileSchema = z.object({
  id: nullableString,
  fileName: nullableString,
  title: nullableString,
  description: nullableString,
  mimeType: nullableString,
  uploadedBy: z.object({ id: nullableString, type: nullableString }).nullable(),
  creationDate: nullableString,
  updatedDate: nullableString,
  deletionDate: nullableString,
  effectiveDate: nullableString,
  url: nullableString,
})

const vantaPersonSchema = z.object({
  id: nullableString,
  userId: nullableString,
  emailAddress: nullableString,
  name: z
    .object({ first: nullableString, last: nullableString, display: nullableString })
    .nullable(),
  employment: z
    .object({
      status: nullableString,
      startDate: nullableString,
      endDate: nullableString,
      jobTitle: nullableString,
    })
    .nullable(),
  leaveInfo: z
    .object({ status: nullableString, startDate: nullableString, endDate: nullableString })
    .nullable(),
  groupIds: z.array(z.string()),
  tasksSummary: z
    .object({
      status: nullableString,
      dueDate: nullableString,
      completionDate: nullableString,
    })
    .nullable(),
})

const vantaPolicySchema = z.object({
  id: nullableString,
  name: nullableString,
  description: nullableString,
  status: nullableString,
  approvedAtDate: nullableString,
  latestVersionStatus: nullableString,
  latestApprovedVersion: z
    .object({
      versionId: nullableString,
      documents: z.array(
        z.object({ language: nullableString, slugId: nullableString, url: nullableString })
      ),
    })
    .nullable(),
})

const vantaVendorSchema = z.object({
  id: nullableString,
  name: nullableString,
  status: nullableString,
  websiteUrl: nullableString,
  category: nullableString,
  servicesProvided: nullableString,
  additionalNotes: nullableString,
  accountManagerName: nullableString,
  accountManagerEmail: nullableString,
  securityOwnerUserId: nullableString,
  businessOwnerUserId: nullableString,
  inherentRiskLevel: nullableString,
  residualRiskLevel: nullableString,
  isRiskAutoScored: nullableBoolean,
  isVisibleToAuditors: nullableBoolean,
  riskAttributeIds: z.array(z.string()),
  vendorHeadquarters: nullableString,
  contractStartDate: nullableString,
  contractRenewalDate: nullableString,
  contractTerminationDate: nullableString,
  contractAmount: z.object({ amount: nullableNumber, currency: nullableString }).nullable(),
  nextSecurityReviewDueDate: nullableString,
  lastSecurityReviewCompletionDate: nullableString,
  authDetails: z
    .object({
      method: nullableString,
      passwordMFA: nullableBoolean,
      passwordMinimumLength: nullableNumber,
      passwordRequiresNumber: nullableBoolean,
      passwordRequiresSymbol: nullableBoolean,
    })
    .nullable(),
  customFields: vantaCustomFieldsSchema,
  latestDecision: z.object({ status: nullableString, lastUpdatedAt: nullableString }).nullable(),
  linkedTaskTrackerTaskProcurementRequest: z
    .object({ url: nullableString, service: nullableString })
    .nullable(),
})

const vantaMonitoredComputerSchema = z.object({
  id: nullableString,
  integrationId: nullableString,
  lastCheckDate: nullableString,
  screenlock: nullableString,
  diskEncryption: nullableString,
  passwordManager: nullableString,
  antivirusInstallation: nullableString,
  operatingSystem: z.object({ type: nullableString, version: nullableString }).nullable(),
  owner: vantaOwnerSchema,
  serialNumber: nullableString,
  udid: nullableString,
})

const vantaVulnerabilitySchema = z.object({
  id: nullableString,
  name: nullableString,
  description: nullableString,
  severity: nullableString,
  vulnerabilityType: nullableString,
  integrationId: nullableString,
  targetId: nullableString,
  packageIdentifier: nullableString,
  cvssSeverityScore: nullableNumber,
  scannerScore: nullableNumber,
  isFixable: nullableBoolean,
  fixedVersion: nullableString,
  remediateByDate: nullableString,
  firstDetectedDate: nullableString,
  sourceDetectedDate: nullableString,
  lastDetectedDate: nullableString,
  scanSource: nullableString,
  externalURL: nullableString,
  relatedVulns: z.array(z.string()),
  relatedUrls: z.array(z.string()),
  deactivateMetadata: z
    .object({
      isVulnDeactivatedIndefinitely: nullableBoolean,
      deactivatedUntilDate: nullableString,
      deactivationReason: nullableString,
      deactivatedOnDate: nullableString,
      deactivatedBy: nullableString,
    })
    .nullable(),
})

const vantaVulnerabilityRemediationSchema = z.object({
  id: nullableString,
  vulnerabilityId: nullableString,
  vulnerableAssetId: nullableString,
  severity: nullableString,
  detectedDate: nullableString,
  slaDeadlineDate: nullableString,
  remediationDate: nullableString,
})

const vantaVulnerableAssetSchema = z.object({
  id: nullableString,
  name: nullableString,
  assetType: nullableString,
  hasBeenScanned: nullableBoolean,
  imageScanTag: nullableString,
  scanners: z.array(
    z.object({
      resourceId: nullableString,
      integrationId: nullableString,
      targetId: nullableString,
      imageDigest: nullableString,
      imagePushedAtDate: nullableString,
      imageTags: z.array(z.string()),
      assetTags: z.array(z.object({ key: nullableString, value: nullableString })),
      parentAccountOrOrganization: nullableString,
      biosUuid: nullableString,
      ipv4s: z.array(z.string()),
      ipv6s: z.array(z.string()),
      macAddresses: z.array(z.string()),
      hostnames: z.array(z.string()),
      fqdns: z.array(z.string()),
      operatingSystems: z.array(z.string()),
    })
  ),
})

const vantaRiskScenarioSchema = z.object({
  riskId: nullableString,
  description: nullableString,
  likelihood: nullableNumber,
  impact: nullableNumber,
  residualLikelihood: nullableNumber,
  residualImpact: nullableNumber,
  categories: z.array(z.string()),
  ciaCategories: z.array(z.string()),
  treatment: nullableString,
  owner: nullableString,
  note: nullableString,
  riskRegister: nullableString,
  customFields: vantaCustomFieldsSchema,
  isArchived: nullableBoolean,
  reviewStatus: nullableString,
  requiredApprovers: z.array(z.string()),
  type: nullableString,
  identificationDate: nullableString,
})

const VANTA_REGIONS = ['us', 'gov'] as const

const vantaBaseBodySchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client secret is required'),
  region: z.enum(VANTA_REGIONS).optional(),
})

const vantaPaginationBodySchema = z.object({
  pageSize: z
    .number()
    .int()
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize must be at most 100')
    .optional(),
  pageCursor: z.string().min(1, 'pageCursor cannot be empty').optional(),
})

const vantaListBaseBodySchema = vantaBaseBodySchema.extend(vantaPaginationBodySchema.shape)

const requiredId = (label: string) => z.string().trim().min(1, `${label} is required`)

const listFrameworksSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_frameworks'),
})

const getFrameworkSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_framework'),
  frameworkId: requiredId('Framework ID'),
})

const listFrameworkControlsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_framework_controls'),
  frameworkId: requiredId('Framework ID'),
})

const listControlsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_controls'),
  frameworkMatchesAny: z.string().optional(),
})

const getControlSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_control'),
  controlId: requiredId('Control ID'),
})

const listControlTestsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_control_tests'),
  controlId: requiredId('Control ID'),
})

const listControlDocumentsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_control_documents'),
  controlId: requiredId('Control ID'),
})

const listTestsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_tests'),
  statusFilter: z
    .enum(['OK', 'DEACTIVATED', 'NEEDS_ATTENTION', 'IN_PROGRESS', 'INVALID', 'NOT_APPLICABLE'])
    .optional(),
  frameworkFilter: z.string().optional(),
  integrationFilter: z.string().optional(),
  controlFilter: z.string().optional(),
  ownerFilter: z.string().optional(),
  categoryFilter: z
    .enum([
      'ACCOUNTS_ACCESS',
      'ACCOUNT_SECURITY',
      'ACCOUNT_SETUP',
      'COMPUTERS',
      'CUSTOM',
      'DATA_STORAGE',
      'EMPLOYEES',
      'INFRASTRUCTURE',
      'IT',
      'LOGGING',
      'MONITORING_ALERTS',
      'PEOPLE',
      'POLICIES',
      'RISK_ANALYSIS',
      'SECURITY_ALERT_MANAGEMENT',
      'SOFTWARE_DEVELOPMENT',
      'VENDORS',
      'VULNERABILITY_MANAGEMENT',
    ])
    .optional(),
  isInRollout: z.boolean().optional(),
})

const getTestSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_test'),
  testId: requiredId('Test ID'),
})

const listTestEntitiesSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_test_entities'),
  testId: requiredId('Test ID'),
  entityStatus: z.enum(['FAILING', 'DEACTIVATED']).optional(),
})

const listDocumentsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_documents'),
  frameworkMatchesAny: z.string().optional(),
  statusMatchesAny: z.string().optional(),
})

const getDocumentSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_document'),
  documentId: requiredId('Document ID'),
})

const listDocumentUploadsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_document_uploads'),
  documentId: requiredId('Document ID'),
})

const submitDocumentSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_submit_document'),
  documentId: requiredId('Document ID'),
})

const listPeopleSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_people'),
  emailAndNameFilter: z.string().optional(),
  employmentStatus: z.enum(['UPCOMING', 'CURRENT', 'ON_LEAVE', 'INACTIVE', 'FORMER']).optional(),
  groupIdsMatchesAny: z.string().optional(),
  tasksSummaryStatusMatchesAny: z.string().optional(),
  taskTypeMatchesAny: z.string().optional(),
  taskStatusMatchesAny: z.string().optional(),
})

const getPersonSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_person'),
  personId: requiredId('Person ID'),
})

const listPoliciesSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_policies'),
})

const getPolicySchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_policy'),
  policyId: requiredId('Policy ID'),
})

const listVendorsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_vendors'),
  name: z.string().optional(),
  statusMatchesAny: z.string().optional(),
})

const getVendorSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_vendor'),
  vendorId: requiredId('Vendor ID'),
})

const listMonitoredComputersSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_monitored_computers'),
  complianceStatusFilterMatchesAny: z.string().optional(),
})

const listVulnerabilitiesSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_vulnerabilities'),
  q: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  isFixAvailable: z.boolean().optional(),
  isDeactivated: z.boolean().optional(),
  includeVulnerabilitiesWithoutSlas: z.boolean().optional(),
  packageIdentifier: z.string().optional(),
  externalVulnerabilityId: z.string().optional(),
  integrationId: z.string().optional(),
  vulnerableAssetId: z.string().optional(),
  slaDeadlineAfterDate: z.string().optional(),
  slaDeadlineBeforeDate: z.string().optional(),
})

const listVulnerabilityRemediationsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_vulnerability_remediations'),
  integrationId: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  isRemediatedOnTime: z.boolean().optional(),
  remediatedAfterDate: z.string().optional(),
  remediatedBeforeDate: z.string().optional(),
})

const listVulnerableAssetsSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_vulnerable_assets'),
  q: z.string().optional(),
  integrationId: z.string().optional(),
  assetType: z
    .enum([
      'SERVER',
      'SERVERLESS_FUNCTION',
      'CONTAINER',
      'CONTAINER_REPOSITORY',
      'CONTAINER_REPOSITORY_IMAGE',
      'CODE_REPOSITORY',
      'MANIFEST_FILE',
      'WORKSTATION',
      'OTHER',
    ])
    .optional(),
  assetExternalAccountId: z.string().optional(),
})

const getVulnerableAssetSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_vulnerable_asset'),
  vulnerableAssetId: requiredId('Vulnerable asset ID'),
})

const listRiskScenariosSchema = vantaListBaseBodySchema.extend({
  operation: z.literal('vanta_list_risk_scenarios'),
  searchString: z.string().optional(),
  includeIgnored: z.boolean().optional(),
  type: z.enum(['Risk Scenario', 'Enterprise Risk']).optional(),
  ownerMatchesAny: z.string().optional(),
  categoryMatchesAny: z.string().optional(),
  ciaCategoryMatchesAny: z.string().optional(),
  treatmentTypeMatchesAny: z.string().optional(),
  inherentScoreGroupMatchesAny: z.string().optional(),
  residualScoreGroupMatchesAny: z.string().optional(),
  reviewStatusMatchesAny: z.string().optional(),
  orderBy: z.enum(['description', 'createdAt']).optional(),
})

const getRiskScenarioSchema = vantaBaseBodySchema.extend({
  operation: z.literal('vanta_get_risk_scenario'),
  riskScenarioId: requiredId('Risk scenario ID'),
})

export const vantaQueryBodySchema = z.discriminatedUnion('operation', [
  listFrameworksSchema,
  getFrameworkSchema,
  listFrameworkControlsSchema,
  listControlsSchema,
  getControlSchema,
  listControlTestsSchema,
  listControlDocumentsSchema,
  listTestsSchema,
  getTestSchema,
  listTestEntitiesSchema,
  listDocumentsSchema,
  getDocumentSchema,
  listDocumentUploadsSchema,
  submitDocumentSchema,
  listPeopleSchema,
  getPersonSchema,
  listPoliciesSchema,
  getPolicySchema,
  listVendorsSchema,
  getVendorSchema,
  listMonitoredComputersSchema,
  listVulnerabilitiesSchema,
  listVulnerabilityRemediationsSchema,
  listVulnerableAssetsSchema,
  getVulnerableAssetSchema,
  listRiskScenariosSchema,
  getRiskScenarioSchema,
])

const vantaQueryOutputSchema = z.union([
  z.object({ frameworks: z.array(vantaFrameworkSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ framework: vantaFrameworkDetailSchema }),
  z.object({ controls: z.array(vantaControlSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ control: vantaControlDetailSchema }),
  z.object({ tests: z.array(vantaTestSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ test: vantaTestSchema }),
  z.object({ entities: z.array(vantaTestEntitySchema), pageInfo: vantaPageInfoSchema }),
  z.object({ documents: z.array(vantaDocumentSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ document: vantaDocumentDetailSchema }),
  z.object({ uploads: z.array(vantaUploadedFileSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ documentId: z.string(), submitted: z.boolean() }),
  z.object({ people: z.array(vantaPersonSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ person: vantaPersonSchema }),
  z.object({ policies: z.array(vantaPolicySchema), pageInfo: vantaPageInfoSchema }),
  z.object({ policy: vantaPolicySchema }),
  z.object({ vendors: z.array(vantaVendorSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ vendor: vantaVendorSchema }),
  z.object({ computers: z.array(vantaMonitoredComputerSchema), pageInfo: vantaPageInfoSchema }),
  z.object({
    vulnerabilities: z.array(vantaVulnerabilitySchema),
    pageInfo: vantaPageInfoSchema,
  }),
  z.object({
    remediations: z.array(vantaVulnerabilityRemediationSchema),
    pageInfo: vantaPageInfoSchema,
  }),
  z.object({ assets: z.array(vantaVulnerableAssetSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ asset: vantaVulnerableAssetSchema }),
  z.object({ riskScenarios: z.array(vantaRiskScenarioSchema), pageInfo: vantaPageInfoSchema }),
  z.object({ riskScenario: vantaRiskScenarioSchema }),
])

const vantaQueryResponseSchema = z.object({
  success: z.literal(true),
  output: vantaQueryOutputSchema,
})

export const vantaQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/vanta/query',
  body: vantaQueryBodySchema,
  response: { mode: 'json', schema: vantaQueryResponseSchema },
})

const VANTA_MAX_UPLOAD_BYTES = 100 * 1024 * 1024
/** Base64 length of the largest allowed upload (4 chars per 3 bytes). */
const VANTA_MAX_UPLOAD_BASE64_LENGTH = Math.ceil(VANTA_MAX_UPLOAD_BYTES / 3) * 4

export const vantaUploadBodySchema = vantaBaseBodySchema.extend({
  documentId: requiredId('Document ID'),
  file: FileInputSchema.optional().nullable(),
  fileContent: z
    .string()
    .max(VANTA_MAX_UPLOAD_BASE64_LENGTH, 'fileContent exceeds the 100MB upload limit')
    .nullish(),
  fileName: z.string().nullish(),
  mimeType: z.string().nullish(),
  description: z.string().nullish(),
  effectiveAtDate: z.string().nullish(),
})

const vantaUploadResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({ upload: vantaUploadedFileSchema }),
})

export const vantaUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/vanta/upload',
  body: vantaUploadBodySchema,
  response: { mode: 'json', schema: vantaUploadResponseSchema },
})

export const vantaDownloadBodySchema = vantaBaseBodySchema.extend({
  documentId: requiredId('Document ID'),
  uploadedFileId: requiredId('Uploaded file ID'),
})

const vantaDownloadResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    file: z.object({
      name: z.string(),
      mimeType: z.string(),
      data: z.string(),
      size: z.number(),
    }),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
  }),
})

export const vantaDownloadContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/vanta/download',
  body: vantaDownloadBodySchema,
  response: { mode: 'json', schema: vantaDownloadResponseSchema },
})

export type VantaQueryBody = ContractBody<typeof vantaQueryContract>
export type VantaQueryBodyInput = ContractBodyInput<typeof vantaQueryContract>
export type VantaQueryResponse = ContractJsonResponse<typeof vantaQueryContract>
export type VantaUploadBody = ContractBody<typeof vantaUploadContract>
export type VantaUploadBodyInput = ContractBodyInput<typeof vantaUploadContract>
export type VantaUploadResponse = ContractJsonResponse<typeof vantaUploadContract>
export type VantaDownloadBody = ContractBody<typeof vantaDownloadContract>
export type VantaDownloadBodyInput = ContractBodyInput<typeof vantaDownloadContract>
export type VantaDownloadResponse = ContractJsonResponse<typeof vantaDownloadContract>
