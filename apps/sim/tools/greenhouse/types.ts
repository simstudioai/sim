import type {
  APPLICATION_STAGES_V2_OUTPUTS,
  APPLICATIONS_V2_OUTPUTS,
  APPLIED_CANDIDATE_TAGS_V2_OUTPUTS,
  ATTACHMENTS_V2_OUTPUTS,
  CANDIDATE_EDUCATIONS_V2_OUTPUTS,
  CANDIDATE_EMPLOYMENTS_V2_OUTPUTS,
  CANDIDATE_TAGS_V2_OUTPUTS,
  CANDIDATES_V2_OUTPUTS,
  CLOSE_REASONS_V2_OUTPUTS,
  CREATE_CANDIDATE_V2_OUTPUTS,
  CUSTOM_FIELD_OPTIONS_V2_OUTPUTS,
  CUSTOM_FIELDS_V2_OUTPUTS,
  DELETE_V2_OUTPUTS,
  DEPARTMENTS_V2_OUTPUTS,
  EMAIL_TEMPLATES_V2_OUTPUTS,
  INTERVIEWS_V2_OUTPUTS,
  JOB_HIRING_MANAGERS_V2_OUTPUTS,
  JOB_INTERVIEW_STAGES_V2_OUTPUTS,
  JOB_OWNERS_V2_OUTPUTS,
  JOBS_V2_OUTPUTS,
  NOTES_V2_OUTPUTS,
  OFFERS_V2_OUTPUTS,
  OFFICES_V2_OUTPUTS,
  OPENINGS_V2_OUTPUTS,
  PROSPECT_POOL_STAGES_V2_OUTPUTS,
  PROSPECT_POOLS_V2_OUTPUTS,
  REFERRERS_V2_OUTPUTS,
  REJECTION_REASONS_V2_OUTPUTS,
  SCORECARDS_V2_OUTPUTS,
  SOURCES_V2_OUTPUTS,
  USERS_V2_OUTPUTS,
} from '@/tools/greenhouse/v2_outputs'
import type { GreenhouseV2Output } from '@/tools/greenhouse/v2_utils'
import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters shared by all Greenhouse tools
 */
interface GreenhouseBaseParams {
  apiKey: string
}

// ── List Candidates ──

export interface GreenhouseListCandidatesParams extends GreenhouseBaseParams {
  per_page?: number
  page?: number
  created_before?: string
  created_after?: string
  updated_before?: string
  updated_after?: string
  job_id?: string
  email?: string
  candidate_ids?: string
}

export interface GreenhouseListCandidatesResponse extends ToolResponse {
  output: {
    candidates: GreenhouseCandidateSummary[]
    count: number
  }
}

// ── Get Candidate ──

export interface GreenhouseGetCandidateParams extends GreenhouseBaseParams {
  candidateId: string
}

export interface GreenhouseGetCandidateResponse extends ToolResponse {
  output: {
    id: number
    first_name: string | null
    last_name: string | null
    company: string | null
    title: string | null
    is_private: boolean
    can_email: boolean
    created_at: string | null
    updated_at: string | null
    last_activity: string | null
    email_addresses: Array<{ value: string; type: string }>
    phone_numbers: Array<{ value: string; type: string }>
    addresses: Array<{ value: string; type: string }>
    website_addresses: Array<{ value: string; type: string }>
    social_media_addresses: Array<{ value: string }>
    tags: string[]
    application_ids: number[]
    recruiter: GreenhouseUserRef | null
    coordinator: GreenhouseUserRef | null
    attachments: GreenhouseAttachment[]
    educations: GreenhouseEducation[]
    employments: GreenhouseEmployment[]
    custom_fields: Record<string, unknown>
  }
}

// ── List Jobs ──

export interface GreenhouseListJobsParams extends GreenhouseBaseParams {
  per_page?: number
  page?: number
  status?: string
  created_before?: string
  created_after?: string
  updated_before?: string
  updated_after?: string
  department_id?: string
  office_id?: string
}

export interface GreenhouseListJobsResponse extends ToolResponse {
  output: {
    jobs: GreenhouseJobSummary[]
    count: number
  }
}

// ── Get Job ──

export interface GreenhouseGetJobParams extends GreenhouseBaseParams {
  jobId: string
}

export interface GreenhouseGetJobResponse extends ToolResponse {
  output: {
    id: number
    name: string | null
    requisition_id: string | null
    status: string | null
    confidential: boolean
    created_at: string | null
    opened_at: string | null
    closed_at: string | null
    updated_at: string | null
    is_template: boolean | null
    notes: string | null
    departments: Array<{ id: number; name: string; parent_id: number | null }>
    offices: Array<{ id: number; name: string; location: { name: string | null } }>
    hiring_team: GreenhouseHiringTeam
    openings: GreenhouseOpening[]
    custom_fields: Record<string, unknown>
  }
}

// ── List Applications ──

export interface GreenhouseListApplicationsParams extends GreenhouseBaseParams {
  per_page?: number
  page?: number
  job_id?: string
  status?: string
  created_before?: string
  created_after?: string
  last_activity_after?: string
}

export interface GreenhouseListApplicationsResponse extends ToolResponse {
  output: {
    applications: GreenhouseApplicationSummary[]
    count: number
  }
}

// ── Get Application ──

export interface GreenhouseGetApplicationParams extends GreenhouseBaseParams {
  applicationId: string
}

export interface GreenhouseGetApplicationResponse extends ToolResponse {
  output: {
    id: number
    candidate_id: number
    prospect: boolean
    status: string | null
    applied_at: string | null
    rejected_at: string | null
    last_activity_at: string | null
    location: { address: string | null } | null
    source: { id: number; public_name: string } | null
    credited_to: GreenhouseUserRef | null
    recruiter: GreenhouseUserRef | null
    coordinator: GreenhouseUserRef | null
    current_stage: { id: number; name: string } | null
    rejection_reason: { id: number; name: string; type: { id: number; name: string } } | null
    jobs: Array<{ id: number; name: string }>
    job_post_id: number | null
    answers: Array<{ question: string; answer: string }>
    attachments: GreenhouseAttachment[]
    custom_fields: Record<string, unknown>
  }
}

// ── List Users ──

export interface GreenhouseListUsersParams extends GreenhouseBaseParams {
  per_page?: number
  page?: number
  created_before?: string
  created_after?: string
  updated_before?: string
  updated_after?: string
  email?: string
}

export interface GreenhouseListUsersResponse extends ToolResponse {
  output: {
    users: GreenhouseUser[]
    count: number
  }
}

// ── Get User ──

export interface GreenhouseGetUserParams extends GreenhouseBaseParams {
  userId: string
}

export interface GreenhouseGetUserResponse extends ToolResponse {
  output: {
    id: number
    name: string | null
    first_name: string | null
    last_name: string | null
    primary_email_address: string | null
    disabled: boolean
    site_admin: boolean
    emails: string[]
    employee_id: string | null
    linked_candidate_ids: number[]
    created_at: string | null
    updated_at: string | null
  }
}

// ── List Departments ──

export interface GreenhouseListDepartmentsParams extends GreenhouseBaseParams {
  per_page?: number
  page?: number
}

export interface GreenhouseListDepartmentsResponse extends ToolResponse {
  output: {
    departments: GreenhouseDepartment[]
    count: number
  }
}

// ── List Offices ──

export interface GreenhouseListOfficesParams extends GreenhouseBaseParams {
  per_page?: number
  page?: number
}

export interface GreenhouseListOfficesResponse extends ToolResponse {
  output: {
    offices: GreenhouseOffice[]
    count: number
  }
}

// ── List Job Stages ──

export interface GreenhouseListJobStagesParams extends GreenhouseBaseParams {
  jobId: string
  per_page?: number
  page?: number
}

export interface GreenhouseListJobStagesResponse extends ToolResponse {
  output: {
    stages: GreenhouseJobStage[]
    count: number
  }
}

// ── Shared Types ──

export interface GreenhouseUserRef {
  id: number
  first_name: string
  last_name: string
  name: string
  employee_id: string | null
}

interface GreenhouseAttachment {
  filename: string
  url: string
  type: string
  created_at: string | null
}

interface GreenhouseEducation {
  id: number
  school_name: string | null
  degree: string | null
  discipline: string | null
  start_date: string | null
  end_date: string | null
}

interface GreenhouseEmployment {
  id: number
  company_name: string | null
  title: string | null
  start_date: string | null
  end_date: string | null
}

export interface GreenhouseUser {
  id: number
  name: string | null
  first_name: string | null
  last_name: string | null
  primary_email_address: string | null
  disabled: boolean
  site_admin: boolean
  emails: string[]
  employee_id: string | null
  linked_candidate_ids: number[]
  created_at: string | null
  updated_at: string | null
}

export interface GreenhouseDepartment {
  id: number
  name: string | null
  parent_id: number | null
  child_ids: number[]
  external_id: string | null
}

export interface GreenhouseOffice {
  id: number
  name: string | null
  location: { name: string | null }
  primary_contact_user_id: number | null
  parent_id: number | null
  child_ids: number[]
  external_id: string | null
}

export interface GreenhouseJobStageInterview {
  id: number
  name: string | null
  schedulable: boolean
  estimated_minutes: number | null
  default_interviewer_users: GreenhouseUserRef[]
  interview_kit: {
    id: number
    content: string | null
    questions: Array<{ id: number; question: string }>
  } | null
}

export interface GreenhouseJobStage {
  id: number
  name: string | null
  created_at: string | null
  updated_at: string | null
  job_id: number
  priority: number
  active: boolean
  interviews: GreenhouseJobStageInterview[]
}

export interface GreenhouseCandidateSummary {
  id: number
  first_name: string | null
  last_name: string | null
  company: string | null
  title: string | null
  is_private: boolean
  can_email: boolean
  email_addresses: Array<{ value: string; type: string }>
  tags: string[]
  application_ids: number[]
  created_at: string | null
  updated_at: string | null
  last_activity: string | null
}

export interface GreenhouseJobSummary {
  id: number
  name: string | null
  status: string | null
  confidential: boolean
  departments: Array<{ id: number; name: string }>
  offices: Array<{ id: number; name: string }>
  opened_at: string | null
  closed_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface GreenhouseApplicationSummary {
  id: number
  candidate_id: number | null
  prospect: boolean
  status: string | null
  current_stage: { id: number; name: string } | null
  jobs: Array<{ id: number; name: string }>
  applied_at: string | null
  rejected_at: string | null
  last_activity_at: string | null
}

interface GreenhouseHiringTeam {
  hiring_managers: GreenhouseUserRef[]
  recruiters: Array<GreenhouseUserRef & { responsible: boolean }>
  coordinators: Array<GreenhouseUserRef & { responsible: boolean }>
  sourcers: GreenhouseUserRef[]
}

interface GreenhouseOpening {
  id: number
  opening_id: string | null
  status: string
  opened_at: string | null
  closed_at: string | null
  application_id: number | null
  close_reason: { id: number; name: string } | null
}

export interface GreenhouseDeleteApplicationV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseDeleteApplicationV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof DELETE_V2_OUTPUTS>
}

export interface GreenhouseRemoveCandidateTagV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseRemoveCandidateTagV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof DELETE_V2_OUTPUTS>
}

export interface GreenhouseDeleteAttachmentV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseDeleteAttachmentV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof DELETE_V2_OUTPUTS>
}

export interface GreenhouseDeleteCandidateV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseDeleteCandidateV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof DELETE_V2_OUTPUTS>
}

export interface GreenhouseListApplicationStagesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  application_ids?: string
  job_interview_stage_ids?: string
  fields?: string
  current?: boolean
}

export interface GreenhouseListApplicationStagesV2Response extends ToolResponse {
  output: {
    application_stages: GreenhouseV2Output<typeof APPLICATION_STAGES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListApplicationsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  candidate_ids?: string
  job_ids?: string
  prospective_job_ids?: string
  job_post_ids?: string
  source_ids?: string
  referrer_ids?: string
  stage_ids?: string
  job_interview_stage_ids?: string
  fields?: string
  status?: string
  stage_name?: string
  custom_field_option_id?: number
  last_activity_at?: Record<string, unknown> | string
  prospect?: boolean
}

export interface GreenhouseListApplicationsV2Response extends ToolResponse {
  output: {
    applications: GreenhouseV2Output<typeof APPLICATIONS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseGetApplicationV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseGetApplicationV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof APPLICATIONS_V2_OUTPUTS>
}

export interface GreenhouseListAppliedCandidateTagsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  candidate_tag_ids?: string
  candidate_ids?: string
  fields?: string
}

export interface GreenhouseListAppliedCandidateTagsV2Response extends ToolResponse {
  output: {
    applied_candidate_tags: GreenhouseV2Output<typeof APPLIED_CANDIDATE_TAGS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListAttachmentsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  application_ids?: string
  candidate_ids?: string
  fields?: string
  type?: string
}

export interface GreenhouseListAttachmentsV2Response extends ToolResponse {
  output: {
    attachments: GreenhouseV2Output<typeof ATTACHMENTS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListCandidateEducationsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  candidate_ids?: string
  fields?: string
  start_at?: Record<string, unknown> | string
  end_at?: Record<string, unknown> | string
  latest?: boolean
}

export interface GreenhouseListCandidateEducationsV2Response extends ToolResponse {
  output: {
    candidate_educations: GreenhouseV2Output<typeof CANDIDATE_EDUCATIONS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListCandidateEmploymentsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  candidate_ids?: string
  fields?: string
  latest?: boolean
}

export interface GreenhouseListCandidateEmploymentsV2Response extends ToolResponse {
  output: {
    candidate_employments: GreenhouseV2Output<typeof CANDIDATE_EMPLOYMENTS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListCandidateTagsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
}

export interface GreenhouseListCandidateTagsV2Response extends ToolResponse {
  output: {
    candidate_tags: GreenhouseV2Output<typeof CANDIDATE_TAGS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListCandidatesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  last_activity_at?: Record<string, unknown> | string
  custom_field_option_id?: number
  private?: boolean
  email?: string
  tag?: string
}

export interface GreenhouseListCandidatesV2Response extends ToolResponse {
  output: {
    candidates: GreenhouseV2Output<typeof CANDIDATES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseGetCandidateV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseGetCandidateV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof CANDIDATES_V2_OUTPUTS>
}

export interface GreenhouseListCloseReasonsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
}

export interface GreenhouseListCloseReasonsV2Response extends ToolResponse {
  output: {
    close_reasons: GreenhouseV2Output<typeof CLOSE_REASONS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListCustomFieldOptionsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  custom_field_ids?: string
  fields?: string
  active?: boolean
  custom_field_key?: string
}

export interface GreenhouseListCustomFieldOptionsV2Response extends ToolResponse {
  output: {
    custom_field_options: GreenhouseV2Output<typeof CUSTOM_FIELD_OPTIONS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListCustomFieldsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  field_type?: string
  active?: boolean
  name?: string
  name_key?: string
}

export interface GreenhouseListCustomFieldsV2Response extends ToolResponse {
  output: {
    custom_fields: GreenhouseV2Output<typeof CUSTOM_FIELDS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListDepartmentsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  parent_id?: number
  external_id?: string
}

export interface GreenhouseListDepartmentsV2Response extends ToolResponse {
  output: {
    departments: GreenhouseV2Output<typeof DEPARTMENTS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListEmailTemplatesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  email_type?: string
  from_type?: string
}

export interface GreenhouseListEmailTemplatesV2Response extends ToolResponse {
  output: {
    email_templates: GreenhouseV2Output<typeof EMAIL_TEMPLATES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListInterviewsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  job_ids?: string
  application_ids?: string
  job_interview_ids?: string
  organizer_ids?: string
  fields?: string
  starts_at?: Record<string, unknown> | string
  ends_at?: Record<string, unknown> | string
  all_day_start_on?: Record<string, unknown> | string
  all_day_end_on?: Record<string, unknown> | string
  external_event_id?: string
  status?: string
}

export interface GreenhouseListInterviewsV2Response extends ToolResponse {
  output: {
    interviews: GreenhouseV2Output<typeof INTERVIEWS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListJobHiringManagersV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  user_ids?: string
  job_ids?: string
  fields?: string
}

export interface GreenhouseListJobHiringManagersV2Response extends ToolResponse {
  output: {
    job_hiring_managers: GreenhouseV2Output<typeof JOB_HIRING_MANAGERS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListJobInterviewStagesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  job_ids?: string
  fields?: string
  active?: boolean
}

export interface GreenhouseListJobInterviewStagesV2Response extends ToolResponse {
  output: {
    job_interview_stages: GreenhouseV2Output<typeof JOB_INTERVIEW_STAGES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListJobOwnersV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  user_ids?: string
  job_ids?: string
  fields?: string
  type?: string
}

export interface GreenhouseListJobOwnersV2Response extends ToolResponse {
  output: {
    job_owners: GreenhouseV2Output<typeof JOB_OWNERS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListJobsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  opened_at?: Record<string, unknown> | string
  closed_at?: Record<string, unknown> | string
  requisition_id?: string
  department_id?: number
  office_id?: number
  custom_field_option_id?: number
  confidential?: boolean
  status?: string
}

export interface GreenhouseListJobsV2Response extends ToolResponse {
  output: {
    jobs: GreenhouseV2Output<typeof JOBS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseGetJobV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseGetJobV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof JOBS_V2_OUTPUTS>
}

export interface GreenhouseListNotesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  candidate_ids?: string
  user_ids?: string
  application_ids?: string
  fields?: string
  type?: string
  visibility?: string
}

export interface GreenhouseListNotesV2Response extends ToolResponse {
  output: {
    notes: GreenhouseV2Output<typeof NOTES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListOffersV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  application_ids?: string
  job_ids?: string
  candidate_ids?: string
  opening_ids?: string
  fields?: string
  current_only?: boolean
  custom_field_option_id?: number
  status?: string
  resolved_at?: Record<string, unknown> | string
  sent_on?: Record<string, unknown> | string
  starts_on?: Record<string, unknown> | string
}

export interface GreenhouseListOffersV2Response extends ToolResponse {
  output: {
    offers: GreenhouseV2Output<typeof OFFERS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListOfficesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  parent_id?: number
  external_id?: string
}

export interface GreenhouseListOfficesV2Response extends ToolResponse {
  output: {
    offices: GreenhouseV2Output<typeof OFFICES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListOpeningsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  job_ids?: string
  application_ids?: string
  close_reason_ids?: string
  fields?: string
  opened_at?: Record<string, unknown> | string
  closed_at?: Record<string, unknown> | string
  custom_field_option_id?: number
  open?: boolean
  opening_id?: string
}

export interface GreenhouseListOpeningsV2Response extends ToolResponse {
  output: {
    openings: GreenhouseV2Output<typeof OPENINGS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListProspectPoolStagesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  prospect_pool_ids?: string
  fields?: string
}

export interface GreenhouseListProspectPoolStagesV2Response extends ToolResponse {
  output: {
    prospect_pool_stages: GreenhouseV2Output<typeof PROSPECT_POOL_STAGES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListProspectPoolsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  department_ids?: string
  office_ids?: string
  job_ids?: string
  fields?: string
  active?: boolean
}

export interface GreenhouseListProspectPoolsV2Response extends ToolResponse {
  output: {
    prospect_pools: GreenhouseV2Output<typeof PROSPECT_POOLS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListReferrersV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  user_ids?: string
  fields?: string
}

export interface GreenhouseListReferrersV2Response extends ToolResponse {
  output: {
    referrers: GreenhouseV2Output<typeof REFERRERS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListRejectionReasonsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
  include_defaults?: boolean
}

export interface GreenhouseListRejectionReasonsV2Response extends ToolResponse {
  output: {
    rejection_reasons: GreenhouseV2Output<typeof REJECTION_REASONS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListScorecardsV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  interview_kit_ids?: string
  submitter_ids?: string
  application_ids?: string
  interviewer_ids?: string
  fields?: string
  interviewed_at?: Record<string, unknown> | string
  submitted_at?: Record<string, unknown> | string
  status?: string
}

export interface GreenhouseListScorecardsV2Response extends ToolResponse {
  output: {
    scorecards: GreenhouseV2Output<typeof SCORECARDS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListSourcesV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  fields?: string
}

export interface GreenhouseListSourcesV2Response extends ToolResponse {
  output: {
    sources: GreenhouseV2Output<typeof SOURCES_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseListUsersV2Params {
  accessToken: string
  cursor?: string
  per_page?: number
  ids?: string
  created_at?: Record<string, unknown> | string
  updated_at?: Record<string, unknown> | string
  agency_ids?: string
  office_ids?: string
  department_ids?: string
  linked_candidate_ids?: string
  interviewer_tag_ids?: string
  fields?: string
  employee_ids?: string
  custom_field_option_id?: number
  deactivated?: boolean
  primary_email?: string
  external_office_id?: string
  external_department_id?: string
  show_service_accounts?: boolean
}

export interface GreenhouseListUsersV2Response extends ToolResponse {
  output: {
    users: GreenhouseV2Output<typeof USERS_V2_OUTPUTS>[]
    count: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface GreenhouseGetUserV2Params {
  accessToken: string
  id: string
}

export interface GreenhouseGetUserV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof USERS_V2_OUTPUTS>
}

export interface GreenhouseUpdateApplicationV2Params {
  accessToken: string
  id: number
  source_id?: number
  referrer_id?: number
  recruiter_id?: number
  coordinator_id?: number
  prospect_pool_id?: number
  prospect_stage_id?: number
  rejected_at?: string
  created_at?: string
  custom_fields?: unknown[] | string
}

export interface GreenhouseUpdateApplicationV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof APPLICATIONS_V2_OUTPUTS>
}

export interface GreenhouseUpdateCandidateV2Params {
  accessToken: string
  id: number
  first_name?: string
  last_name?: string
  preferred_name?: string
  time_zone?: string
  company?: string
  title?: string
  is_private?: boolean
  can_email?: boolean
  phone_numbers?: unknown[] | string
  addresses?: unknown[] | string
  email_addresses?: unknown[] | string
  website_addresses?: unknown[] | string
  social_media_addresses?: unknown[] | string
  tags?: unknown[] | string
  linked_user_ids?: unknown[] | string
  custom_fields?: unknown[] | string
}

export interface GreenhouseUpdateCandidateV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof CANDIDATES_V2_OUTPUTS>
}

export interface GreenhouseCreateApplicationV2Params {
  accessToken: string
  source_id?: number
  recruiter_id?: number
  coordinator_id?: number
  referrer_id?: number
  created_at?: string
  custom_fields?: unknown[] | string
  candidate_id: number
  job_id?: number
  initial_stage_id?: number
  prospect?: boolean
  job_ids?: unknown[] | string
  prospect_pool_id?: number
  prospect_pool_stage_id?: number
  prospect_owner_id?: number
  prospective_department_id?: number
  prospective_office_id?: number
}

export interface GreenhouseCreateApplicationV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof APPLICATIONS_V2_OUTPUTS>
}

export interface GreenhouseConvertProspectV2Params {
  accessToken: string
  id: number
  job_id: number
  to_job_interview_stage_id?: number
}

export interface GreenhouseConvertProspectV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof APPLICATIONS_V2_OUTPUTS>
}

export interface GreenhouseHireApplicationV2Params {
  accessToken: string
  id: number
  start_date?: string
  opening_id?: number
  close_reason_id?: number
}

export interface GreenhouseHireApplicationV2Response extends ToolResponse {
  output: Record<string, never>
}

export interface GreenhouseMoveApplicationV2Params {
  accessToken: string
  id: number
  from_stage_id: number
  to_stage_id?: number
  to_job_id?: number
  email_from_user_id?: number
}

export interface GreenhouseMoveApplicationV2Response extends ToolResponse {
  output: Record<string, never>
}

export interface GreenhouseRejectApplicationV2Params {
  accessToken: string
  id: number
  rejection_reason_id: number
  notes?: string
  rejection_email?: Record<string, unknown> | string
  custom_fields?: unknown[] | string
}

export interface GreenhouseRejectApplicationV2Response extends ToolResponse {
  output: Record<string, never>
}

export interface GreenhouseUnrejectApplicationV2Params {
  accessToken: string
  id: number
}

export interface GreenhouseUnrejectApplicationV2Response extends ToolResponse {
  output: Record<string, never>
}

export interface GreenhouseApplyCandidateTagV2Params {
  accessToken: string
  candidate_id: number
  candidate_tag_id: number
}

export interface GreenhouseApplyCandidateTagV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof APPLIED_CANDIDATE_TAGS_V2_OUTPUTS>
}

export interface GreenhouseCreateAttachmentV2Params {
  accessToken: string
  application_id: number
  filename: string
  type: string
  content?: string
  url?: string
  visibility?: string
}

export interface GreenhouseCreateAttachmentV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof ATTACHMENTS_V2_OUTPUTS>
}

export interface GreenhouseCreateCandidateTagV2Params {
  accessToken: string
  name: string
}

export interface GreenhouseCreateCandidateTagV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof CANDIDATE_TAGS_V2_OUTPUTS>
}

export interface GreenhouseCreateCandidateV2Params {
  accessToken: string
  first_name: string
  last_name: string
  preferred_name?: string
  time_zone?: string
  company?: string
  title?: string
  can_email?: boolean
  phone_numbers?: unknown[] | string
  addresses?: unknown[] | string
  email_addresses?: unknown[] | string
  website_addresses?: unknown[] | string
  social_media_addresses?: unknown[] | string
  tags?: unknown[] | string
  linked_user_ids?: unknown[] | string
  custom_fields?: unknown[] | string
  application?: Record<string, unknown> | string
}

export interface GreenhouseCreateCandidateV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof CREATE_CANDIDATE_V2_OUTPUTS>
}

export interface GreenhouseCreateNoteV2Params {
  accessToken: string
  candidate_id: number
  body: string
  subject?: string
  note_type: string
  user_id?: number
  email_from?: unknown[] | string
  email_to?: unknown[] | string
  email_cc?: unknown[] | string
  visibility: string
  application_id?: number
}

export interface GreenhouseCreateNoteV2Response extends ToolResponse {
  output: GreenhouseV2Output<typeof NOTES_V2_OUTPUTS>
}
