import type { ToolOutputProperty } from '@/tools/types'

export const JOBS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  requisition_id: { type: 'string', description: 'Requisition ID', nullable: true },
  notes: { type: 'string', description: 'Notes', nullable: true },
  confidential: { type: 'boolean', description: 'Confidential', nullable: true },
  status: {
    type: 'string',
    description: 'Status Allowed: open, draft, closed.',

    nullable: true,
  },
  opened_at: {
    type: 'string',
    description: 'Opened at (ISO 8601)',

    nullable: true,
  },
  closed_at: {
    type: 'string',
    description: 'Closed at (ISO 8601)',

    nullable: true,
  },
  is_template: { type: 'boolean', description: 'Is template', nullable: true },
  copied_from_id: { type: 'number', description: 'Copied from ID', nullable: true },
  department_id: { type: 'number', description: 'Department ID', nullable: true },
  external_department_id: {
    type: 'string',
    description: 'External department ID',

    nullable: true,
  },
  office_ids: {
    nullable: true,
    type: 'array',
    description: 'Office IDs',

    items: { type: 'number', description: 'Office IDs item' },
  },
  external_office_ids: {
    nullable: true,
    type: 'array',
    description: 'External office IDs',

    items: { type: 'string', description: 'External office IDs item' },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATE_EMPLOYMENTS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
  company_name: { type: 'string', description: 'Company name', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  start_date: {
    type: 'string',
    description: 'Start date (YYYY-MM-DD)',

    nullable: true,
  },
  end_date: {
    type: 'string',
    description: 'End date (YYYY-MM-DD)',

    nullable: true,
  },
  latest: { type: 'boolean', description: 'Latest', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const REJECTION_REASONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  type: {
    nullable: true,
    type: 'json',
    description: 'Type',

    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
      key: { type: 'string', description: 'Key', nullable: true },
      name: { type: 'string', description: 'Name', nullable: true },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const JOB_INTERVIEW_STAGES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
  sort_order: { type: 'number', description: 'Sort order', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  active: { type: 'boolean', description: 'Active', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATE_TAGS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const APPLICATION_STAGES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  job_interview_stage_id: {
    type: 'number',
    description: 'Job interview stage ID',

    nullable: true,
  },
  entered_at: {
    type: 'string',
    description: 'Entered at (ISO 8601)',

    nullable: true,
  },
  exited_at: {
    type: 'string',
    description: 'Exited at (ISO 8601)',

    nullable: true,
  },
  days_in_stage: { type: 'number', description: 'Days in stage', nullable: true },
  current: { type: 'boolean', description: 'Current', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const USERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  first_name: { type: 'string', description: 'First name', nullable: true },
  last_name: { type: 'string', description: 'Last name', nullable: true },
  primary_email: { type: 'string', description: 'Primary email', nullable: true },
  job_title: { type: 'string', description: 'Job title', nullable: true },
  agency_id: { type: 'number', description: 'Agency ID', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  deactivated: { type: 'boolean', description: 'Deactivated', nullable: true },
  site_admin: { type: 'boolean', description: 'Site admin', nullable: true },
  employee_id: { type: 'string', description: 'Employee ID', nullable: true },
  linked_candidate_ids: {
    nullable: true,
    type: 'array',
    description: 'Linked candidate IDs',

    items: { type: 'number', description: 'Linked candidate IDs item' },
  },
  office_ids: {
    nullable: true,
    type: 'array',
    description: 'Office IDs',

    items: { type: 'number', description: 'Office IDs item' },
  },
  department_ids: {
    nullable: true,
    type: 'array',
    description: 'Department IDs',

    items: { type: 'number', description: 'Department IDs item' },
  },
  external_office_ids: {
    nullable: true,
    type: 'array',
    description: 'External office IDs',

    items: { type: 'string', description: 'External office IDs item' },
  },
  external_department_ids: {
    nullable: true,
    type: 'array',
    description: 'External department IDs',

    items: { type: 'string', description: 'External department IDs item' },
  },
  interviewer_tags: {
    nullable: true,
    type: 'array',
    description: 'Interviewer tags',

    items: {
      type: 'object',
      description: 'Interviewer tags item',
      properties: {
        id: {
          type: 'number',
          description: 'Greenhouse resource ID',

          nullable: true,
        },
        name: { type: 'string', description: 'Name', nullable: true },
      },
    },
  },
  emails: {
    nullable: true,
    type: 'array',
    description: 'Emails',

    items: { type: 'string', description: 'Emails item' },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const APPLIED_CANDIDATE_TAGS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  candidate_tag_id: {
    type: 'number',
    description: 'Candidate tag ID',

    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const DEPARTMENTS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  parent_id: { type: 'number', description: 'Parent ID', nullable: true },
  external_id: { type: 'string', description: 'External ID', nullable: true },
  external_parent_id: {
    type: 'string',
    description: 'External parent ID',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const PROSPECT_POOL_STAGES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  prospect_pool_id: {
    type: 'number',
    description: 'Prospect pool ID',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  sort_order: { type: 'number', description: 'Sort order', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const INTERVIEWS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  job_interview_id: {
    type: 'number',
    description: 'Job interview ID',

    nullable: true,
  },
  starts_at: {
    type: 'string',
    description: 'Starts at (ISO 8601)',

    nullable: true,
  },
  ends_at: { type: 'string', description: 'Ends at (ISO 8601)', nullable: true },
  location: { type: 'string', description: 'Location', nullable: true },
  status: {
    type: 'string',
    description:
      'Status Allowed: to_be_scheduled, scheduled, awaiting_feedback, complete, skipped, collect_feedback, to_be_sent, sent, received.',

    nullable: true,
  },
  organizer_id: { type: 'number', description: 'Organizer ID', nullable: true },
  scheduled_at: {
    type: 'string',
    description: 'Scheduled at (ISO 8601)',

    nullable: true,
  },
  all_day_start_on: {
    type: 'string',
    description: 'All day start on (YYYY-MM-DD)',

    nullable: true,
  },
  all_day_end_on: {
    type: 'string',
    description: 'All day end on (YYYY-MM-DD)',

    nullable: true,
  },
  external_event_id: {
    type: 'string',
    description: 'External event ID',

    nullable: true,
  },
  video_conferencing_url: {
    type: 'string',
    description: 'Video conferencing url',

    nullable: true,
  },
  availability_received_at: {
    type: 'string',
    description: 'Availability received at (ISO 8601)',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const SCORECARDS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  interview_kit_id: {
    type: 'number',
    description: 'Interview kit ID',

    nullable: true,
  },
  interviewer_id: { type: 'number', description: 'Interviewer ID', nullable: true },
  interviewed_at: {
    type: 'string',
    description: 'Interviewed at (ISO 8601)',

    nullable: true,
  },
  notes: { type: 'string', description: 'Notes', nullable: true },
  notes_with_tags: {
    type: 'string',
    description: 'Notes with tags',

    nullable: true,
  },
  submitter_id: { type: 'number', description: 'Submitter ID', nullable: true },
  candidate_rating: {
    type: 'string',
    description: 'Candidate rating',

    nullable: true,
  },
  private_notes: { type: 'string', description: 'Private notes', nullable: true },
  private_notes_with_tags: {
    type: 'string',
    description: 'Private notes with tags',

    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Status Allowed: draft, complete.',

    nullable: true,
  },
  public_notes: { type: 'string', description: 'Public notes', nullable: true },
  public_notes_with_tags: {
    type: 'string',
    description: 'Public notes with tags',

    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  submitted_at: {
    type: 'string',
    description: 'Submitted at (ISO 8601)',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const JOB_OWNERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
  user_id: { type: 'number', description: 'User ID', nullable: true },
  type: {
    type: 'string',
    description: 'Type Allowed: sourcer, recruiter, coordinator.',

    nullable: true,
  },
  responsible: { type: 'boolean', description: 'Responsible', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const PROSPECT_POOLS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  active: { type: 'boolean', description: 'Active', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  department_ids: {
    nullable: true,
    type: 'array',
    description: 'Department IDs',

    items: { type: 'number', description: 'Department IDs item' },
  },
  office_ids: {
    nullable: true,
    type: 'array',
    description: 'Office IDs',

    items: { type: 'number', description: 'Office IDs item' },
  },
  job_ids: {
    nullable: true,
    type: 'array',
    description: 'Job IDs',

    items: { type: 'number', description: 'Job IDs item' },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const ATTACHMENTS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
  type: {
    type: 'string',
    description:
      'Type Allowed: resume, cover_letter, take_home_test, offer_packet, offer_letter, signed_offer_letter, other, form_attachment, midfunnel_agreement, automated_agreement.',

    nullable: true,
  },
  filename: { type: 'string', description: 'Filename', nullable: true },
  url: {
    type: 'string',
    description: 'Provider URL; attachment download URLs are temporary.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const APPLICATIONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  agency_note_id: { type: 'number', description: 'Agency note ID', nullable: true },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
  coordinator_id: { type: 'number', description: 'Coordinator ID', nullable: true },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
  job_post_id: { type: 'number', description: 'Job post ID', nullable: true },
  recruiter_id: { type: 'number', description: 'Recruiter ID', nullable: true },
  referrer_id: { type: 'number', description: 'Referrer ID', nullable: true },
  rejection_reason_id: {
    type: 'number',
    description: 'Rejection reason ID',

    nullable: true,
  },
  source_id: { type: 'number', description: 'Source ID', nullable: true },
  stage_id: { type: 'number', description: 'Stage ID', nullable: true },
  job_interview_stage_id: {
    type: 'number',
    description: 'Job interview stage ID',

    nullable: true,
  },
  stage_name: { type: 'string', description: 'Stage name', nullable: true },
  status: {
    type: 'string',
    description: 'Status Allowed: rejected, hired, converted, in_process.',

    nullable: true,
  },
  needs_decision: {
    type: 'boolean',
    description: 'Needs decision',

    nullable: true,
  },
  prospect: { type: 'boolean', description: 'Prospect', nullable: true },
  rejected_at: {
    type: 'string',
    description: 'Rejected at (ISO 8601)',

    nullable: true,
  },
  last_activity_at: {
    type: 'string',
    description: 'Last activity at (ISO 8601)',

    nullable: true,
  },
  location_address: {
    type: 'string',
    description: 'Location address',

    nullable: true,
  },
  answers: {
    nullable: true,
    type: 'array',
    description: 'Answers',

    items: {
      type: 'object',
      description: 'Answers item',
      properties: {
        question: { type: 'string', description: 'Question', nullable: true },
        answer: { type: 'string', description: 'Answer', nullable: true },
      },
    },
  },
  prospective_job_ids: {
    nullable: true,
    type: 'array',
    description: 'Prospective job IDs',

    items: { type: 'number', description: 'Prospective job IDs item' },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATE_EDUCATIONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
  school_name_custom_field_option_id: {
    type: 'number',
    description: 'School name custom field option ID',

    nullable: true,
  },
  degree_custom_field_option_id: {
    type: 'number',
    description: 'Degree custom field option ID',

    nullable: true,
  },
  discipline_custom_field_option_id: {
    type: 'number',
    description: 'Discipline custom field option ID',

    nullable: true,
  },
  start_at: { type: 'string', description: 'Start at (ISO 8601)', nullable: true },
  end_at: { type: 'string', description: 'End at (ISO 8601)', nullable: true },
  latest: { type: 'boolean', description: 'Latest', nullable: true },
  start_date_month: {
    type: 'number',
    description: 'Start date month',

    nullable: true,
  },
  start_date_year: {
    type: 'number',
    description: 'Start date year',

    nullable: true,
  },
  end_date_month: { type: 'number', description: 'End date month', nullable: true },
  end_date_year: { type: 'number', description: 'End date year', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const EMAIL_TEMPLATES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  email_type: { type: 'string', description: 'Email type', nullable: true },
  subject: { type: 'string', description: 'Subject', nullable: true },
  body: { type: 'string', description: 'Body', nullable: true },
  user_id: { type: 'number', description: 'User ID', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  recipients: { type: 'string', description: 'Recipients', nullable: true },
  default: { type: 'boolean', description: 'Default', nullable: true },
  html_body: { type: 'string', description: 'Html body', nullable: true },
  office_anywhere: {
    type: 'boolean',
    description: 'Office anywhere',

    nullable: true,
  },
  from_type: {
    type: 'string',
    description:
      'From type Allowed: user_email, organization_email, my_email_address, inviter, organizer, not_applicable.',

    nullable: true,
  },
  cc_recruiter: { type: 'boolean', description: 'Cc recruiter', nullable: true },
  cc_coordinator: {
    type: 'boolean',
    description: 'Cc coordinator',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const REFERRERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  user_id: { type: 'number', description: 'User ID', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const CLOSE_REASONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const CUSTOM_FIELD_OPTIONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  custom_field_id: {
    type: 'number',
    description: 'Custom field ID',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  external_id: { type: 'string', description: 'External ID', nullable: true },
  sort_order: { type: 'number', description: 'Sort order', nullable: true },
  active: { type: 'boolean', description: 'Active', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const OFFERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  version: { type: 'number', description: 'Version', nullable: true },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
  opening_id: {
    type: 'number',
    description: 'Opening ID; required when hiring into a job with multiple open openings.',

    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Status Allowed: Created, Accepted, Rejected, Deprecated.',

    nullable: true,
  },
  starts_on: {
    type: 'string',
    description: 'Starts on (YYYY-MM-DD)',

    nullable: true,
  },
  sent_on: { type: 'string', description: 'Sent on (YYYY-MM-DD)', nullable: true },
  resolved_at: {
    type: 'string',
    description: 'Resolved at (ISO 8601)',

    nullable: true,
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const JOB_HIRING_MANAGERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  user_id: { type: 'number', description: 'User ID', nullable: true },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const OPENINGS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', nullable: true },
  opened_at: {
    type: 'string',
    description: 'Opened at (ISO 8601)',

    nullable: true,
  },
  closed_at: {
    type: 'string',
    description: 'Closed at (ISO 8601)',

    nullable: true,
  },
  sort_order: { type: 'number', description: 'Sort order', nullable: true },
  opening_id: {
    type: 'string',
    description: 'Opening ID; required when hiring into a job with multiple open openings.',

    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  close_reason_id: {
    type: 'number',
    description: 'Close reason ID',

    nullable: true,
  },
  target_start_on: {
    type: 'string',
    description: 'Target start on (YYYY-MM-DD)',

    nullable: true,
  },
  open: { type: 'boolean', description: 'Open', nullable: true },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CUSTOM_FIELDS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  field_type: {
    type: 'string',
    description:
      'Field type Allowed: job, opening, standard, offer, compensation_frequency, candidate, referral_question, application, rejection_question, form, agency_question, user_attribute.',

    nullable: true,
  },
  sort_order: { type: 'number', description: 'Sort order', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  value_type: {
    type: 'string',
    description:
      'Value type Allowed: short_text, long_text, yes_no, single_select, multi_select, currency, number, date, url, currency_range, number_range, user, linked, header, statement, attachment, rich_text.',

    nullable: true,
  },
  private: {
    type: 'boolean',
    description:
      'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',

    nullable: true,
  },
  required: { type: 'boolean', description: 'Required', nullable: true },
  require_approval: {
    type: 'boolean',
    description: 'Require approval',

    nullable: true,
  },
  trigger_new_version: {
    type: 'boolean',
    description: 'Trigger new version',

    nullable: true,
  },
  active: { type: 'boolean', description: 'Active', nullable: true },
  updated_by_id: { type: 'number', description: 'Updated by ID', nullable: true },
  internal_type: {
    type: 'string',
    description:
      'Internal type Allowed: employment_type, offer_documents, start_date, school_name, degree, discipline, offer_opening.',

    nullable: true,
  },
  expose_in_job_board_api: {
    type: 'boolean',
    description: 'Expose in job board api',

    nullable: true,
  },
  placeholder: { type: 'string', description: 'Placeholder', nullable: true },
  name_key: { type: 'string', description: 'Name key', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  application_type: {
    type: 'string',
    description:
      'Application type Allowed: all_applications, candidate_applications, prospect_applications.',

    nullable: true,
  },
  api_only: { type: 'boolean', description: 'Api only', nullable: true },
  use_for_job_approvals: {
    type: 'boolean',
    description: 'Use for job approvals',

    nullable: true,
  },
  use_for_offer_approvals: {
    type: 'boolean',
    description: 'Use for offer approvals',

    nullable: true,
  },
  template_token_string: {
    type: 'string',
    description: 'Template token string',

    nullable: true,
  },
  default_value: { type: 'json', description: 'Default value', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const NOTES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
  application_id: { type: 'number', description: 'Application ID', nullable: true },
  body: { type: 'string', description: 'Body', nullable: true },
  subject: { type: 'string', description: 'Subject', nullable: true },
  type: {
    type: 'string',
    description:
      'Type Allowed: NOTE, ACTIVITY, INTERVIEW, EMAIL, FOLLOW_UP, TAKE_HOME_TEST, LINKEDIN_NOTE, LINKEDIN_INMAIL, AVAILABILITY_REQUEST, MIGRATION_ERROR, TOUCHPOINT, FORM, FEEDBACK.',

    nullable: true,
  },
  user_id: { type: 'number', description: 'User ID', nullable: true },
  email_from: {
    type: 'string',
    description: 'Comma-separated sender addresses for an EMAIL note',

    nullable: true,
  },
  email_to: {
    type: 'string',
    description: 'Comma-separated recipient addresses for an EMAIL note',

    nullable: true,
  },
  email_cc: {
    nullable: true,
    type: 'array',
    description: 'CC addresses for an EMAIL note',

    items: { type: 'string', description: 'Email cc item' },
  },
  import_hash: { type: 'string', description: 'Import hash', nullable: true },
  body_with_tags: { type: 'string', description: 'Body with tags', nullable: true },
  visibility: {
    type: 'string',
    description: 'Visibility Allowed: admin_only_visible, privately_visible, publicly_visible.',

    nullable: true,
  },
  email_attachment_file_names: {
    type: 'string',
    description: 'Email attachment file names',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const OFFICES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  parent_id: { type: 'number', description: 'Parent ID', nullable: true },
  external_id: { type: 'string', description: 'External ID', nullable: true },
  external_parent_id: {
    type: 'string',
    description: 'External parent ID',

    nullable: true,
  },
  location: { type: 'string', description: 'Location', nullable: true },
  primary_in_house_contact_user_id: {
    type: 'number',
    description: 'Primary in house contact user ID',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const SOURCES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  name: { type: 'string', description: 'Name', nullable: true },
  type: {
    nullable: true,
    type: 'json',
    description: 'Type',

    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
      name: { type: 'string', description: 'Name', nullable: true },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',

    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',

    nullable: true,
  },
  first_name: { type: 'string', description: 'First name', nullable: true },
  last_name: { type: 'string', description: 'Last name', nullable: true },
  preferred_name: { type: 'string', description: 'Preferred name', nullable: true },
  company: { type: 'string', description: 'Company', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  last_activity_at: {
    type: 'string',
    description: 'Last activity at (ISO 8601)',

    nullable: true,
  },
  private: {
    type: 'boolean',
    description:
      'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',

    nullable: true,
  },
  can_email: {
    type: 'boolean',
    description: 'Whether the candidate consents to email communication.',

    nullable: true,
  },
  time_zone: {
    type: 'string',
    description: 'Greenhouse time-zone identifier (for example, eastern time (us & canada)).',

    nullable: true,
  },
  tags: {
    nullable: true,
    type: 'array',
    description: 'Tags',

    items: { type: 'string', description: 'Tags item' },
  },
  linked_user_ids: {
    nullable: true,
    type: 'array',
    description: 'Linked user IDs',

    items: { type: 'number', description: 'Linked user IDs item' },
  },
  phone_numbers: {
    nullable: true,
    type: 'array',
    description: 'Phone numbers',

    items: {
      type: 'object',
      description: 'Phone numbers item',
      properties: {
        value: { type: 'string', description: 'Value', nullable: true },
        type: { type: 'string', description: 'Type', nullable: true },
      },
    },
  },
  addresses: {
    nullable: true,
    type: 'array',
    description: 'Addresses',

    items: {
      type: 'object',
      description: 'Addresses item',
      properties: {
        value: { type: 'string', description: 'Value', nullable: true },
        type: { type: 'string', description: 'Type', nullable: true },
      },
    },
  },
  email_addresses: {
    nullable: true,
    type: 'array',
    description: 'Email addresses',

    items: {
      type: 'object',
      description: 'Email addresses item',
      properties: {
        value: { type: 'string', description: 'Value', nullable: true },
        type: { type: 'string', description: 'Type', nullable: true },
      },
    },
  },
  website_addresses: {
    nullable: true,
    type: 'array',
    description: 'Website addresses',

    items: {
      type: 'object',
      description: 'Website addresses item',
      properties: {
        value: { type: 'string', description: 'Value', nullable: true },
        type: { type: 'string', description: 'Type', nullable: true },
      },
    },
  },
  social_media_addresses: {
    nullable: true,
    type: 'array',
    description: 'Social media addresses',

    items: {
      type: 'object',
      description: 'Social media addresses item',
      properties: {
        value: { type: 'string', description: 'Value', nullable: true },
      },
    },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CREATE_CANDIDATE_V2_OUTPUTS = {
  candidate: {
    type: 'json',
    description: 'candidate created by this request',
    nullable: true,
    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
      first_name: { type: 'string', description: 'First name', nullable: true },
      last_name: { type: 'string', description: 'Last name', nullable: true },
      preferred_name: {
        type: 'string',
        description: 'Preferred name',

        nullable: true,
      },
      company: { type: 'string', description: 'Company', nullable: true },
      title: { type: 'string', description: 'Title', nullable: true },
      created_at: {
        type: 'string',
        description: 'Creation time in ISO 8601 format',

        nullable: true,
      },
      updated_at: {
        type: 'string',
        description: 'Last update time in ISO 8601 format',

        nullable: true,
      },
      can_email: {
        type: 'boolean',
        description: 'Whether the candidate consents to email communication.',

        nullable: true,
      },
      time_zone: {
        type: 'string',
        description: 'Greenhouse time-zone identifier (for example, eastern time (us & canada)).',

        nullable: true,
      },
      last_activity_at: {
        type: 'string',
        description: 'Last activity at (ISO 8601)',

        nullable: true,
      },
      private: {
        type: 'boolean',
        description:
          'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',

        nullable: true,
      },
      tags: {
        nullable: true,
        type: 'array',
        description: 'Tags',

        items: { type: 'string', description: 'Tags item' },
      },
      linked_user_ids: {
        nullable: true,
        type: 'array',
        description: 'Linked user IDs',

        items: { type: 'number', description: 'Linked user IDs item' },
      },
      phone_numbers: {
        nullable: true,
        type: 'array',
        description: 'Phone numbers',

        items: {
          type: 'object',
          description: 'Phone numbers item',
          properties: {
            value: { type: 'string', description: 'Value', nullable: true },
            type: { type: 'string', description: 'Type', nullable: true },
          },
        },
      },
      addresses: {
        nullable: true,
        type: 'array',
        description: 'Addresses',

        items: {
          type: 'object',
          description: 'Addresses item',
          properties: {
            value: { type: 'string', description: 'Value', nullable: true },
            type: { type: 'string', description: 'Type', nullable: true },
          },
        },
      },
      email_addresses: {
        nullable: true,
        type: 'array',
        description: 'Email addresses',

        items: {
          type: 'object',
          description: 'Email addresses item',
          properties: {
            value: { type: 'string', description: 'Value', nullable: true },
            type: { type: 'string', description: 'Type', nullable: true },
          },
        },
      },
      website_addresses: {
        nullable: true,
        type: 'array',
        description: 'Website addresses',

        items: {
          type: 'object',
          description: 'Website addresses item',
          properties: {
            value: { type: 'string', description: 'Value', nullable: true },
            type: { type: 'string', description: 'Type', nullable: true },
          },
        },
      },
      social_media_addresses: {
        nullable: true,
        type: 'array',
        description: 'Social media addresses',

        items: {
          type: 'object',
          description: 'Social media addresses item',
          properties: {
            value: { type: 'string', description: 'Value', nullable: true },
          },
        },
      },
      custom_fields: {
        type: 'json',
        description:
          'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

        nullable: true,
      },
    },
  },
  application: {
    type: 'json',
    description: 'application created by this request',
    nullable: true,
    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', nullable: true },
      referrer_id: { type: 'number', description: 'Referrer ID', nullable: true },
      source_id: { type: 'number', description: 'Source ID', nullable: true },
      agency_note_id: {
        type: 'number',
        description: 'Agency note ID',

        nullable: true,
      },
      recruiter_id: { type: 'number', description: 'Recruiter ID', nullable: true },
      coordinator_id: {
        type: 'number',
        description: 'Coordinator ID',

        nullable: true,
      },
      needs_decision: {
        type: 'boolean',
        description: 'Needs decision',

        nullable: true,
      },
      prospect: { type: 'boolean', description: 'Prospect', nullable: true },
      rejected_at: {
        type: 'string',
        description: 'Rejected at (ISO 8601)',

        nullable: true,
      },
      created_at: {
        type: 'string',
        description: 'Creation time in ISO 8601 format',

        nullable: true,
      },
      updated_at: {
        type: 'string',
        description: 'Last update time in ISO 8601 format',

        nullable: true,
      },
      last_activity_at: {
        type: 'string',
        description: 'Last activity at (ISO 8601)',

        nullable: true,
      },
      stage_id: { type: 'number', description: 'Stage ID', nullable: true },
      job_interview_stage_id: {
        type: 'number',
        description: 'Job interview stage ID',

        nullable: true,
      },
      candidate_id: { type: 'number', description: 'Candidate ID', nullable: true },
      rejection_reason_id: {
        type: 'number',
        description: 'Rejection reason ID',

        nullable: true,
      },
      job_id: { type: 'number', description: 'Job ID', nullable: true },
      job_post_id: { type: 'number', description: 'Job post ID', nullable: true },
      status: {
        type: 'string',
        description: 'Status Allowed: rejected, hired, converted, in_process.',

        nullable: true,
      },
      stage_name: { type: 'string', description: 'Stage name', nullable: true },
      custom_fields: {
        type: 'json',
        description:
          'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',

        nullable: true,
      },
      location_address: {
        type: 'string',
        description: 'Location address',

        nullable: true,
      },
      answers: {
        nullable: true,
        type: 'array',
        description: 'Answers',

        items: {
          type: 'object',
          description: 'Answers item',
          properties: {
            question: { type: 'string', description: 'Question', nullable: true },
            answer: { type: 'string', description: 'Answer', nullable: true },
          },
        },
      },
      prospective_job_ids: {
        nullable: true,
        type: 'array',
        description: 'Prospective job IDs',

        items: { type: 'number', description: 'Prospective job IDs item' },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const DELETE_V2_OUTPUTS = {
  message: { type: 'string', description: 'Deletion confirmation returned by Greenhouse' },
} as const satisfies Record<string, ToolOutputProperty>

export const PAGE_V2_OUTPUTS = {
  count: { type: 'number', description: 'Number of records on this page' },
  nextCursor: {
    type: 'string',
    description: 'Opaque cursor from the next Link header; null on the last page',
    nullable: true,
  },
  hasMore: { type: 'boolean', description: 'Whether another page is available' },
} as const satisfies Record<string, ToolOutputProperty>
