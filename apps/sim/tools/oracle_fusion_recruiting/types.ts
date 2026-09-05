import type * as Schemas from '@/lib/internal/oracle-fusion-recruiting/schema'
import type { ToolOutputProperty } from '@/tools/types'

export interface PageOutput {
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
  nextOffset?: number
}

const pageOutputs = {
  count: { type: 'number', description: 'Records returned in this page' },
  hasMore: { type: 'boolean', description: 'Whether more records are available' },
  limit: { type: 'number', description: 'Page size reported by Oracle' },
  offset: { type: 'number', description: 'Offset of this page' },
  nextOffset: { type: 'number', description: 'Offset for the next page', optional: true },
  totalResults: {
    type: 'number',
    description: 'Estimated total, when returned by Oracle',
    optional: true,
  },
} satisfies Record<string, ToolOutputProperty>

const candidateProperties = {
  candidateNumber: { type: 'string', description: 'Candidate Number' },
  personId: { type: 'string', description: 'Person Id', nullable: true },
  displayName: { type: 'string', description: 'Display Name', nullable: true },
  fullName: { type: 'string', description: 'Full Name', nullable: true },
  firstName: { type: 'string', description: 'First Name', nullable: true },
  lastName: { type: 'string', description: 'Last Name', nullable: true },
  middleNames: { type: 'string', description: 'Middle Names', nullable: true },
  email: { type: 'string', description: 'Email', nullable: true },
  candidateType: { type: 'string', description: 'Candidate Type', nullable: true },
  preferredLanguage: { type: 'string', description: 'Preferred Language', nullable: true },
  preferredTimezone: { type: 'string', description: 'Preferred Timezone', nullable: true },
  creationDate: { type: 'string', description: 'Creation Date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last Update Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const phoneProperties = {
  phoneId: { type: 'string', description: 'Phone Id' },
  phoneNumber: { type: 'string', description: 'Phone Number', nullable: true },
  countryCodeNumber: { type: 'string', description: 'Country Code Number', nullable: true },
  areaCode: { type: 'string', description: 'Area Code', nullable: true },
  legislationCode: { type: 'string', description: 'Legislation Code', nullable: true },
  phoneType: { type: 'string', description: 'Phone Type', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const educationProperties = {
  educationId: { type: 'string', description: 'Education Id' },
  degreeName: { type: 'string', description: 'Degree Name', nullable: true },
  major: { type: 'string', description: 'Major', nullable: true },
  minor: { type: 'string', description: 'Minor', nullable: true },
  educationalEstablishment: {
    type: 'string',
    description: 'Educational Establishment',
    nullable: true,
  },
  startDate: { type: 'string', description: 'Start Date', nullable: true },
  endDate: { type: 'string', description: 'End Date', nullable: true },
  graduatedFlag: { type: 'boolean', description: 'Graduated Flag', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const experienceProperties = {
  previousEmploymentId: { type: 'string', description: 'Previous Employment Id' },
  employerName: { type: 'string', description: 'Employer Name', nullable: true },
  jobTitle: { type: 'string', description: 'Job Title', nullable: true },
  startDate: { type: 'string', description: 'Start Date', nullable: true },
  endDate: { type: 'string', description: 'End Date', nullable: true },
  currentJobFlag: { type: 'boolean', description: 'Current Job Flag', nullable: true },
  department: { type: 'string', description: 'Department', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const skillProperties = {
  skillId: { type: 'string', description: 'Skill Id' },
  skill: { type: 'string', description: 'Skill', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  yearsOfExperience: { type: 'string', description: 'Years Of Experience', nullable: true },
  dateAchieved: { type: 'string', description: 'Date Achieved', nullable: true },
  speciality: { type: 'string', description: 'Speciality', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const attachmentProperties = {
  attachedDocumentId: { type: 'string', description: 'Attached Document Id' },
  fileName: { type: 'string', description: 'File Name', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  uploadedFileContentType: {
    type: 'string',
    description: 'Uploaded File Content Type',
    nullable: true,
  },
  uploadedFileLength: { type: 'number', description: 'Uploaded File Length', nullable: true },
  categoryName: { type: 'string', description: 'Category Name', nullable: true },
  creationDate: { type: 'string', description: 'Creation Date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last Update Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const requisitionProperties = {
  requisitionId: { type: 'string', description: 'Requisition Id' },
  requisitionNumber: { type: 'string', description: 'Requisition Number', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  recruitingType: { type: 'string', description: 'Recruiting Type', nullable: true },
  phaseId: { type: 'string', description: 'Phase Id', nullable: true },
  phaseName: { type: 'string', description: 'Phase Name', nullable: true },
  stateId: { type: 'string', description: 'State Id', nullable: true },
  stateName: { type: 'string', description: 'State Name', nullable: true },
  hiringManagerId: { type: 'string', description: 'Hiring Manager Id', nullable: true },
  recruiterId: { type: 'string', description: 'Recruiter Id', nullable: true },
  primaryLocationId: { type: 'string', description: 'Primary Location Id', nullable: true },
  businessUnitId: { type: 'string', description: 'Business Unit Id', nullable: true },
  departmentId: { type: 'string', description: 'Department Id', nullable: true },
  jobId: { type: 'string', description: 'Job Id', nullable: true },
  numberOfOpenings: { type: 'number', description: 'Number Of Openings', nullable: true },
  unlimitedOpenings: { type: 'string', description: 'Unlimited Openings', nullable: true },
  creationDate: { type: 'string', description: 'Creation Date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last Update Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const postingProperties = {
  publishedJobId: { type: 'string', description: 'Published Job Id' },
  postingStatus: { type: 'string', description: 'Posting Status', nullable: true },
  visibility: { type: 'string', description: 'Visibility', nullable: true },
  startDate: { type: 'string', description: 'Start Date', nullable: true },
  endDate: { type: 'string', description: 'End Date', nullable: true },
  timeZone: { type: 'string', description: 'Time Zone', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const applicationProperties = {
  jobApplicationId: { type: 'string', description: 'Job Application Id' },
  candidateName: { type: 'string', description: 'Candidate Name', nullable: true },
  candidatePersonId: { type: 'string', description: 'Candidate Person Id', nullable: true },
  requisitionId: { type: 'string', description: 'Requisition Id', nullable: true },
  requisitionNumber: { type: 'string', description: 'Requisition Number', nullable: true },
  phaseId: { type: 'string', description: 'Phase Id', nullable: true },
  phaseName: { type: 'string', description: 'Phase Name', nullable: true },
  stateId: { type: 'string', description: 'State Id', nullable: true },
  stateName: { type: 'string', description: 'State Name', nullable: true },
  confirmedFlag: { type: 'boolean', description: 'Confirmed Flag', nullable: true },
  disqualifiedFlag: { type: 'boolean', description: 'Disqualified Flag', nullable: true },
  internalFlag: { type: 'boolean', description: 'Internal Flag', nullable: true },
  jobApplicationDate: { type: 'string', description: 'Job Application Date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last Update Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const offerProperties = {
  offerId: { type: 'string', description: 'Offer Id' },
  offerName: { type: 'string', description: 'Offer Name', nullable: true },
  jobApplicationId: { type: 'string', description: 'Job Application Id', nullable: true },
  candidatePersonId: { type: 'string', description: 'Candidate Person Id', nullable: true },
  requisitionId: { type: 'string', description: 'Requisition Id', nullable: true },
  phaseId: { type: 'string', description: 'Phase Id', nullable: true },
  phaseName: { type: 'string', description: 'Phase Name', nullable: true },
  stateId: { type: 'string', description: 'State Id', nullable: true },
  stateName: { type: 'string', description: 'State Name', nullable: true },
  hireDate: { type: 'string', description: 'Hire Date', nullable: true },
  expirationDate: { type: 'string', description: 'Expiration Date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last Update Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const interviewScheduleProperties = {
  scheduleId: { type: 'string', description: 'Schedule Id' },
  scheduleCode: { type: 'string', description: 'Schedule Code', nullable: true },
  scheduleTitle: { type: 'string', description: 'Schedule Title', nullable: true },
  scheduleType: { type: 'string', description: 'Schedule Type', nullable: true },
  interviewType: { type: 'string', description: 'Interview Type', nullable: true },
  interviewTypeMeaning: { type: 'string', description: 'Interview Type Meaning', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
} satisfies Record<string, ToolOutputProperty>

const requisitionTemplateProperties = {
  requisitionId: { type: 'string', description: 'Requisition Id' },
  requisitionNumber: { type: 'string', description: 'Requisition Number', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  requisitionNameWithNumber: {
    type: 'string',
    description: 'Requisition Name With Number',
    nullable: true,
  },
} satisfies Record<string, ToolOutputProperty>

const representativeProperties = {
  personId: { type: 'string', description: 'Person Id' },
  personNumber: { type: 'string', description: 'Person Number', nullable: true },
  displayName: { type: 'string', description: 'Display Name', nullable: true },
  assignmentId: { type: 'string', description: 'Assignment Id', nullable: true },
  assignmentNumber: { type: 'string', description: 'Assignment Number', nullable: true },
  workEmailAddress: { type: 'string', description: 'Work Email Address', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListCandidatesParams = Omit<
  Schemas.ListCandidatesInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListCandidatesResponse {
  success: boolean
  output: PageOutput & { candidates: Schemas.Candidate[] }
}
export const LIST_CANDIDATES_OUTPUTS = {
  candidates: {
    type: 'array',
    description: 'Returned candidate records',
    items: { type: 'object', properties: candidateProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingGetCandidateParams = Omit<
  Schemas.GetCandidateInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingGetCandidateResponse {
  success: boolean
  output: { candidate: Schemas.Candidate }
}
export const GET_CANDIDATE_OUTPUTS = {
  candidate: { type: 'json', description: 'Returned candidate', properties: candidateProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingCreateCandidateParams = Omit<
  Schemas.CreateCandidateInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingCreateCandidateResponse {
  success: boolean
  output: { candidate: Schemas.Candidate }
}
export const CREATE_CANDIDATE_OUTPUTS = {
  candidate: { type: 'json', description: 'Returned candidate', properties: candidateProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingUpdateCandidateParams = Omit<
  Schemas.UpdateCandidateInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingUpdateCandidateResponse {
  success: boolean
  output: { candidate: Schemas.Candidate }
}
export const UPDATE_CANDIDATE_OUTPUTS = {
  candidate: { type: 'json', description: 'Returned candidate', properties: candidateProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingDeleteCandidateParams = Omit<
  Schemas.DeleteCandidateInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingDeleteCandidateResponse {
  success: boolean
  output: { deleted: boolean }
}
export const DELETE_CANDIDATE_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Whether Oracle confirmed the deletion' },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListCandidatePhonesParams = Omit<
  Schemas.ListCandidatePhonesInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListCandidatePhonesResponse {
  success: boolean
  output: PageOutput & { phones: Schemas.Phone[] }
}
export const LIST_CANDIDATE_PHONES_OUTPUTS = {
  phones: {
    type: 'array',
    description: 'Returned phone records',
    items: { type: 'object', properties: phoneProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingGetCandidatePhoneParams = Omit<
  Schemas.GetCandidatePhoneInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingGetCandidatePhoneResponse {
  success: boolean
  output: { phone: Schemas.Phone }
}
export const GET_CANDIDATE_PHONE_OUTPUTS = {
  phone: { type: 'json', description: 'Returned phone', properties: phoneProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingCreateCandidatePhoneParams = Omit<
  Schemas.CreateCandidatePhoneInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingCreateCandidatePhoneResponse {
  success: boolean
  output: { phone: Schemas.Phone }
}
export const CREATE_CANDIDATE_PHONE_OUTPUTS = {
  phone: { type: 'json', description: 'Returned phone', properties: phoneProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingUpdateCandidatePhoneParams = Omit<
  Schemas.UpdateCandidatePhoneInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingUpdateCandidatePhoneResponse {
  success: boolean
  output: { phone: Schemas.Phone }
}
export const UPDATE_CANDIDATE_PHONE_OUTPUTS = {
  phone: { type: 'json', description: 'Returned phone', properties: phoneProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingDeleteCandidatePhoneParams = Omit<
  Schemas.DeleteCandidatePhoneInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingDeleteCandidatePhoneResponse {
  success: boolean
  output: { deleted: boolean }
}
export const DELETE_CANDIDATE_PHONE_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Whether Oracle confirmed the deletion' },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListCandidateEducationParams = Omit<
  Schemas.ListCandidateEducationInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListCandidateEducationResponse {
  success: boolean
  output: PageOutput & { education: Schemas.Education[] }
}
export const LIST_CANDIDATE_EDUCATION_OUTPUTS = {
  education: {
    type: 'array',
    description: 'Returned education records',
    items: { type: 'object', properties: educationProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListCandidateExperienceParams = Omit<
  Schemas.ListCandidateExperienceInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListCandidateExperienceResponse {
  success: boolean
  output: PageOutput & { experience: Schemas.Experience[] }
}
export const LIST_CANDIDATE_EXPERIENCE_OUTPUTS = {
  experience: {
    type: 'array',
    description: 'Returned experience records',
    items: { type: 'object', properties: experienceProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListCandidateSkillsParams = Omit<
  Schemas.ListCandidateSkillsInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListCandidateSkillsResponse {
  success: boolean
  output: PageOutput & { skills: Schemas.Skill[] }
}
export const LIST_CANDIDATE_SKILLS_OUTPUTS = {
  skills: {
    type: 'array',
    description: 'Returned skill records',
    items: { type: 'object', properties: skillProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListCandidateAttachmentsParams = Omit<
  Schemas.ListCandidateAttachmentsInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListCandidateAttachmentsResponse {
  success: boolean
  output: PageOutput & { attachments: Schemas.Attachment[] }
}
export const LIST_CANDIDATE_ATTACHMENTS_OUTPUTS = {
  attachments: {
    type: 'array',
    description: 'Returned attachment records',
    items: { type: 'object', properties: attachmentProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListRequisitionsParams = Omit<
  Schemas.ListRequisitionsInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListRequisitionsResponse {
  success: boolean
  output: PageOutput & { requisitions: Schemas.Requisition[] }
}
export const LIST_REQUISITIONS_OUTPUTS = {
  requisitions: {
    type: 'array',
    description: 'Returned requisition records',
    items: { type: 'object', properties: requisitionProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingGetRequisitionParams = Omit<
  Schemas.GetRequisitionInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingGetRequisitionResponse {
  success: boolean
  output: { requisition: Schemas.Requisition }
}
export const GET_REQUISITION_OUTPUTS = {
  requisition: {
    type: 'json',
    description: 'Returned requisition',
    properties: requisitionProperties,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingCreateRequisitionParams = Omit<
  Schemas.CreateRequisitionInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingCreateRequisitionResponse {
  success: boolean
  output: { requisition: Schemas.Requisition }
}
export const CREATE_REQUISITION_OUTPUTS = {
  requisition: {
    type: 'json',
    description: 'Returned requisition',
    properties: requisitionProperties,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingUpdateRequisitionParams = Omit<
  Schemas.UpdateRequisitionInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingUpdateRequisitionResponse {
  success: boolean
  output: { requisition: Schemas.Requisition }
}
export const UPDATE_REQUISITION_OUTPUTS = {
  requisition: {
    type: 'json',
    description: 'Returned requisition',
    properties: requisitionProperties,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingDeleteRequisitionParams = Omit<
  Schemas.DeleteRequisitionInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingDeleteRequisitionResponse {
  success: boolean
  output: { deleted: boolean }
}
export const DELETE_REQUISITION_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Whether Oracle confirmed the deletion' },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListRequisitionPostingsParams = Omit<
  Schemas.ListRequisitionPostingsInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListRequisitionPostingsResponse {
  success: boolean
  output: PageOutput & { postings: Schemas.Posting[] }
}
export const LIST_REQUISITION_POSTINGS_OUTPUTS = {
  postings: {
    type: 'array',
    description: 'Returned posting records',
    items: { type: 'object', properties: postingProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListApplicationsParams = Omit<
  Schemas.ListApplicationsInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListApplicationsResponse {
  success: boolean
  output: PageOutput & { applications: Schemas.Application[] }
}
export const LIST_APPLICATIONS_OUTPUTS = {
  applications: {
    type: 'array',
    description: 'Returned application records',
    items: { type: 'object', properties: applicationProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingGetApplicationParams = Omit<
  Schemas.GetApplicationInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingGetApplicationResponse {
  success: boolean
  output: { application: Schemas.Application }
}
export const GET_APPLICATION_OUTPUTS = {
  application: {
    type: 'json',
    description: 'Returned application',
    properties: applicationProperties,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListOffersParams = Omit<
  Schemas.ListOffersInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListOffersResponse {
  success: boolean
  output: PageOutput & { offers: Schemas.Offer[] }
}
export const LIST_OFFERS_OUTPUTS = {
  offers: {
    type: 'array',
    description: 'Returned offer records',
    items: { type: 'object', properties: offerProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingGetOfferParams = Omit<
  Schemas.GetOfferInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingGetOfferResponse {
  success: boolean
  output: { offer: Schemas.Offer }
}
export const GET_OFFER_OUTPUTS = {
  offer: { type: 'json', description: 'Returned offer', properties: offerProperties },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListInterviewSchedulesParams = Omit<
  Schemas.ListInterviewSchedulesInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListInterviewSchedulesResponse {
  success: boolean
  output: PageOutput & { interviewSchedules: Schemas.InterviewSchedule[] }
}
export const LIST_INTERVIEW_SCHEDULES_OUTPUTS = {
  interviewSchedules: {
    type: 'array',
    description: 'Returned interview schedule records',
    items: { type: 'object', properties: interviewScheduleProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingGetInterviewScheduleParams = Omit<
  Schemas.GetInterviewScheduleInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingGetInterviewScheduleResponse {
  success: boolean
  output: { interviewSchedule: Schemas.InterviewSchedule }
}
export const GET_INTERVIEW_SCHEDULE_OUTPUTS = {
  interviewSchedule: {
    type: 'json',
    description: 'Returned interview schedule',
    properties: interviewScheduleProperties,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListRequisitionTemplatesParams = Omit<
  Schemas.ListRequisitionTemplatesInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListRequisitionTemplatesResponse {
  success: boolean
  output: PageOutput & { requisitionTemplates: Schemas.RequisitionTemplate[] }
}
export const LIST_REQUISITION_TEMPLATES_OUTPUTS = {
  requisitionTemplates: {
    type: 'array',
    description: 'Returned requisition template records',
    items: { type: 'object', properties: requisitionTemplateProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionRecruitingListRecruitingRepresentativesParams = Omit<
  Schemas.ListRecruitingRepresentativesInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export interface OracleFusionRecruitingListRecruitingRepresentativesResponse {
  success: boolean
  output: PageOutput & { representatives: Schemas.Representative[] }
}
export const LIST_RECRUITING_REPRESENTATIVES_OUTPUTS = {
  representatives: {
    type: 'array',
    description: 'Returned representative records',
    items: { type: 'object', properties: representativeProperties },
  },
  ...pageOutputs,
} satisfies Record<string, ToolOutputProperty>
