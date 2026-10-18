import type { ToolOutputProperty } from '@/tools/types'

export const JOBS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  requisition_id: { type: 'string', description: 'Requisition ID', optional: true, nullable: true },
  notes: { type: 'string', description: 'Notes', optional: true, nullable: true },
  confidential: { type: 'boolean', description: 'Confidential', optional: true, nullable: true },
  status: {
    type: 'string',
    description: 'Status Allowed: open, draft, closed.',
    optional: true,
    nullable: true,
  },
  opened_at: {
    type: 'string',
    description: 'Opened at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  closed_at: {
    type: 'string',
    description: 'Closed at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  is_template: { type: 'boolean', description: 'Is template', optional: true, nullable: true },
  copied_from_id: { type: 'number', description: 'Copied from ID', optional: true, nullable: true },
  department_id: { type: 'number', description: 'Department ID', optional: true, nullable: true },
  external_department_id: {
    type: 'string',
    description: 'External department ID',
    optional: true,
    nullable: true,
  },
  office_ids: {
    type: 'array',
    description: 'Office IDs',
    optional: true,
    items: { type: 'number', description: 'Office IDs item', nullable: true },
  },
  external_office_ids: {
    type: 'array',
    description: 'External office IDs',
    optional: true,
    items: { type: 'string', description: 'External office IDs item', nullable: true },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATE_EMPLOYMENTS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
  company_name: { type: 'string', description: 'Company name', optional: true, nullable: true },
  title: { type: 'string', description: 'Title', optional: true, nullable: true },
  start_date: {
    type: 'string',
    description: 'Start date (YYYY-MM-DD)',
    optional: true,
    nullable: true,
  },
  end_date: {
    type: 'string',
    description: 'End date (YYYY-MM-DD)',
    optional: true,
    nullable: true,
  },
  latest: { type: 'boolean', description: 'Latest', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const REJECTION_REASONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  type: {
    nullable: true,
    type: 'json',
    description: 'Type',
    optional: true,
    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
      key: { type: 'string', description: 'Key', optional: true, nullable: true },
      name: { type: 'string', description: 'Name', optional: true, nullable: true },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const JOB_INTERVIEW_STAGES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
  sort_order: { type: 'number', description: 'Sort order', optional: true, nullable: true },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  active: { type: 'boolean', description: 'Active', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATE_TAGS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const APPLICATION_STAGES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  job_interview_stage_id: {
    type: 'number',
    description: 'Job interview stage ID',
    optional: true,
    nullable: true,
  },
  entered_at: {
    type: 'string',
    description: 'Entered at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  exited_at: {
    type: 'string',
    description: 'Exited at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  days_in_stage: { type: 'number', description: 'Days in stage', optional: true, nullable: true },
  current: { type: 'boolean', description: 'Current', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const USERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  first_name: { type: 'string', description: 'First name', optional: true, nullable: true },
  last_name: { type: 'string', description: 'Last name', optional: true, nullable: true },
  primary_email: { type: 'string', description: 'Primary email', optional: true, nullable: true },
  job_title: { type: 'string', description: 'Job title', optional: true, nullable: true },
  agency_id: { type: 'number', description: 'Agency ID', optional: true, nullable: true },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  deactivated: { type: 'boolean', description: 'Deactivated', optional: true, nullable: true },
  site_admin: { type: 'boolean', description: 'Site admin', optional: true, nullable: true },
  employee_id: { type: 'string', description: 'Employee ID', optional: true, nullable: true },
  linked_candidate_ids: {
    type: 'array',
    description: 'Linked candidate IDs',
    optional: true,
    items: { type: 'number', description: 'Linked candidate IDs item', nullable: true },
  },
  office_ids: {
    type: 'array',
    description: 'Office IDs',
    optional: true,
    items: { type: 'number', description: 'Office IDs item', nullable: true },
  },
  department_ids: {
    type: 'array',
    description: 'Department IDs',
    optional: true,
    items: { type: 'number', description: 'Department IDs item', nullable: true },
  },
  external_office_ids: {
    type: 'array',
    description: 'External office IDs',
    optional: true,
    items: { type: 'string', description: 'External office IDs item', nullable: true },
  },
  external_department_ids: {
    type: 'array',
    description: 'External department IDs',
    optional: true,
    items: { type: 'string', description: 'External department IDs item', nullable: true },
  },
  interviewer_tags: {
    type: 'array',
    description: 'Interviewer tags',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Interviewer tags item',
      properties: {
        id: {
          type: 'number',
          description: 'Greenhouse resource ID',
          optional: true,
          nullable: true,
        },
        name: { type: 'string', description: 'Name', optional: true, nullable: true },
      },
    },
  },
  emails: {
    type: 'array',
    description: 'Emails',
    optional: true,
    items: { type: 'string', description: 'Emails item', nullable: true },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const APPLIED_CANDIDATE_TAGS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  candidate_tag_id: {
    type: 'number',
    description: 'Candidate tag ID',
    optional: true,
    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const DEPARTMENTS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  parent_id: { type: 'number', description: 'Parent ID', optional: true, nullable: true },
  external_id: { type: 'string', description: 'External ID', optional: true, nullable: true },
  external_parent_id: {
    type: 'string',
    description: 'External parent ID',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const PROSPECT_POOL_STAGES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  prospect_pool_id: {
    type: 'number',
    description: 'Prospect pool ID',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  sort_order: { type: 'number', description: 'Sort order', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const INTERVIEWS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  job_interview_id: {
    type: 'number',
    description: 'Job interview ID',
    optional: true,
    nullable: true,
  },
  starts_at: {
    type: 'string',
    description: 'Starts at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  ends_at: { type: 'string', description: 'Ends at (ISO 8601)', optional: true, nullable: true },
  location: { type: 'string', description: 'Location', optional: true, nullable: true },
  status: {
    type: 'string',
    description:
      'Status Allowed: to_be_scheduled, scheduled, awaiting_feedback, complete, skipped, collect_feedback, to_be_sent, sent, received.',
    optional: true,
    nullable: true,
  },
  organizer_id: { type: 'number', description: 'Organizer ID', optional: true, nullable: true },
  scheduled_at: {
    type: 'string',
    description: 'Scheduled at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  all_day_start_on: {
    type: 'string',
    description: 'All day start on (YYYY-MM-DD)',
    optional: true,
    nullable: true,
  },
  all_day_end_on: {
    type: 'string',
    description: 'All day end on (YYYY-MM-DD)',
    optional: true,
    nullable: true,
  },
  external_event_id: {
    type: 'string',
    description: 'External event ID',
    optional: true,
    nullable: true,
  },
  video_conferencing_url: {
    type: 'string',
    description: 'Video conferencing url',
    optional: true,
    nullable: true,
  },
  availability_received_at: {
    type: 'string',
    description: 'Availability received at (ISO 8601)',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const SCORECARDS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  interview_kit_id: {
    type: 'number',
    description: 'Interview kit ID',
    optional: true,
    nullable: true,
  },
  interviewer_id: { type: 'number', description: 'Interviewer ID', optional: true, nullable: true },
  interviewed_at: {
    type: 'string',
    description: 'Interviewed at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  notes: { type: 'string', description: 'Notes', optional: true, nullable: true },
  notes_with_tags: {
    type: 'string',
    description: 'Notes with tags',
    optional: true,
    nullable: true,
  },
  submitter_id: { type: 'number', description: 'Submitter ID', optional: true, nullable: true },
  candidate_rating: {
    type: 'string',
    description: 'Candidate rating',
    optional: true,
    nullable: true,
  },
  private_notes: { type: 'string', description: 'Private notes', optional: true, nullable: true },
  private_notes_with_tags: {
    type: 'string',
    description: 'Private notes with tags',
    optional: true,
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Status Allowed: draft, complete.',
    optional: true,
    nullable: true,
  },
  public_notes: { type: 'string', description: 'Public notes', optional: true, nullable: true },
  public_notes_with_tags: {
    type: 'string',
    description: 'Public notes with tags',
    optional: true,
    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  submitted_at: {
    type: 'string',
    description: 'Submitted at (ISO 8601)',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const JOB_OWNERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
  user_id: { type: 'number', description: 'User ID', optional: true, nullable: true },
  type: {
    type: 'string',
    description: 'Type Allowed: sourcer, recruiter, coordinator.',
    optional: true,
    nullable: true,
  },
  responsible: { type: 'boolean', description: 'Responsible', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const PROSPECT_POOLS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  active: { type: 'boolean', description: 'Active', optional: true, nullable: true },
  description: { type: 'string', description: 'Description', optional: true, nullable: true },
  department_ids: {
    type: 'array',
    description: 'Department IDs',
    optional: true,
    items: { type: 'number', description: 'Department IDs item', nullable: true },
  },
  office_ids: {
    type: 'array',
    description: 'Office IDs',
    optional: true,
    items: { type: 'number', description: 'Office IDs item', nullable: true },
  },
  job_ids: {
    type: 'array',
    description: 'Job IDs',
    optional: true,
    items: { type: 'number', description: 'Job IDs item', nullable: true },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const ATTACHMENTS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
  type: {
    type: 'string',
    description:
      'Type Allowed: resume, cover_letter, take_home_test, offer_packet, offer_letter, signed_offer_letter, other, form_attachment, midfunnel_agreement, automated_agreement.',
    optional: true,
    nullable: true,
  },
  filename: { type: 'string', description: 'Filename', optional: true, nullable: true },
  url: {
    type: 'string',
    description: 'Provider URL; attachment download URLs are temporary.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const APPLICATIONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  agency_note_id: { type: 'number', description: 'Agency note ID', optional: true, nullable: true },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
  coordinator_id: { type: 'number', description: 'Coordinator ID', optional: true, nullable: true },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
  job_post_id: { type: 'number', description: 'Job post ID', optional: true, nullable: true },
  recruiter_id: { type: 'number', description: 'Recruiter ID', optional: true, nullable: true },
  referrer_id: { type: 'number', description: 'Referrer ID', optional: true, nullable: true },
  rejection_reason_id: {
    type: 'number',
    description: 'Rejection reason ID',
    optional: true,
    nullable: true,
  },
  source_id: { type: 'number', description: 'Source ID', optional: true, nullable: true },
  stage_id: { type: 'number', description: 'Stage ID', optional: true, nullable: true },
  job_interview_stage_id: {
    type: 'number',
    description: 'Job interview stage ID',
    optional: true,
    nullable: true,
  },
  stage_name: { type: 'string', description: 'Stage name', optional: true, nullable: true },
  status: {
    type: 'string',
    description: 'Status Allowed: rejected, hired, converted, in_process.',
    optional: true,
    nullable: true,
  },
  needs_decision: {
    type: 'boolean',
    description: 'Needs decision',
    optional: true,
    nullable: true,
  },
  prospect: { type: 'boolean', description: 'Prospect', optional: true, nullable: true },
  rejected_at: {
    type: 'string',
    description: 'Rejected at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  last_activity_at: {
    type: 'string',
    description: 'Last activity at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  location_address: {
    type: 'string',
    description: 'Location address',
    optional: true,
    nullable: true,
  },
  answers: {
    type: 'array',
    description: 'Answers',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Answers item',
      properties: {
        question: { type: 'string', description: 'Question', optional: true, nullable: true },
        answer: { type: 'string', description: 'Answer', optional: true, nullable: true },
      },
    },
  },
  prospective_job_ids: {
    type: 'array',
    description: 'Prospective job IDs',
    optional: true,
    items: { type: 'number', description: 'Prospective job IDs item', nullable: true },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATE_EDUCATIONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
  school_name_custom_field_option_id: {
    type: 'number',
    description: 'School name custom field option ID',
    optional: true,
    nullable: true,
  },
  degree_custom_field_option_id: {
    type: 'number',
    description: 'Degree custom field option ID',
    optional: true,
    nullable: true,
  },
  discipline_custom_field_option_id: {
    type: 'number',
    description: 'Discipline custom field option ID',
    optional: true,
    nullable: true,
  },
  start_at: { type: 'string', description: 'Start at (ISO 8601)', optional: true, nullable: true },
  end_at: { type: 'string', description: 'End at (ISO 8601)', optional: true, nullable: true },
  latest: { type: 'boolean', description: 'Latest', optional: true, nullable: true },
  start_date_month: {
    type: 'number',
    description: 'Start date month',
    optional: true,
    nullable: true,
  },
  start_date_year: {
    type: 'number',
    description: 'Start date year',
    optional: true,
    nullable: true,
  },
  end_date_month: { type: 'number', description: 'End date month', optional: true, nullable: true },
  end_date_year: { type: 'number', description: 'End date year', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const EMAIL_TEMPLATES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  email_type: { type: 'string', description: 'Email type', optional: true, nullable: true },
  subject: { type: 'string', description: 'Subject', optional: true, nullable: true },
  body: { type: 'string', description: 'Body', optional: true, nullable: true },
  user_id: { type: 'number', description: 'User ID', optional: true, nullable: true },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  description: { type: 'string', description: 'Description', optional: true, nullable: true },
  recipients: { type: 'string', description: 'Recipients', optional: true, nullable: true },
  default: { type: 'boolean', description: 'Default', optional: true, nullable: true },
  html_body: { type: 'string', description: 'Html body', optional: true, nullable: true },
  office_anywhere: {
    type: 'boolean',
    description: 'Office anywhere',
    optional: true,
    nullable: true,
  },
  from_type: {
    type: 'string',
    description:
      'From type Allowed: user_email, organization_email, my_email_address, inviter, organizer, not_applicable.',
    optional: true,
    nullable: true,
  },
  cc_recruiter: { type: 'boolean', description: 'Cc recruiter', optional: true, nullable: true },
  cc_coordinator: {
    type: 'boolean',
    description: 'Cc coordinator',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const REFERRERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  user_id: { type: 'number', description: 'User ID', optional: true, nullable: true },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const CLOSE_REASONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const CUSTOM_FIELD_OPTIONS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  custom_field_id: {
    type: 'number',
    description: 'Custom field ID',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  external_id: { type: 'string', description: 'External ID', optional: true, nullable: true },
  sort_order: { type: 'number', description: 'Sort order', optional: true, nullable: true },
  active: { type: 'boolean', description: 'Active', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const OFFERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  version: { type: 'number', description: 'Version', optional: true, nullable: true },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
  opening_id: {
    type: 'number',
    description: 'Opening ID; required when hiring into a job with multiple open openings.',
    optional: true,
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Status Allowed: Created, Accepted, Rejected, Deprecated.',
    optional: true,
    nullable: true,
  },
  starts_on: {
    type: 'string',
    description: 'Starts on (YYYY-MM-DD)',
    optional: true,
    nullable: true,
  },
  sent_on: { type: 'string', description: 'Sent on (YYYY-MM-DD)', optional: true, nullable: true },
  resolved_at: {
    type: 'string',
    description: 'Resolved at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const JOB_HIRING_MANAGERS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  user_id: { type: 'number', description: 'User ID', optional: true, nullable: true },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const OPENINGS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
  opened_at: {
    type: 'string',
    description: 'Opened at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  closed_at: {
    type: 'string',
    description: 'Closed at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  sort_order: { type: 'number', description: 'Sort order', optional: true, nullable: true },
  opening_id: {
    type: 'string',
    description: 'Opening ID; required when hiring into a job with multiple open openings.',
    optional: true,
    nullable: true,
  },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  close_reason_id: {
    type: 'number',
    description: 'Close reason ID',
    optional: true,
    nullable: true,
  },
  target_start_on: {
    type: 'string',
    description: 'Target start on (YYYY-MM-DD)',
    optional: true,
    nullable: true,
  },
  open: { type: 'boolean', description: 'Open', optional: true, nullable: true },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CUSTOM_FIELDS_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  field_type: {
    type: 'string',
    description:
      'Field type Allowed: job, opening, standard, offer, compensation_frequency, candidate, referral_question, application, rejection_question, form, agency_question, user_attribute.',
    optional: true,
    nullable: true,
  },
  sort_order: { type: 'number', description: 'Sort order', optional: true, nullable: true },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  value_type: {
    type: 'string',
    description:
      'Value type Allowed: short_text, long_text, yes_no, single_select, multi_select, currency, number, date, url, currency_range, number_range, user, linked, header, statement, attachment, rich_text.',
    optional: true,
    nullable: true,
  },
  private: {
    type: 'boolean',
    description:
      'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',
    optional: true,
    nullable: true,
  },
  required: { type: 'boolean', description: 'Required', optional: true, nullable: true },
  require_approval: {
    type: 'boolean',
    description: 'Require approval',
    optional: true,
    nullable: true,
  },
  trigger_new_version: {
    type: 'boolean',
    description: 'Trigger new version',
    optional: true,
    nullable: true,
  },
  active: { type: 'boolean', description: 'Active', optional: true, nullable: true },
  updated_by_id: { type: 'number', description: 'Updated by ID', optional: true, nullable: true },
  internal_type: {
    type: 'string',
    description:
      'Internal type Allowed: employment_type, offer_documents, start_date, school_name, degree, discipline, offer_opening.',
    optional: true,
    nullable: true,
  },
  expose_in_job_board_api: {
    type: 'boolean',
    description: 'Expose in job board api',
    optional: true,
    nullable: true,
  },
  placeholder: { type: 'string', description: 'Placeholder', optional: true, nullable: true },
  name_key: { type: 'string', description: 'Name key', optional: true, nullable: true },
  description: { type: 'string', description: 'Description', optional: true, nullable: true },
  application_type: {
    type: 'string',
    description:
      'Application type Allowed: all_applications, candidate_applications, prospect_applications.',
    optional: true,
    nullable: true,
  },
  api_only: { type: 'boolean', description: 'Api only', optional: true, nullable: true },
  use_for_job_approvals: {
    type: 'boolean',
    description: 'Use for job approvals',
    optional: true,
    nullable: true,
  },
  use_for_offer_approvals: {
    type: 'boolean',
    description: 'Use for offer approvals',
    optional: true,
    nullable: true,
  },
  template_token_string: {
    type: 'string',
    description: 'Template token string',
    optional: true,
    nullable: true,
  },
  default_value: { type: 'json', description: 'Default value', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const NOTES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
  application_id: { type: 'number', description: 'Application ID', optional: true, nullable: true },
  body: { type: 'string', description: 'Body', optional: true, nullable: true },
  subject: { type: 'string', description: 'Subject', optional: true, nullable: true },
  type: {
    type: 'string',
    description:
      'Type Allowed: NOTE, ACTIVITY, INTERVIEW, EMAIL, FOLLOW_UP, TAKE_HOME_TEST, LINKEDIN_NOTE, LINKEDIN_INMAIL, AVAILABILITY_REQUEST, MIGRATION_ERROR, TOUCHPOINT, FORM, FEEDBACK.',
    optional: true,
    nullable: true,
  },
  user_id: { type: 'number', description: 'User ID', optional: true, nullable: true },
  email_from: {
    type: 'string',
    description: 'Comma-separated sender addresses for an EMAIL note',
    optional: true,
    nullable: true,
  },
  email_to: {
    type: 'string',
    description: 'Comma-separated recipient addresses for an EMAIL note',
    optional: true,
    nullable: true,
  },
  email_cc: {
    type: 'array',
    description: 'CC addresses for an EMAIL note',
    optional: true,
    items: { type: 'string', description: 'Email cc item', nullable: true },
  },
  import_hash: { type: 'string', description: 'Import hash', optional: true, nullable: true },
  body_with_tags: { type: 'string', description: 'Body with tags', optional: true, nullable: true },
  visibility: {
    type: 'string',
    description: 'Visibility Allowed: admin_only_visible, privately_visible, publicly_visible.',
    optional: true,
    nullable: true,
  },
  email_attachment_file_names: {
    type: 'string',
    description: 'Email attachment file names',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const OFFICES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  parent_id: { type: 'number', description: 'Parent ID', optional: true, nullable: true },
  external_id: { type: 'string', description: 'External ID', optional: true, nullable: true },
  external_parent_id: {
    type: 'string',
    description: 'External parent ID',
    optional: true,
    nullable: true,
  },
  location: { type: 'string', description: 'Location', optional: true, nullable: true },
  primary_in_house_contact_user_id: {
    type: 'number',
    description: 'Primary in house contact user ID',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const SOURCES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  name: { type: 'string', description: 'Name', optional: true, nullable: true },
  type: {
    nullable: true,
    type: 'json',
    description: 'Type',
    optional: true,
    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
      name: { type: 'string', description: 'Name', optional: true, nullable: true },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CANDIDATES_V2_OUTPUTS = {
  id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
  created_at: {
    type: 'string',
    description: 'Creation time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'Last update time in ISO 8601 format',
    optional: true,
    nullable: true,
  },
  first_name: { type: 'string', description: 'First name', optional: true, nullable: true },
  last_name: { type: 'string', description: 'Last name', optional: true, nullable: true },
  preferred_name: { type: 'string', description: 'Preferred name', optional: true, nullable: true },
  company: { type: 'string', description: 'Company', optional: true, nullable: true },
  title: { type: 'string', description: 'Title', optional: true, nullable: true },
  last_activity_at: {
    type: 'string',
    description: 'Last activity at (ISO 8601)',
    optional: true,
    nullable: true,
  },
  private: {
    type: 'boolean',
    description:
      'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',
    optional: true,
    nullable: true,
  },
  can_email: {
    type: 'boolean',
    description: 'Whether the candidate consents to email communication.',
    optional: true,
    nullable: true,
  },
  time_zone: {
    type: 'string',
    description: 'Greenhouse time-zone identifier (for example, eastern time (us & canada)).',
    optional: true,
    nullable: true,
  },
  tags: {
    type: 'array',
    description: 'Tags',
    optional: true,
    items: { type: 'string', description: 'Tags item', nullable: true },
  },
  linked_user_ids: {
    type: 'array',
    description: 'Linked user IDs',
    optional: true,
    items: { type: 'number', description: 'Linked user IDs item', nullable: true },
  },
  phone_numbers: {
    type: 'array',
    description: 'Phone numbers',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Phone numbers item',
      properties: {
        value: { type: 'string', description: 'Value', optional: true, nullable: true },
        type: { type: 'string', description: 'Type', optional: true, nullable: true },
      },
    },
  },
  addresses: {
    type: 'array',
    description: 'Addresses',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Addresses item',
      properties: {
        value: { type: 'string', description: 'Value', optional: true, nullable: true },
        type: { type: 'string', description: 'Type', optional: true, nullable: true },
      },
    },
  },
  email_addresses: {
    type: 'array',
    description: 'Email addresses',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Email addresses item',
      properties: {
        value: { type: 'string', description: 'Value', optional: true, nullable: true },
        type: { type: 'string', description: 'Type', optional: true, nullable: true },
      },
    },
  },
  website_addresses: {
    type: 'array',
    description: 'Website addresses',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Website addresses item',
      properties: {
        value: { type: 'string', description: 'Value', optional: true, nullable: true },
        type: { type: 'string', description: 'Type', optional: true, nullable: true },
      },
    },
  },
  social_media_addresses: {
    type: 'array',
    description: 'Social media addresses',
    optional: true,
    items: {
      nullable: true,
      type: 'object',
      description: 'Social media addresses item',
      properties: {
        value: { type: 'string', description: 'Value', optional: true, nullable: true },
      },
    },
  },
  custom_fields: {
    type: 'json',
    description:
      'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const CREATE_CANDIDATE_V2_OUTPUTS = {
  candidate: {
    type: 'json',
    description: 'candidate created by this request',
    nullable: true,
    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
      first_name: { type: 'string', description: 'First name', optional: true, nullable: true },
      last_name: { type: 'string', description: 'Last name', optional: true, nullable: true },
      preferred_name: {
        type: 'string',
        description: 'Preferred name',
        optional: true,
        nullable: true,
      },
      company: { type: 'string', description: 'Company', optional: true, nullable: true },
      title: { type: 'string', description: 'Title', optional: true, nullable: true },
      created_at: {
        type: 'string',
        description: 'Creation time in ISO 8601 format',
        optional: true,
        nullable: true,
      },
      updated_at: {
        type: 'string',
        description: 'Last update time in ISO 8601 format',
        optional: true,
        nullable: true,
      },
      can_email: {
        type: 'boolean',
        description: 'Whether the candidate consents to email communication.',
        optional: true,
        nullable: true,
      },
      time_zone: {
        type: 'string',
        description: 'Greenhouse time-zone identifier (for example, eastern time (us & canada)).',
        optional: true,
        nullable: true,
      },
      last_activity_at: {
        type: 'string',
        description: 'Last activity at (ISO 8601)',
        optional: true,
        nullable: true,
      },
      private: {
        type: 'boolean',
        description:
          'Candidate or custom-field privacy flag; for candidate listing, false excludes private candidates.',
        optional: true,
        nullable: true,
      },
      tags: {
        type: 'array',
        description: 'Tags',
        optional: true,
        items: { type: 'string', description: 'Tags item', nullable: true },
      },
      linked_user_ids: {
        type: 'array',
        description: 'Linked user IDs',
        optional: true,
        items: { type: 'number', description: 'Linked user IDs item', nullable: true },
      },
      phone_numbers: {
        type: 'array',
        description: 'Phone numbers',
        optional: true,
        items: {
          nullable: true,
          type: 'object',
          description: 'Phone numbers item',
          properties: {
            value: { type: 'string', description: 'Value', optional: true, nullable: true },
            type: { type: 'string', description: 'Type', optional: true, nullable: true },
          },
        },
      },
      addresses: {
        type: 'array',
        description: 'Addresses',
        optional: true,
        items: {
          nullable: true,
          type: 'object',
          description: 'Addresses item',
          properties: {
            value: { type: 'string', description: 'Value', optional: true, nullable: true },
            type: { type: 'string', description: 'Type', optional: true, nullable: true },
          },
        },
      },
      email_addresses: {
        type: 'array',
        description: 'Email addresses',
        optional: true,
        items: {
          nullable: true,
          type: 'object',
          description: 'Email addresses item',
          properties: {
            value: { type: 'string', description: 'Value', optional: true, nullable: true },
            type: { type: 'string', description: 'Type', optional: true, nullable: true },
          },
        },
      },
      website_addresses: {
        type: 'array',
        description: 'Website addresses',
        optional: true,
        items: {
          nullable: true,
          type: 'object',
          description: 'Website addresses item',
          properties: {
            value: { type: 'string', description: 'Value', optional: true, nullable: true },
            type: { type: 'string', description: 'Type', optional: true, nullable: true },
          },
        },
      },
      social_media_addresses: {
        type: 'array',
        description: 'Social media addresses',
        optional: true,
        items: {
          nullable: true,
          type: 'object',
          description: 'Social media addresses item',
          properties: {
            value: { type: 'string', description: 'Value', optional: true, nullable: true },
          },
        },
      },
      custom_fields: {
        type: 'json',
        description:
          'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
        optional: true,
        nullable: true,
      },
    },
  },
  application: {
    type: 'json',
    description: 'application created by this request',
    nullable: true,
    properties: {
      id: { type: 'number', description: 'Greenhouse resource ID', optional: true, nullable: true },
      referrer_id: { type: 'number', description: 'Referrer ID', optional: true, nullable: true },
      source_id: { type: 'number', description: 'Source ID', optional: true, nullable: true },
      agency_note_id: {
        type: 'number',
        description: 'Agency note ID',
        optional: true,
        nullable: true,
      },
      recruiter_id: { type: 'number', description: 'Recruiter ID', optional: true, nullable: true },
      coordinator_id: {
        type: 'number',
        description: 'Coordinator ID',
        optional: true,
        nullable: true,
      },
      needs_decision: {
        type: 'boolean',
        description: 'Needs decision',
        optional: true,
        nullable: true,
      },
      prospect: { type: 'boolean', description: 'Prospect', optional: true, nullable: true },
      rejected_at: {
        type: 'string',
        description: 'Rejected at (ISO 8601)',
        optional: true,
        nullable: true,
      },
      created_at: {
        type: 'string',
        description: 'Creation time in ISO 8601 format',
        optional: true,
        nullable: true,
      },
      updated_at: {
        type: 'string',
        description: 'Last update time in ISO 8601 format',
        optional: true,
        nullable: true,
      },
      last_activity_at: {
        type: 'string',
        description: 'Last activity at (ISO 8601)',
        optional: true,
        nullable: true,
      },
      stage_id: { type: 'number', description: 'Stage ID', optional: true, nullable: true },
      job_interview_stage_id: {
        type: 'number',
        description: 'Job interview stage ID',
        optional: true,
        nullable: true,
      },
      candidate_id: { type: 'number', description: 'Candidate ID', optional: true, nullable: true },
      rejection_reason_id: {
        type: 'number',
        description: 'Rejection reason ID',
        optional: true,
        nullable: true,
      },
      job_id: { type: 'number', description: 'Job ID', optional: true, nullable: true },
      job_post_id: { type: 'number', description: 'Job post ID', optional: true, nullable: true },
      status: {
        type: 'string',
        description: 'Status Allowed: rejected, hired, converted, in_process.',
        optional: true,
        nullable: true,
      },
      stage_name: { type: 'string', description: 'Stage name', optional: true, nullable: true },
      custom_fields: {
        type: 'json',
        description:
          'Custom fields keyed by field name, each containing name, type, and the dynamically typed value.',
        optional: true,
        nullable: true,
      },
      location_address: {
        type: 'string',
        description: 'Location address',
        optional: true,
        nullable: true,
      },
      answers: {
        type: 'array',
        description: 'Answers',
        optional: true,
        items: {
          nullable: true,
          type: 'object',
          description: 'Answers item',
          properties: {
            question: { type: 'string', description: 'Question', optional: true, nullable: true },
            answer: { type: 'string', description: 'Answer', optional: true, nullable: true },
          },
        },
      },
      prospective_job_ids: {
        type: 'array',
        description: 'Prospective job IDs',
        optional: true,
        items: { type: 'number', description: 'Prospective job IDs item', nullable: true },
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
