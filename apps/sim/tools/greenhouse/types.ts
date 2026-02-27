import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters shared by all Greenhouse tools
 */
export interface GreenhouseBaseParams {
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

export interface GreenhouseAttachment {
  filename: string
  url: string
  type: string
  created_at: string | null
}

export interface GreenhouseEducation {
  id: number
  school_name: string | null
  degree: string | null
  discipline: string | null
  start_date: string | null
  end_date: string | null
}

export interface GreenhouseEmployment {
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

export interface GreenhouseHiringTeam {
  hiring_managers: GreenhouseUserRef[]
  recruiters: Array<GreenhouseUserRef & { responsible: boolean }>
  coordinators: Array<GreenhouseUserRef & { responsible: boolean }>
  sourcers: GreenhouseUserRef[]
}

export interface GreenhouseOpening {
  id: number
  opening_id: string | null
  status: string
  opened_at: string | null
  closed_at: string | null
  application_id: number | null
  close_reason: { id: number; name: string } | null
}

/**
 * Union type of all Greenhouse responses
 */
export type GreenhouseResponse =
  | GreenhouseListCandidatesResponse
  | GreenhouseGetCandidateResponse
  | GreenhouseListJobsResponse
  | GreenhouseGetJobResponse
  | GreenhouseListApplicationsResponse
  | GreenhouseGetApplicationResponse
  | GreenhouseListUsersResponse
  | GreenhouseGetUserResponse
  | GreenhouseListDepartmentsResponse
  | GreenhouseListOfficesResponse
  | GreenhouseListJobStagesResponse
