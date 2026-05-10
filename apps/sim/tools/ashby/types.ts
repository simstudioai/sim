import type { ToolResponse } from '@/tools/types'

interface AshbyBaseParams {
  apiKey: string
}

export interface AshbyContactInfo {
  value: string
  type: string
  isPrimary: boolean
}

interface AshbySocialLink {
  type: string
  url: string
}

interface AshbyTag {
  id: string
  title: string
  isArchived: boolean
}

export interface AshbyFileHandle {
  id: string
  name: string
  handle: string
}

export interface AshbyCustomField {
  id: string | null
  title: string
  isPrivate: boolean
  valueLabel: string | null
  value: unknown
}

export interface AshbyUserSummary {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  globalRole: string | null
  isEnabled: boolean
  updatedAt: string | null
  managerId: string | null
}

export interface AshbySourceSummary {
  id: string
  title: string
  isArchived: boolean
  sourceType: {
    id: string
    title: string
    isArchived: boolean
  } | null
}

interface AshbyCandidateLocation {
  id: string | null
  locationSummary: string | null
  locationComponents: Array<{ type: string; name: string }>
}

export interface AshbyCandidate {
  id: string
  name: string
  primaryEmailAddress: AshbyContactInfo | null
  primaryPhoneNumber: AshbyContactInfo | null
  emailAddresses: AshbyContactInfo[]
  phoneNumbers: AshbyContactInfo[]
  socialLinks: AshbySocialLink[]
  linkedInUrl: string | null
  githubUrl: string | null
  profileUrl: string | null
  position: string | null
  company: string | null
  school: string | null
  timezone: string | null
  location: AshbyCandidateLocation | null
  tags: AshbyTag[]
  applicationIds: string[]
  customFields: AshbyCustomField[]
  resumeFileHandle: AshbyFileHandle | null
  fileHandles: AshbyFileHandle[]
  source: AshbySourceSummary | null
  creditedToUser: AshbyUserSummary | null
  fraudStatus: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface AshbyListCandidatesParams extends AshbyBaseParams {
  cursor?: string
  perPage?: number
  createdAfter?: string
}

export interface AshbyGetCandidateParams extends AshbyBaseParams {
  candidateId: string
}

export interface AshbyCreateCandidateParams extends AshbyBaseParams {
  name: string
  email?: string
  phoneNumber?: string
  linkedInUrl?: string
  githubUrl?: string
  website?: string
  sourceId?: string
  creditedToUserId?: string
  createdAt?: string
  alternateEmailAddresses?: string[]
}

export interface AshbySearchCandidatesParams extends AshbyBaseParams {
  name?: string
  email?: string
}

export interface AshbyListJobsParams extends AshbyBaseParams {
  cursor?: string
  perPage?: number
  status?: string
  createdAfter?: string
  openedAfter?: string
  openedBefore?: string
  closedAfter?: string
  closedBefore?: string
}

export interface AshbyGetJobParams extends AshbyBaseParams {
  jobId: string
}

export interface AshbyCreateNoteParams extends AshbyBaseParams {
  candidateId: string
  note: string
  noteType?: string
  sendNotifications?: boolean
  isPrivate?: boolean
  createdAt?: string
}

export interface AshbyListApplicationsParams extends AshbyBaseParams {
  cursor?: string
  perPage?: number
  status?: string
  jobId?: string
  candidateId?: string
  createdAfter?: string
}

export interface AshbyListCandidatesResponse extends ToolResponse {
  output: {
    candidates: AshbyCandidate[]
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export interface AshbyGetCandidateResponse extends ToolResponse {
  output: AshbyCandidate
}

export interface AshbyCreateCandidateResponse extends ToolResponse {
  output: AshbyCandidate
}

export interface AshbySearchCandidatesResponse extends ToolResponse {
  output: {
    candidates: AshbyCandidate[]
  }
}

interface AshbyJobLocation {
  id: string | null
  name: string | null
  externalName: string | null
  isArchived: boolean
  isRemote: boolean
  workplaceType: string | null
  parentLocationId: string | null
  type: string | null
  address: {
    addressCountry: string | null
    addressRegion: string | null
    addressLocality: string | null
    postalCode: string | null
    streetAddress: string | null
  } | null
}

export interface AshbyHiringTeamMember {
  email: string | null
  firstName: string | null
  lastName: string | null
  role: string | null
  userId: string | null
}

export interface AshbyOpeningLatestVersion {
  id: string | null
  identifier: string | null
  description: string | null
  authorId: string | null
  createdAt: string | null
  teamId: string | null
  jobIds: string[]
  targetHireDate: string | null
  targetStartDate: string | null
  isBackfill: boolean
  employmentType: string | null
  locationIds: string[]
  hiringTeam: AshbyHiringTeamMember[]
  customFields: AshbyCustomField[]
}

export interface AshbyOpening {
  id: string
  openedAt: string | null
  closedAt: string | null
  isArchived: boolean
  archivedAt: string | null
  closeReasonId: string | null
  openingState: string | null
  latestVersion: AshbyOpeningLatestVersion | null
}

interface AshbyJobCompensationTier {
  id: string | null
  title: string | null
  additionalInformation: string | null
  tierSummary: string | null
}

export interface AshbyJob {
  id: string
  title: string
  confidential: boolean
  status: string | null
  employmentType: string | null
  locationId: string | null
  departmentId: string | null
  defaultInterviewPlanId: string | null
  interviewPlanIds: string[]
  customFields: AshbyCustomField[]
  jobPostingIds: string[]
  customRequisitionId: string | null
  brandId: string | null
  hiringTeam: AshbyHiringTeamMember[]
  author: AshbyUserSummary | null
  createdAt: string | null
  updatedAt: string | null
  openedAt: string | null
  closedAt: string | null
  location: AshbyJobLocation | null
  openings: AshbyOpening[]
  compensation: {
    compensationTiers: AshbyJobCompensationTier[]
  } | null
}

export interface AshbyListJobsResponse extends ToolResponse {
  output: {
    jobs: AshbyJob[]
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export interface AshbyGetJobResponse extends ToolResponse {
  output: AshbyJob
}

interface AshbyNote {
  id: string
  createdAt: string | null
  isPrivate: boolean
  content: string | null
  author: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
  } | null
}

export interface AshbyCreateNoteResponse extends ToolResponse {
  output: AshbyNote
}

interface AshbyApplicationCandidate {
  id: string
  name: string | null
  primaryEmailAddress: AshbyContactInfo | null
  primaryPhoneNumber: AshbyContactInfo | null
}

interface AshbyApplicationJob {
  id: string
  title: string | null
  locationId: string | null
  departmentId: string | null
}

interface AshbyApplicationStage {
  id: string
  title: string | null
  type: string | null
  orderInInterviewPlan: number | null
  interviewStageGroupId: string | null
  interviewPlanId: string | null
}

interface AshbyApplicationArchiveReason {
  id: string
  text: string | null
  reasonType: string | null
  isArchived: boolean
  customFields: AshbyCustomField[]
}

interface AshbyApplicationHistoryEntry {
  id: string
  stageId: string | null
  stageNumber: number | null
  title: string | null
  enteredStageAt: string | null
  actorId: string | null
}

export interface AshbyApplication {
  id: string
  createdAt: string | null
  updatedAt: string | null
  status: string
  customFields: AshbyCustomField[]
  candidate: AshbyApplicationCandidate
  currentInterviewStage: AshbyApplicationStage | null
  source: AshbySourceSummary | null
  archiveReason: AshbyApplicationArchiveReason | null
  archivedAt: string | null
  job: AshbyApplicationJob
  creditedToUser: AshbyUserSummary | null
  hiringTeam: AshbyHiringTeamMember[]
  appliedViaJobPostingId: string | null
  submitterClientIp: string | null
  submitterUserAgent: string | null
  applicationHistory: AshbyApplicationHistoryEntry[]
}

export interface AshbyListApplicationsResponse extends ToolResponse {
  output: {
    applications: AshbyApplication[]
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export interface AshbyOfferVersion {
  id: string | null
  startDate: string | null
  salary: { currencyCode: string | null; value: number | null } | null
  createdAt: string | null
  openingId: string | null
  customFields: AshbyCustomField[]
  fileHandles: AshbyFileHandle[]
  author: AshbyUserSummary | null
  approvalStatus: string | null
}

export interface AshbyOffer {
  id: string
  decidedAt: string | null
  applicationId: string | null
  acceptanceStatus: string | null
  offerStatus: string | null
  latestVersion: AshbyOfferVersion | null
}
