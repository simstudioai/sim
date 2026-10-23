import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface CheckrWorkLocation {
  country: string | null
  state: string | null
  city: string | null
}

export interface CheckrCandidate {
  id: string
  uri: string | null
  createdAt: string | null
  firstName: string | null
  middleName: string | null
  noMiddleName: boolean | null
  lastName: string | null
  motherMaidenName: string | null
  email: string | null
  phone: string | null
  zipcode: string | null
  dob: string | null
  ssn: string | null
  driverLicenseNumber: string | null
  driverLicenseState: string | null
  previousDriverLicenseNumber: string | null
  previousDriverLicenseState: string | null
  copyRequested: boolean | null
  customId: string | null
  adjudication: string | null
  reportIds: string[]
  geoIds: string[]
  postalAddress: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

export interface CheckrInvitation {
  id: string
  uri: string | null
  invitationUrl: string | null
  status: string | null
  createdAt: string | null
  expiresAt: string | null
  completedAt: string | null
  deletedAt: string | null
  package: string | null
  candidateId: string | null
  reportId: string | null
  archived: boolean | null
  archivedInfo: Record<string, unknown> | null
}

export interface CheckrReport {
  id: string
  uri: string | null
  status: string | null
  result: string | null
  adjudication: string | null
  assessment: string | null
  package: string | null
  source: string | null
  candidateId: string | null
  includesCanceled: boolean | null
  createdAt: string | null
  completedAt: string | null
  revisedAt: string | null
  upgradedAt: string | null
  turnaroundTime: number | null
  estimatedCompletionTime: string | null
  archived: boolean | null
  programId: string | null
  segmentStamps: string[]
  workLocations: CheckrWorkLocation[]
  geoIds: string[]
  documentIds: string[]
  candidateStoryIds: string[]
  ssnTraceId: string | null
  sexOffenderSearchId: string | null
  nationalCriminalSearchId: string | null
  globalWatchlistSearchId: string | null
  federalCriminalSearchId: string | null
  federalDistrictCriminalSearchId: string | null
  federalCivilSearchId: string | null
  federalDistrictCivilSearchId: string | null
  motorVehicleReportId: string | null
  drugScreeningId: string | null
  facisSearchId: string | null
  socialMediaScreeningsId: string | null
  identityVerificationId: string | null
  drugAlcoholClearinghouseId: string | null
  identityDataEvaluationId: string | null
  occupationalHealthScreeningId: string | null
  arrestSearchId: string | null
  internationalGlobalWatchlistSearchId: string | null
  internationalEducationVerificationId: string | null
  internationalEmploymentVerificationId: string | null
  internationalIdentityDocumentValidationId: string | null
  internationalCriminalSearchIds: string[]
  internationalAdverseMediaSearchIds: string[]
  countyCriminalSearchIds: string[]
  stateCriminalSearchIds: string[]
  professionalLicenseVerificationIds: string[]
  personalReferenceVerificationIds: string[]
  professionalReferenceVerificationIds: string[]
  drugScreening: Record<string, unknown> | null
}

export interface CheckrAdverseItem {
  id: string
  text: string | null
  assessment: Record<string, unknown> | null
}

export interface CheckrAdverseAction {
  id: string
  uri: string | null
  status: string | null
  reportId: string | null
  createdAt: string | null
  canceledAt: string | null
  postNoticeScheduledAt: string | null
  postNoticeReadyAt: string | null
  individualizedAssessmentEngaged: boolean | null
  context: string | null
  delivery: { state: string | null; reason: string | null; updatedAt: string | null } | null
  adverseItems: CheckrAdverseItem[]
  events: Array<{
    id: string | null
    type: string | null
    time: string | null
    trigger: string | null
    user: string | null
  }>
}

export interface CheckrPackage {
  id: string
  uri: string | null
  name: string | null
  slug: string | null
  price: number | null
  applyUrl: string | null
  createdAt: string | null
  deletedAt: string | null
  screenings: Array<{ type: string | null; subtype: string | null }>
}

export interface CheckrGeo {
  id: string
  uri: string | null
  name: string | null
  city: string | null
  state: string | null
  createdAt: string | null
  deletedAt: string | null
}

export interface CheckrNode {
  customId: string
  name: string | null
  tier: string | null
  parentCustomId: string | null
  packages: string[]
}

export interface CheckrProgram {
  id: string
  name: string | null
  createdAt: string | null
  deletedAt: string | null
  packageIds: string[]
  geoIds: string[]
}

export interface CheckrSubscription {
  id: string
  uri: string | null
  status: string | null
  package: string | null
  candidateId: string | null
  intervalCount: number | null
  intervalUnit: string | null
  startDate: string | null
  nextOccurrenceDate: string | null
  createdAt: string | null
  canceledAt: string | null
  node: string | null
  workLocations: CheckrWorkLocation[]
}

export interface CheckrContinuousCheck {
  id: string
  type: string | null
  candidateId: string | null
  createdAt: string | null
  node: string | null
  workLocations: CheckrWorkLocation[]
}

export interface CheckrVerification {
  id: string
  uri: string | null
  verificationType: string | null
  verificationUrl: string | null
  reportId: string | null
  createdAt: string | null
  completedAt: string | null
  processedAt: string | null
}

export interface CheckrDocument {
  id: string
  type: string | null
  filename: string | null
  contentType: string | null
  filesize: number | null
  downloadUri: string | null
  locale: string | null
  createdAt: string | null
}

interface CheckrListMeta {
  count: number | null
  nextHref: string | null
  previousHref: string | null
}

interface CheckrBaseParams {
  apiKey: string
}

interface CheckrPaginationParams {
  page?: number
  perPage?: number
}

interface CheckrHierarchyParams {
  node?: string
  workLocations?: unknown
}

export type CheckrGetAccountParams = CheckrBaseParams

export interface CheckrGetAccountResponse extends ToolResponse {
  output: {
    account: {
      id: string
      name: string | null
      uriName: string | null
      purpose: string | null
      authorized: boolean | null
      apiAuthorized: boolean | null
      geosRequired: boolean | null
      segmentationEnabled: boolean | null
      availableScreenings: string[]
      adverseActionEmail: string | null
      billingEmail: string | null
      complianceContactEmail: string | null
      technicalContactEmail: string | null
      supportEmail: string | null
      supportPhone: string | null
      defaultComplianceCity: string | null
      defaultComplianceState: string | null
      createdAt: string | null
      company: Record<string, unknown> | null
      accountDeauthorization: Record<string, unknown> | null
    }
  }
}

export type CheckrListUsersParams = CheckrBaseParams & CheckrPaginationParams

export interface CheckrListUsersResponse extends ToolResponse {
  output: CheckrListMeta & {
    users: Array<{
      id: string
      email: string | null
      fullName: string | null
      createdAt: string | null
      roles: string[]
    }>
  }
}

export interface CheckrCandidateFieldParams {
  firstName?: string
  middleName?: string
  noMiddleName?: boolean
  lastName?: string
  motherMaidenName?: string
  email?: string
  phone?: string
  zipcode?: string
  dob?: string
  ssn?: string
  driverLicenseNumber?: string
  driverLicenseState?: string
  previousDriverLicenseNumber?: string
  previousDriverLicenseState?: string
  copyRequested?: boolean
  customId?: string
  geoIds?: unknown
  metadata?: unknown
  postalAddress?: unknown
}

export interface CheckrCreateCandidateParams extends CheckrBaseParams, CheckrCandidateFieldParams {
  email: string
  workLocations?: unknown
}

export interface CheckrUpdateCandidateParams extends CheckrBaseParams, CheckrCandidateFieldParams {
  candidateId: string
}

export interface CheckrCandidateIdParams extends CheckrBaseParams {
  candidateId: string
}

export interface CheckrDeleteCandidatePiiParams extends CheckrCandidateIdParams {
  deletionContactEmail: string
  deletionContactFirstName?: string
  deletionContactLastName?: string
}

export interface CheckrCandidateResponse extends ToolResponse {
  output: { candidate: CheckrCandidate }
}

export interface CheckrListCandidatesParams extends CheckrBaseParams, CheckrPaginationParams {
  email?: string
  fullName?: string
  adjudication?: string
  customId?: string
  createdAfter?: string
  createdBefore?: string
  reportAdjudicatedAfter?: string
  reportAdjudicatedBefore?: string
  reportAdjudicatorEmail?: string
  reportRevisedAfter?: string
  reportRevisedBefore?: string
  driverLicenseNumber?: string
  geoId?: string
  programId?: string
}

export interface CheckrListCandidatesResponse extends ToolResponse {
  output: CheckrListMeta & { candidates: CheckrCandidate[] }
}

export interface CheckrCreateInvitationParams extends CheckrBaseParams, CheckrHierarchyParams {
  candidateId: string
  package: string
  tags?: unknown
}

export interface CheckrInvitationIdParams extends CheckrBaseParams {
  invitationId: string
}

export interface CheckrGetInvitationParams extends CheckrInvitationIdParams {
  includeDeleted?: boolean
}

export interface CheckrInvitationResponse extends ToolResponse {
  output: { invitation: CheckrInvitation }
}

export interface CheckrListInvitationsParams extends CheckrBaseParams, CheckrPaginationParams {
  candidateId?: string
  status?: string
}

export interface CheckrListInvitationsResponse extends ToolResponse {
  output: CheckrListMeta & { invitations: CheckrInvitation[] }
}

export interface CheckrCreateReportParams extends CheckrBaseParams, CheckrHierarchyParams {
  candidateId: string
  package: string
  tags?: unknown
  selfDisclosures?: unknown
}

export interface CheckrReportIdParams extends CheckrBaseParams {
  reportId: string
}

export interface CheckrUpdateReportParams extends CheckrReportIdParams {
  package?: string
  adjudication?: string
}

export interface CheckrReportResponse extends ToolResponse {
  output: { report: CheckrReport }
}

export interface CheckrGetReportEtaResponse extends ToolResponse {
  output: {
    estimateGeneratedAt: string | null
    estimatedCompletionTime: string | null
  }
}

export interface CheckrApplyReviewActionParams extends CheckrReportIdParams {
  decision: string
}

export interface CheckrApplyReviewActionResponse extends ToolResponse {
  output: { message: string | null }
}

export interface CheckrGetProgressiveStatusResponse extends ToolResponse {
  output: {
    report: { id: string | null; uri: string | null; status: string | null }
    progressiveContinuationStatus: string | null
    expiresAt: string | null
    checkpoints: Array<{
      position: number | null
      name: string | null
      status: string | null
      productKeys: string[]
      userReview: {
        status: string | null
        decision: string | null
        expired: boolean | null
        pausedAt: string | null
      } | null
    }>
  }
}

export interface CheckrReportTagParams extends CheckrReportIdParams {
  tag: string
}

export interface CheckrSetReportTagsParams extends CheckrReportIdParams {
  tags: unknown
}

export interface CheckrReportTagsResponse extends ToolResponse {
  output: { tags: string[]; count: number | null }
}

export interface CheckrListAdverseItemsResponse extends ToolResponse {
  output: { adverseItems: CheckrAdverseItem[]; count: number | null }
}

export interface CheckrListAssessmentsResponse extends ToolResponse {
  output: {
    assessments: Array<{
      value: string | null
      createdAt: string | null
      ruleset: Record<string, unknown> | null
      results: Array<Record<string, unknown>>
    }>
    count: number | null
  }
}

export interface CheckrListVerificationsResponse extends ToolResponse {
  output: { verifications: CheckrVerification[]; count: number | null }
}

export interface CheckrGetVerificationParams extends CheckrBaseParams {
  verificationId: string
}

export interface CheckrVerificationResponse extends ToolResponse {
  output: { verification: CheckrVerification }
}

export type CheckrListReportAddressesParams = CheckrReportIdParams & CheckrPaginationParams

export interface CheckrListReportAddressesResponse extends ToolResponse {
  output: {
    addresses: Array<{
      name: string | null
      city: string | null
      state: string | null
      startDate: string | null
      endDate: string | null
    }>
    count: number | null
  }
}

export interface CheckrCreateAdverseActionParams extends CheckrReportIdParams {
  adverseItemIds: unknown
  postNoticeScheduledAt?: string
  context?: string
  medium?: unknown
}

export interface CheckrListAdverseActionsParams extends CheckrReportIdParams {
  context?: string
}

export interface CheckrAdverseActionIdParams extends CheckrBaseParams {
  adverseActionId: string
}

export interface CheckrAdverseActionResponse extends ToolResponse {
  output: { adverseAction: CheckrAdverseAction }
}

export interface CheckrListAdverseActionsResponse extends ToolResponse {
  output: CheckrListMeta & { adverseActions: CheckrAdverseAction[] }
}

export type CheckrListPackagesParams = CheckrBaseParams & CheckrPaginationParams

export interface CheckrPackageIdParams extends CheckrBaseParams {
  packageId: string
}

export interface CheckrPackageResponse extends ToolResponse {
  output: { package: CheckrPackage }
}

export interface CheckrListPackagesResponse extends ToolResponse {
  output: CheckrListMeta & { packages: CheckrPackage[] }
}

export interface CheckrListGeosParams extends CheckrBaseParams, CheckrPaginationParams {
  name?: string
  state?: string
}

export interface CheckrCreateGeoParams extends CheckrBaseParams {
  name: string
  state: string
  city?: string
}

export interface CheckrGeoIdParams extends CheckrBaseParams {
  geoId: string
}

export interface CheckrUpdateGeoParams extends CheckrGeoIdParams {
  city: string
}

export interface CheckrGeoResponse extends ToolResponse {
  output: { geo: CheckrGeo }
}

export interface CheckrDeleteGeoResponse extends ToolResponse {
  output: { deleted: boolean; geoId: string }
}

export interface CheckrListGeosResponse extends ToolResponse {
  output: CheckrListMeta & { geos: CheckrGeo[] }
}

export interface CheckrListNodesParams extends CheckrBaseParams, CheckrPaginationParams {
  includePackages?: boolean
  orderBy?: string
  order?: string
}

export interface CheckrGetNodeParams extends CheckrBaseParams {
  nodeCustomId: string
  includePackages?: boolean
}

export interface CheckrNodeResponse extends ToolResponse {
  output: { node: CheckrNode }
}

export interface CheckrListNodesResponse extends ToolResponse {
  output: CheckrListMeta & { nodes: CheckrNode[] }
}

export interface CheckrListProgramsParams extends CheckrBaseParams, CheckrPaginationParams {
  name?: string
}

export interface CheckrProgramIdParams extends CheckrBaseParams {
  programId: string
}

export interface CheckrProgramResponse extends ToolResponse {
  output: { program: CheckrProgram }
}

export interface CheckrListProgramsResponse extends ToolResponse {
  output: CheckrListMeta & { programs: CheckrProgram[] }
}

export interface CheckrCreateSubscriptionParams extends CheckrBaseParams, CheckrHierarchyParams {
  candidateId: string
  package: string
  startDate: string
  intervalCount?: number
  intervalUnit?: string
}

export interface CheckrUpdateSubscriptionParams extends CheckrBaseParams, CheckrHierarchyParams {
  subscriptionId: string
  package?: string
  startDate?: string
  intervalCount?: number
  intervalUnit?: string
}

export interface CheckrSubscriptionIdParams extends CheckrBaseParams {
  subscriptionId: string
}

export interface CheckrListSubscriptionsParams extends CheckrBaseParams, CheckrPaginationParams {
  candidateId?: string
  status?: string
  createdAfter?: string
  createdBefore?: string
}

export interface CheckrSubscriptionResponse extends ToolResponse {
  output: { subscription: CheckrSubscription }
}

export interface CheckrListSubscriptionsResponse extends ToolResponse {
  output: CheckrListMeta & { subscriptions: CheckrSubscription[] }
}

export interface CheckrCreateContinuousCheckParams extends CheckrBaseParams, CheckrHierarchyParams {
  candidateId: string
  continuousCheckType: string
  mvrEnrollmentType?: string
}

export interface CheckrUpdateContinuousCheckParams extends CheckrBaseParams, CheckrHierarchyParams {
  continuousCheckId: string
}

export interface CheckrContinuousCheckIdParams extends CheckrBaseParams {
  continuousCheckId: string
}

export interface CheckrContinuousCheckResponse extends ToolResponse {
  output: { continuousCheck: CheckrContinuousCheck }
}

export interface CheckrListContinuousChecksResponse extends ToolResponse {
  output: { continuousChecks: CheckrContinuousCheck[]; count: number | null }
}

export interface CheckrListCandidateDocumentsParams extends CheckrCandidateIdParams {
  documentTypes?: unknown
}

export interface CheckrListDocumentsResponse extends ToolResponse {
  output: { documents: CheckrDocument[]; count: number | null }
}

export interface CheckrGetDocumentParams extends CheckrBaseParams {
  documentId: string
}

export interface CheckrDocumentResponse extends ToolResponse {
  output: { document: CheckrDocument }
}

export interface CheckrListCountiesParams extends CheckrBaseParams {
  states?: string
}

export interface CheckrListCountiesResponse extends ToolResponse {
  output: {
    counties: Array<{ state: string; name: string | null; fipsCode: string | null }>
  }
}

export interface CheckrGetScreeningParams extends CheckrBaseParams {
  screeningType: string
  screeningId: string
}

export interface CheckrGetScreeningResponse extends ToolResponse {
  output: {
    screening: {
      id: string
      object: string | null
      uri: string | null
      status: string | null
      result: string | null
      assessment: string | null
      createdAt: string | null
      completedAt: string | null
      turnaroundTime: number | null
      estimatedCompletionTime: string | null
      cancellationReason: string | null
      cancellationReasonDescription: string | null
      records: Array<Record<string, unknown>>
      details: Record<string, unknown>
    }
  }
}

export const LIST_META_OUTPUTS = {
  count: { type: 'number', description: 'Total number of matching records', nullable: true },
  nextHref: {
    type: 'string',
    description: 'URL of the next page of results, if any',
    nullable: true,
  },
  previousHref: {
    type: 'string',
    description: 'URL of the previous page of results, if any',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

const WORK_LOCATION_ITEM = {
  type: 'object',
  properties: {
    country: { type: 'string', description: 'Country (ISO 3166-1 alpha-2)', nullable: true },
    state: { type: 'string', description: 'Two-letter state code', nullable: true },
    city: { type: 'string', description: 'City name', nullable: true },
  },
} as const

export const CANDIDATE_PROPERTIES = {
  id: { type: 'string', description: 'Candidate ID' },
  uri: { type: 'string', description: 'Candidate API URI', nullable: true },
  createdAt: { type: 'string', description: 'Time the candidate was created', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  middleName: { type: 'string', description: 'Middle name', nullable: true },
  noMiddleName: {
    type: 'boolean',
    description: 'Whether the candidate has no middle name',
    nullable: true,
  },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  motherMaidenName: { type: 'string', description: "Mother's maiden name", nullable: true },
  email: { type: 'string', description: 'Email address', nullable: true },
  phone: { type: 'string', description: 'Phone number', nullable: true },
  zipcode: { type: 'string', description: '5-digit zip code', nullable: true },
  dob: { type: 'string', description: 'Date of birth (YYYY-MM-DD)', nullable: true },
  ssn: {
    type: 'string',
    description: 'Social Security Number, redacted to the last four digits',
    nullable: true,
  },
  driverLicenseNumber: { type: 'string', description: 'Driver license number', nullable: true },
  driverLicenseState: {
    type: 'string',
    description: 'Driver license issuing state (ISO 3166-2:US)',
    nullable: true,
  },
  previousDriverLicenseNumber: {
    type: 'string',
    description: 'Previous driver license number',
    nullable: true,
  },
  previousDriverLicenseState: {
    type: 'string',
    description: 'Previous driver license issuing state',
    nullable: true,
  },
  copyRequested: {
    type: 'boolean',
    description: 'Whether the candidate asked for a copy of their report',
    nullable: true,
  },
  customId: { type: 'string', description: 'Your own ID for the candidate', nullable: true },
  adjudication: {
    type: 'string',
    description:
      'Adjudication of the most recent report (engaged, pre_adverse_action, post_adverse_action)',
    nullable: true,
  },
  reportIds: {
    type: 'array',
    description: 'IDs of reports for this candidate',
    items: { type: 'string' },
  },
  geoIds: {
    type: 'array',
    description: 'IDs of geos assigned to this candidate',
    items: { type: 'string' },
  },
  postalAddress: {
    type: 'json',
    description: 'Postal address (name, street, street2, city, state, zipcode)',
    nullable: true,
  },
  metadata: { type: 'json', description: 'Custom key-value metadata', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const INVITATION_PROPERTIES = {
  id: { type: 'string', description: 'Invitation ID' },
  uri: { type: 'string', description: 'Invitation API URI', nullable: true },
  invitationUrl: {
    type: 'string',
    description: 'URL the candidate opens to complete the invitation',
    nullable: true,
  },
  status: { type: 'string', description: 'Status (pending, completed, expired)', nullable: true },
  createdAt: { type: 'string', description: 'Time the invitation was created', nullable: true },
  expiresAt: { type: 'string', description: 'Time the invitation expires', nullable: true },
  completedAt: {
    type: 'string',
    description: 'Time the candidate completed the invitation',
    nullable: true,
  },
  deletedAt: { type: 'string', description: 'Time the invitation was canceled', nullable: true },
  package: { type: 'string', description: 'Package slug for the invitation', nullable: true },
  candidateId: { type: 'string', description: 'Invited candidate ID', nullable: true },
  reportId: {
    type: 'string',
    description: 'ID of the report created once the invitation is completed',
    nullable: true,
  },
  archived: { type: 'boolean', description: 'Whether the invitation is archived', nullable: true },
  archivedInfo: {
    type: 'json',
    description: 'Archive details (time, user with email and id)',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const REPORT_PROPERTIES = {
  id: { type: 'string', description: 'Report ID' },
  uri: { type: 'string', description: 'Report API URI', nullable: true },
  status: {
    type: 'string',
    description: 'Status (pending, complete, suspended, paused, dispute, canceled)',
    nullable: true,
  },
  result: { type: 'string', description: 'Result (clear, consider)', nullable: true },
  adjudication: {
    type: 'string',
    description: 'Adjudication (engaged, pre_adverse_action, post_adverse_action)',
    nullable: true,
  },
  assessment: {
    type: 'string',
    description: 'Assess result (eligible, review, escalated) for Assess-enabled accounts',
    nullable: true,
  },
  package: { type: 'string', description: 'Package the report was ordered with', nullable: true },
  source: {
    type: 'string',
    description:
      'How the report was created (api, continuous_check, form, manual_order, recurrence, web)',
    nullable: true,
  },
  candidateId: { type: 'string', description: 'Screened candidate ID', nullable: true },
  includesCanceled: {
    type: 'boolean',
    description: 'Whether the report includes a canceled screening',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'Time the report was created', nullable: true },
  completedAt: { type: 'string', description: 'Time the report was completed', nullable: true },
  revisedAt: { type: 'string', description: 'Time the report was revised', nullable: true },
  upgradedAt: { type: 'string', description: 'Time the report was upgraded', nullable: true },
  turnaroundTime: {
    type: 'number',
    description: 'Seconds from creation to completion',
    nullable: true,
  },
  estimatedCompletionTime: {
    type: 'string',
    description: 'Predicted completion date',
    nullable: true,
  },
  archived: { type: 'boolean', description: 'Whether the report is archived', nullable: true },
  programId: { type: 'string', description: 'Program ID linked to the report', nullable: true },
  segmentStamps: {
    type: 'array',
    description: 'Hierarchy node tier|name stamps for the ordering node and its parents',
    items: { type: 'string' },
  },
  workLocations: {
    type: 'array',
    description: 'Work locations set when ordering the report',
    items: WORK_LOCATION_ITEM,
  },
  geoIds: { type: 'array', description: 'Geo IDs', items: { type: 'string' } },
  documentIds: { type: 'array', description: 'Document IDs', items: { type: 'string' } },
  candidateStoryIds: {
    type: 'array',
    description: 'Candidate story IDs linked to the report',
    items: { type: 'string' },
  },
  ssnTraceId: { type: 'string', description: 'SSN trace ID', nullable: true },
  sexOffenderSearchId: { type: 'string', description: 'Sex offender search ID', nullable: true },
  nationalCriminalSearchId: {
    type: 'string',
    description: 'National criminal search ID',
    nullable: true,
  },
  globalWatchlistSearchId: {
    type: 'string',
    description: 'Global watchlist search ID',
    nullable: true,
  },
  federalCriminalSearchId: {
    type: 'string',
    description: 'Federal criminal search ID',
    nullable: true,
  },
  federalDistrictCriminalSearchId: {
    type: 'string',
    description: 'Federal district criminal search ID',
    nullable: true,
  },
  federalCivilSearchId: { type: 'string', description: 'Federal civil search ID', nullable: true },
  federalDistrictCivilSearchId: {
    type: 'string',
    description: 'Federal district civil search ID',
    nullable: true,
  },
  motorVehicleReportId: { type: 'string', description: 'Motor vehicle report ID', nullable: true },
  drugScreeningId: { type: 'string', description: 'Drug screening ID', nullable: true },
  facisSearchId: { type: 'string', description: 'FACIS search ID', nullable: true },
  socialMediaScreeningsId: {
    type: 'string',
    description: 'Social media screening ID',
    nullable: true,
  },
  identityVerificationId: {
    type: 'string',
    description: 'Identity verification ID',
    nullable: true,
  },
  drugAlcoholClearinghouseId: {
    type: 'string',
    description: 'Drug & Alcohol Clearinghouse search ID',
    nullable: true,
  },
  identityDataEvaluationId: {
    type: 'string',
    description: 'Identity data evaluation ID',
    nullable: true,
  },
  occupationalHealthScreeningId: {
    type: 'string',
    description: 'Occupational health screening ID',
    nullable: true,
  },
  arrestSearchId: { type: 'string', description: 'Arrest search ID', nullable: true },
  internationalGlobalWatchlistSearchId: {
    type: 'string',
    description: 'International global watchlist search ID',
    nullable: true,
  },
  internationalEducationVerificationId: {
    type: 'string',
    description: 'International education verification ID',
    nullable: true,
  },
  internationalEmploymentVerificationId: {
    type: 'string',
    description: 'International employment verification ID',
    nullable: true,
  },
  internationalIdentityDocumentValidationId: {
    type: 'string',
    description: 'International identity document validation ID',
    nullable: true,
  },
  internationalCriminalSearchIds: {
    type: 'array',
    description: 'International criminal search IDs',
    items: { type: 'string' },
  },
  internationalAdverseMediaSearchIds: {
    type: 'array',
    description: 'International adverse media search IDs',
    items: { type: 'string' },
  },
  countyCriminalSearchIds: {
    type: 'array',
    description: 'County criminal search IDs',
    items: { type: 'string' },
  },
  stateCriminalSearchIds: {
    type: 'array',
    description: 'State criminal search IDs',
    items: { type: 'string' },
  },
  professionalLicenseVerificationIds: {
    type: 'array',
    description: 'Professional license verification IDs',
    items: { type: 'string' },
  },
  personalReferenceVerificationIds: {
    type: 'array',
    description: 'Personal reference verification IDs',
    items: { type: 'string' },
  },
  professionalReferenceVerificationIds: {
    type: 'array',
    description: 'Professional reference verification IDs',
    items: { type: 'string' },
  },
  drugScreening: {
    type: 'json',
    description:
      'Embedded drug screening (id, status, result, disposition, mro_notes, analytes, events, screening_pass_expires_at, appointment_id)',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

const ADVERSE_ITEM_ITEM = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Adverse item ID' },
    text: { type: 'string', description: 'Description of the adverse item', nullable: true },
    assessment: {
      type: 'json',
      description: 'Assess details (value, rule with name and type) when Assess is enabled',
      nullable: true,
    },
  },
} as const

export const ADVERSE_ITEMS_OUTPUT = {
  type: 'array',
  description: 'Adverse items that can be cited in an adverse action',
  items: ADVERSE_ITEM_ITEM,
} as const satisfies OutputProperty

export const ADVERSE_ACTION_PROPERTIES = {
  id: { type: 'string', description: 'Adverse action ID' },
  uri: { type: 'string', description: 'Adverse action API URI', nullable: true },
  status: {
    type: 'string',
    description: 'Status (pending, complete, dispute, canceled)',
    nullable: true,
  },
  reportId: {
    type: 'string',
    description: 'Report the adverse action is based on',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'Time the adverse action was created', nullable: true },
  canceledAt: {
    type: 'string',
    description: 'Time the adverse action was canceled',
    nullable: true,
  },
  postNoticeScheduledAt: {
    type: 'string',
    description: 'Time the post-adverse action notice is scheduled to send',
    nullable: true,
  },
  postNoticeReadyAt: {
    type: 'string',
    description: 'Earliest time the post-adverse action notice can be sent',
    nullable: true,
  },
  individualizedAssessmentEngaged: {
    type: 'boolean',
    description: 'Whether an individualized assessment was engaged',
    nullable: true,
  },
  context: {
    type: 'string',
    description: 'Scoping identifier for the adverse action',
    nullable: true,
  },
  delivery: {
    type: 'object',
    description: 'Notice delivery state',
    nullable: true,
    properties: {
      state: {
        type: 'string',
        description: 'Delivery state (none, queued, sent, delivered, error, unknown, unopened)',
        nullable: true,
      },
      reason: { type: 'string', description: 'Reason for the delivery state', nullable: true },
      updatedAt: { type: 'string', description: 'Time the delivery state changed', nullable: true },
    },
  },
  adverseItems: {
    type: 'array',
    description: 'Adverse items the action is based on',
    items: ADVERSE_ITEM_ITEM,
  },
  events: {
    type: 'array',
    description: 'Lifecycle events',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Event ID', nullable: true },
        type: { type: 'string', description: 'Event type (created, completed)', nullable: true },
        time: { type: 'string', description: 'Time of the event', nullable: true },
        trigger: { type: 'string', description: 'What triggered the event', nullable: true },
        user: { type: 'string', description: 'User who triggered the event', nullable: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const PACKAGE_PROPERTIES = {
  id: { type: 'string', description: 'Package ID' },
  uri: { type: 'string', description: 'Package API URI', nullable: true },
  name: { type: 'string', description: 'Package name', nullable: true },
  slug: { type: 'string', description: 'Package slug used when ordering reports', nullable: true },
  price: { type: 'number', description: 'Price in USD cents', nullable: true },
  applyUrl: {
    type: 'string',
    description: 'URL where candidates can apply with this package',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'Time the package was created', nullable: true },
  deletedAt: { type: 'string', description: 'Time the package was deleted', nullable: true },
  screenings: {
    type: 'array',
    description: 'Screenings included in the package',
    items: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Screening type', nullable: true },
        subtype: { type: 'string', description: 'Screening subtype', nullable: true },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const GEO_PROPERTIES = {
  id: { type: 'string', description: 'Geo ID' },
  uri: { type: 'string', description: 'Geo API URI', nullable: true },
  name: { type: 'string', description: 'Geo name', nullable: true },
  city: { type: 'string', description: 'City', nullable: true },
  state: { type: 'string', description: 'State', nullable: true },
  createdAt: { type: 'string', description: 'Time the geo was created', nullable: true },
  deletedAt: { type: 'string', description: 'Time the geo was deleted', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const NODE_PROPERTIES = {
  customId: { type: 'string', description: 'Node custom ID' },
  name: { type: 'string', description: 'Node name', nullable: true },
  tier: { type: 'string', description: 'Hierarchy tier label', nullable: true },
  parentCustomId: { type: 'string', description: 'Parent node custom ID', nullable: true },
  packages: {
    type: 'array',
    description: 'Package slugs visible to the node (when packages are included)',
    items: { type: 'string' },
  },
} as const satisfies Record<string, OutputProperty>

export const PROGRAM_PROPERTIES = {
  id: { type: 'string', description: 'Program ID' },
  name: { type: 'string', description: 'Program name', nullable: true },
  createdAt: { type: 'string', description: 'Time the program was created', nullable: true },
  deletedAt: { type: 'string', description: 'Time the program was deleted', nullable: true },
  packageIds: { type: 'array', description: 'Associated package IDs', items: { type: 'string' } },
  geoIds: { type: 'array', description: 'Associated geo IDs', items: { type: 'string' } },
} as const satisfies Record<string, OutputProperty>

export const SUBSCRIPTION_PROPERTIES = {
  id: { type: 'string', description: 'Subscription ID' },
  uri: { type: 'string', description: 'Subscription API URI', nullable: true },
  status: { type: 'string', description: 'Status (active, inactive)', nullable: true },
  package: { type: 'string', description: 'Package run on each occurrence', nullable: true },
  candidateId: { type: 'string', description: 'Screened candidate ID', nullable: true },
  intervalCount: {
    type: 'number',
    description: 'Number of intervals between checks',
    nullable: true,
  },
  intervalUnit: {
    type: 'string',
    description: 'Interval unit (day, week, month, year)',
    nullable: true,
  },
  startDate: { type: 'string', description: 'Date of the first check', nullable: true },
  nextOccurrenceDate: { type: 'string', description: 'Date of the next check', nullable: true },
  createdAt: { type: 'string', description: 'Time the subscription was created', nullable: true },
  canceledAt: {
    type: 'string',
    description: 'Time the subscription was canceled',
    nullable: true,
  },
  node: { type: 'string', description: 'Hierarchy node custom ID', nullable: true },
  workLocations: {
    type: 'array',
    description: 'Work locations used for each report',
    items: WORK_LOCATION_ITEM,
  },
} as const satisfies Record<string, OutputProperty>

export const CONTINUOUS_CHECK_PROPERTIES = {
  id: { type: 'string', description: 'Continuous check ID' },
  type: { type: 'string', description: 'Continuous check type (criminal, mvr)', nullable: true },
  candidateId: { type: 'string', description: 'Enrolled candidate ID', nullable: true },
  createdAt: {
    type: 'string',
    description: 'Time the continuous check was created',
    nullable: true,
  },
  node: { type: 'string', description: 'Hierarchy node custom ID', nullable: true },
  workLocations: {
    type: 'array',
    description: 'Work locations for the continuous check',
    items: WORK_LOCATION_ITEM,
  },
} as const satisfies Record<string, OutputProperty>

export const VERIFICATION_PROPERTIES = {
  id: { type: 'string', description: 'Verification ID' },
  uri: { type: 'string', description: 'Verification API URI', nullable: true },
  verificationType: {
    type: 'string',
    description: 'Verification type, such as id or ssn_confirmation',
    nullable: true,
  },
  verificationUrl: {
    type: 'string',
    description: 'URL where the candidate submits the requested information',
    nullable: true,
  },
  reportId: { type: 'string', description: 'Report ID', nullable: true },
  createdAt: { type: 'string', description: 'Time the verification was created', nullable: true },
  completedAt: {
    type: 'string',
    description: 'Time the candidate completed the verification',
    nullable: true,
  },
  processedAt: {
    type: 'string',
    description: 'Time the verification was processed',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const DOCUMENT_PROPERTIES = {
  id: { type: 'string', description: 'Document ID' },
  type: {
    type: 'string',
    description: 'Document type, such as driver_license or consent',
    nullable: true,
  },
  filename: { type: 'string', description: 'File name', nullable: true },
  contentType: { type: 'string', description: 'MIME type', nullable: true },
  filesize: { type: 'number', description: 'File size in bytes', nullable: true },
  downloadUri: {
    type: 'string',
    description: 'Temporary download URL, valid for 15 minutes',
    nullable: true,
  },
  locale: { type: 'string', description: 'Document locale', nullable: true },
  createdAt: { type: 'string', description: 'Time the document was created', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const TAGS_OUTPUTS = {
  tags: { type: 'array', description: 'Tag names on the report', items: { type: 'string' } },
  count: { type: 'number', description: 'Number of tags on the report', nullable: true },
} as const satisfies Record<string, OutputProperty>
