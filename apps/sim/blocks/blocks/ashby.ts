import { getErrorMessage } from '@sim/utils/errors'
import { AshbyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { getTrigger } from '@/triggers'

function parseStringListInput(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {}
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseSocialLinksInput(value: unknown): Array<{ type: string; url: string }> {
  if (Array.isArray(value)) return value as Array<{ type: string; url: string }>
  if (typeof value !== 'string' || !value.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(
      `Invalid JSON in Ashby social links: ${getErrorMessage(error)}. Expected a JSON array like [{"type":"Twitter","url":"https://twitter.com/x"}].`
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'Invalid Ashby social links: expected a JSON array like [{"type":"Twitter","url":"https://twitter.com/x"}].'
    )
  }
  return parsed
}

/**
 * Parses an Ashby custom field value from the block input. Ashby custom fields
 * are polymorphic, so structured input is decoded to give Currency, NumberRange,
 * MultiValueSelect, Boolean, Number, and cleared fields the right wire type,
 * while everything else passes through as a plain string, which String,
 * LongText, Date, Url, and ValueSelect fields accept.
 *
 * Decoding is deliberately narrow rather than a blanket `JSON.parse`. Parsing
 * every string that happens to be valid JSON corrupts real text: `1e999` becomes
 * Infinity and serializes back out as `null`, which CLEARS the field; a long
 * numeric id loses precision past 2^53; and pasted prose that starts with `{`
 * turns into an object. So only these forms decode:
 *
 * - `null`, `true`, `false` - the literal keywords
 * - text starting with `{`, `[`, or `"` - objects, arrays, and quoted strings
 * - numbers that survive a round trip exactly, which excludes Infinity,
 *   precision loss, and leading zeros
 *
 * The remaining trade-off is that the text `123` becomes the number 123. A field
 * that needs the literal string can be quoted (`"123"`), which decodes back to it.
 */
function parseCustomFieldValueInput(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value

  if (trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  const first = trimmed[0]
  if (first === '{' || first === '[' || first === '"') {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed)
    if (Number.isFinite(asNumber) && String(asNumber) === trimmed) return asNumber
  }

  return value
}

function parseCustomFieldValuesInput(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(
      `Invalid JSON in Ashby custom field values: ${getErrorMessage(error)}. Expected a JSON array like [{"fieldId":"<uuid>","fieldValue":"High"}].`
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'Invalid Ashby custom field values: expected a JSON array like [{"fieldId":"<uuid>","fieldValue":"High"}].'
    )
  }
  return parsed
}

function parseJsonArrayInput(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${getErrorMessage(error)}.`)
  }
  throw new Error(`Invalid ${label}: expected a JSON array.`)
}

function parseJsonObjectInput(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch (error) {
      throw new Error(`Invalid JSON in ${label}: ${getErrorMessage(error)}.`)
    }
  }
  throw new Error(`Invalid ${label}: expected a JSON object.`)
}

export const AshbyBlock: BlockConfig = {
  type: 'ashby',
  name: 'Ashby',
  description: 'Manage candidates, jobs, and applications in Ashby',
  longDescription:
    'Integrate Ashby into the workflow. Manage and search candidates, applications, jobs, users, and openings; transfer applications; upload resumes and candidate files; read application history and interview feedback; manage offers, notes, tags, stages, sources, and custom fields; and react to hiring lifecycle webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/ashby',
  category: 'tools',
  integrationType: IntegrationType.HR,
  bgColor: '#5D4ED6',
  iconColor: '#5D4ED6',
  icon: AshbyIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Ashby',
    sentences: {
      byOperation: {
        list_candidates: ['List candidates', { text: ', created after', field: 'createdAfter' }],
        get_candidate: [
          'Read candidate',
          { text: 'by ID', field: 'candidateId' },
          { text: 'by external mapping', field: 'externalMappingId' },
        ],
        create_candidate: [
          { text: 'Create candidate', field: 'name', core: true },
          { text: 'with email', field: 'email' },
          { text: ', reachable at', field: 'phoneNumber' },
        ],
        update_candidate: [
          { text: 'Update candidate', field: 'candidateId', core: true },
          { text: ', renaming to', field: 'updateName' },
          { text: ', with email', field: 'email' },
        ],
        search_candidates: [
          'Search candidates',
          { text: ', by name', field: 'searchName' },
          { text: ', by email', field: 'searchEmail' },
        ],
        list_jobs: [
          'List jobs',
          { text: ', with status', field: 'jobStatus' },
          { text: ', opened after', field: 'openedAfter' },
          { text: ', opened before', field: 'openedBefore' },
        ],
        get_job: [{ text: 'Read job', field: 'jobId', core: true }],
        create_note: [
          { text: 'Add note', field: 'note', core: true },
          { text: 'to candidate', field: 'candidateId', core: true },
        ],
        list_notes: [{ text: 'List notes on candidate', field: 'candidateId', core: true }],
        list_applications: [
          'List applications',
          { text: ', with status', field: 'filterStatus' },
          { text: ', for job', field: 'filterJobId' },
          { text: ', created after', field: 'createdAfter' },
        ],
        get_application: [
          'Read application',
          { text: 'by ID', field: 'applicationId' },
          { text: 'by submitted form', field: 'submittedFormInstanceId' },
        ],
        create_application: [
          { text: 'Create an application for candidate', field: 'appCandidateId', core: true },
          { text: 'on job', field: 'jobId' },
        ],
        list_offers: [
          'List offers',
          { text: ', for application', field: 'offerApplicationId' },
          { text: ', created after', field: 'createdAfter' },
        ],
        delete_application: [{ text: 'Delete application', field: 'applicationId', core: true }],
        change_application_stage: [
          { text: 'Move application', field: 'applicationId', core: true },
          { text: 'to stage', field: 'interviewStageId' },
          { text: ', with archive reason', field: 'archiveReasonId' },
        ],
        change_application_source: [
          { text: 'Attribute application', field: 'applicationId', core: true },
          { text: 'to source', field: 'changeSourceId' },
        ],
        anonymize_candidate: [{ text: 'Anonymize candidate', field: 'candidateId', core: true }],
        add_candidate_tag: [
          { text: 'Add tag', field: 'tagId', core: true },
          { text: 'to candidate', field: 'candidateId', core: true },
        ],
        remove_candidate_tag: [
          { text: 'Remove tag', field: 'tagId', core: true },
          { text: 'from candidate', field: 'candidateId', core: true },
        ],
        get_offer: [{ text: 'Read offer', field: 'offerId', core: true }],
        list_sources: ['List candidate sources'],
        list_candidate_tags: ['List candidate tags'],
        list_archive_reasons: ['List archive reasons'],
        list_custom_fields: ['List custom field definitions'],
        set_custom_field_value: [
          { text: 'Set custom field', field: 'fieldId', core: true },
          { text: 'on', field: 'objectType' },
          { text: 'to', field: 'fieldValue' },
        ],
        set_custom_field_values: [
          { text: 'Set custom fields on', field: 'objectType', core: true },
          { text: 'record', field: 'objectId', core: true },
        ],
        list_departments: ['List departments'],
        list_locations: ['List locations'],
        list_job_postings: [
          'List job postings',
          { text: ', in', field: 'postingLocation' },
          { text: ', for department', field: 'postingDepartment' },
          { text: ', on board', field: 'jobBoardId' },
        ],
        get_job_posting: [{ text: 'Read job posting', field: 'jobPostingId', core: true }],
        list_openings: ['List openings', { text: ', created after', field: 'createdAfter' }],
        list_users: ['List users'],
        list_interviews: [
          'List interview schedules',
          { text: ', for application', field: 'applicationId' },
          { text: ', at stage', field: 'interviewStageId' },
        ],
        list_interview_plans: ['List interview plans'],
        list_interview_stages: [
          'List stages in interview plan',
          { text: '', field: 'interviewPlanId' },
        ],
        list_application_feedback: [
          'List application feedback',
          { text: ', for application', field: 'applicationId' },
        ],
        list_application_history: [
          { text: 'List history for application', field: 'applicationId', core: true },
        ],
        search_jobs: [
          'Search jobs',
          { text: ', by title', field: 'searchJobTitle' },
          { text: ', by requisition', field: 'requisitionId' },
        ],
        search_users: [{ text: 'Find Ashby user', field: 'userEmail', core: true }],
        get_opening: [{ text: 'Read opening', field: 'openingId', core: true }],
        search_openings: [{ text: 'Find opening', field: 'openingIdentifier', core: true }],
        transfer_application: [
          { text: 'Transfer application', field: 'applicationId', core: true },
          { text: 'to job', field: 'jobId', core: true },
        ],
        upload_resume: [{ text: 'Upload resume for candidate', field: 'candidateId', core: true }],
        upload_candidate_file: [
          { text: 'Attach file to candidate', field: 'candidateId', core: true },
        ],
      },
    },
  },

  triggers: {
    enabled: true,
    available: [
      'ashby_application_submit',
      'ashby_application_update',
      'ashby_candidate_stage_change',
      'ashby_candidate_hire',
      'ashby_candidate_delete',
      'ashby_candidate_merge',
      'ashby_interview_schedule_create',
      'ashby_interview_schedule_update',
      'ashby_job_create',
      'ashby_job_update',
      'ashby_job_posting_update',
      'ashby_job_posting_delete',
      'ashby_offer_create',
      'ashby_offer_update',
      'ashby_offer_delete',
      'ashby_opening_create',
      'ashby_signature_request_update',
    ],
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Candidates', id: 'list_candidates' },
        { label: 'Get Candidate', id: 'get_candidate' },
        { label: 'Create Candidate', id: 'create_candidate' },
        { label: 'Update Candidate', id: 'update_candidate' },
        { label: 'Search Candidates', id: 'search_candidates' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'Get Job', id: 'get_job' },
        { label: 'Create Note', id: 'create_note' },
        { label: 'List Notes', id: 'list_notes' },
        { label: 'List Applications', id: 'list_applications' },
        { label: 'Get Application', id: 'get_application' },
        { label: 'Create Application', id: 'create_application' },
        { label: 'Delete Application', id: 'delete_application' },
        { label: 'List Offers', id: 'list_offers' },
        { label: 'Change Application Stage', id: 'change_application_stage' },
        { label: 'Change Application Source', id: 'change_application_source' },
        { label: 'Anonymize Candidate', id: 'anonymize_candidate' },
        { label: 'Add Candidate Tag', id: 'add_candidate_tag' },
        { label: 'Remove Candidate Tag', id: 'remove_candidate_tag' },
        { label: 'Get Offer', id: 'get_offer' },
        { label: 'List Sources', id: 'list_sources' },
        { label: 'List Candidate Tags', id: 'list_candidate_tags' },
        { label: 'List Archive Reasons', id: 'list_archive_reasons' },
        { label: 'List Custom Fields', id: 'list_custom_fields' },
        { label: 'Set Custom Field Value', id: 'set_custom_field_value' },
        { label: 'Set Custom Field Values', id: 'set_custom_field_values' },
        { label: 'List Departments', id: 'list_departments' },
        { label: 'List Locations', id: 'list_locations' },
        { label: 'List Job Postings', id: 'list_job_postings' },
        { label: 'Get Job Posting', id: 'get_job_posting' },
        { label: 'List Openings', id: 'list_openings' },
        { label: 'List Users', id: 'list_users' },
        { label: 'List Interviews', id: 'list_interviews' },
        { label: 'List Interview Plans', id: 'list_interview_plans' },
        { label: 'List Interview Stages', id: 'list_interview_stages' },
        { label: 'List Application Feedback', id: 'list_application_feedback' },
        { label: 'List Application History', id: 'list_application_history' },
        { label: 'Search Jobs', id: 'search_jobs' },
        { label: 'Search Users', id: 'search_users' },
        { label: 'Get Opening', id: 'get_opening' },
        { label: 'Search Openings', id: 'search_openings' },
        { label: 'Transfer Application', id: 'transfer_application' },
        { label: 'Upload Resume', id: 'upload_resume' },
        { label: 'Upload Candidate File', id: 'upload_candidate_file' },
      ],
      value: () => 'list_candidates',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Ashby API key',
      password: true,
    },
    {
      id: 'candidateId',
      title: 'Candidate ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: [
          'create_note',
          'list_notes',
          'update_candidate',
          'add_candidate_tag',
          'remove_candidate_tag',
          'anonymize_candidate',
          'upload_resume',
          'upload_candidate_file',
        ],
      },
      placeholder: 'Enter candidate UUID',
      condition: {
        field: 'operation',
        value: [
          'get_candidate',
          'create_note',
          'list_notes',
          'update_candidate',
          'add_candidate_tag',
          'remove_candidate_tag',
          'anonymize_candidate',
          'upload_resume',
          'upload_candidate_file',
        ],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      required: { field: 'operation', value: 'create_candidate' },
      placeholder: 'Full name (e.g. Jane Smith)',
      condition: { field: 'operation', value: 'create_candidate' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email address',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: 'Phone number',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      mode: 'advanced',
    },
    {
      id: 'linkedInUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/...',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      mode: 'advanced',
    },
    {
      id: 'githubUrl',
      title: 'GitHub URL',
      type: 'short-input',
      placeholder: 'https://github.com/...',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      mode: 'advanced',
    },
    {
      id: 'sourceId',
      title: 'Source ID',
      type: 'short-input',
      placeholder: 'Source UUID to attribute the candidate to',
      condition: {
        field: 'operation',
        value: ['create_candidate', 'update_candidate', 'create_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'website',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: 'create_candidate' },
      mode: 'advanced',
    },
    {
      id: 'alternateEmail',
      title: 'Alternate Email',
      type: 'short-input',
      placeholder: 'Additional email address',
      condition: { field: 'operation', value: 'update_candidate' },
      mode: 'advanced',
    },
    {
      id: 'candidateCreatedAt',
      title: 'Created At',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Examples:
- "last week" -> One week ago from today at 00:00:00Z
- "January 1st 2024" -> 2024-01-01T00:00:00Z
- "30 days ago" -> 30 days before today at 00:00:00Z
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'candidateLocation',
      title: 'Location',
      type: 'code',
      mode: 'advanced',
      placeholder: '{"city":"San Francisco","region":"California","country":"United States"}',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
    },
    {
      id: 'clearCandidateSource',
      title: 'Clear Candidate Source',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_candidate' },
    },
    {
      id: 'clearCreditedToUser',
      title: 'Clear Credited User',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_candidate' },
    },
    {
      id: 'updateName',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Updated full name',
      condition: { field: 'operation', value: 'update_candidate' },
      mode: 'advanced',
    },
    {
      id: 'websiteUrl',
      title: 'Website URL',
      type: 'short-input',
      placeholder: 'https://example.com',
      condition: { field: 'operation', value: 'update_candidate' },
      mode: 'advanced',
    },
    {
      id: 'searchName',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Search by candidate name',
      condition: { field: 'operation', value: 'search_candidates' },
    },
    {
      id: 'searchEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Search by candidate email',
      condition: { field: 'operation', value: 'search_candidates' },
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['get_job', 'create_application', 'transfer_application'],
      },
      placeholder: 'Enter job UUID',
      condition: {
        field: 'operation',
        value: ['get_job', 'create_application', 'transfer_application'],
      },
    },
    {
      id: 'applicationId',
      title: 'Application ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: [
          'change_application_stage',
          'change_application_source',
          'delete_application',
          'list_application_history',
          'transfer_application',
        ],
      },
      placeholder: 'Enter application UUID',
      condition: {
        field: 'operation',
        value: [
          'get_application',
          'change_application_stage',
          'change_application_source',
          'delete_application',
          'list_interviews',
          'list_application_feedback',
          'list_application_history',
          'transfer_application',
        ],
      },
    },
    {
      id: 'appCandidateId',
      title: 'Candidate ID',
      type: 'short-input',
      required: { field: 'operation', value: 'create_application' },
      placeholder: 'Enter candidate UUID',
      condition: { field: 'operation', value: 'create_application' },
    },
    {
      id: 'interviewPlanId',
      title: 'Interview Plan ID',
      type: 'short-input',
      required: { field: 'operation', value: ['list_interview_stages', 'transfer_application'] },
      placeholder: 'Interview plan UUID (defaults to job default)',
      condition: {
        field: 'operation',
        value: ['create_application', 'list_interview_stages', 'transfer_application'],
      },
      mode: 'advanced',
    },
    {
      id: 'interviewStageId',
      title: 'Interview Stage ID',
      type: 'short-input',
      required: { field: 'operation', value: ['change_application_stage', 'transfer_application'] },
      placeholder: 'Interview stage UUID',
      condition: {
        field: 'operation',
        value: [
          'create_application',
          'change_application_stage',
          'list_interviews',
          'transfer_application',
        ],
      },
    },
    {
      id: 'creditedToUserId',
      title: 'Credited To User ID',
      type: 'short-input',
      placeholder: 'User UUID credited as the source of this record',
      condition: {
        field: 'operation',
        value: ['create_application', 'create_candidate', 'update_candidate'],
      },
      mode: 'advanced',
    },
    {
      id: 'appCreatedAt',
      title: 'Created At',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'create_application' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Examples:
- "last week" -> One week ago from today at 00:00:00Z
- "January 1st 2024" -> 2024-01-01T00:00:00Z
- "30 days ago" -> 30 days before today at 00:00:00Z
- "start of this month" -> First day of current month at 00:00:00Z
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'note',
      title: 'Note',
      type: 'long-input',
      required: { field: 'operation', value: 'create_note' },
      placeholder: 'Enter note content',
      condition: { field: 'operation', value: 'create_note' },
    },
    {
      id: 'noteType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text/plain' },
        { label: 'HTML', id: 'text/html' },
      ],
      value: () => 'text/plain',
      condition: { field: 'operation', value: 'create_note' },
      mode: 'advanced',
    },
    {
      id: 'sendNotifications',
      title: 'Send Notifications',
      type: 'switch',
      condition: { field: 'operation', value: ['create_note', 'update_candidate'] },
      mode: 'advanced',
    },
    {
      id: 'isPrivate',
      title: 'Private Note',
      type: 'switch',
      condition: { field: 'operation', value: 'create_note' },
      mode: 'advanced',
    },
    {
      id: 'noteCreatedAt',
      title: 'Created At',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'create_note' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Examples:
- "yesterday" -> Yesterday at 00:00:00Z
- "January 1st 2024" -> 2024-01-01T00:00:00Z
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'filterStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active', id: 'Active' },
        { label: 'Hired', id: 'Hired' },
        { label: 'Archived', id: 'Archived' },
        { label: 'Lead', id: 'Lead' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_applications' },
      mode: 'advanced',
    },
    {
      id: 'filterJobId',
      title: 'Job ID Filter',
      type: 'short-input',
      placeholder: 'Filter by job UUID',
      condition: { field: 'operation', value: 'list_applications' },
      mode: 'advanced',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: {
        field: 'operation',
        value: [
          'list_applications',
          'list_candidates',
          'list_jobs',
          'list_offers',
          'list_openings',
          'list_interviews',
          'list_application_feedback',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Examples:
- "last week" -> One week ago from today at 00:00:00Z
- "January 1st 2024" -> 2024-01-01T00:00:00Z
- "30 days ago" -> 30 days before today at 00:00:00Z
- "start of this month" -> First day of current month at 00:00:00Z
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'openedAfter',
      title: 'Opened After',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: ['list_candidates', 'list_applications'] },
    },
    {
      id: 'openedBefore',
      title: 'Opened Before',
      type: 'short-input',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'list_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'closedAfter',
      title: 'Closed After',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'closedBefore',
      title: 'Closed Before',
      type: 'short-input',
      placeholder: 'e.g. 2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'list_jobs' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
Output only the ISO 8601 timestamp string, nothing else.`,
        generationType: 'timestamp',
      },
    },
    {
      id: 'jobStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Open', id: 'Open' },
        { label: 'Closed', id: 'Closed' },
        { label: 'Archived', id: 'Archived' },
        { label: 'Draft', id: 'Draft' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_jobs' },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: [
          'list_candidates',
          'list_jobs',
          'list_applications',
          'list_notes',
          'list_offers',
          'list_openings',
          'list_users',
          'list_interviews',
          'list_candidate_tags',
          'list_locations',
          'list_departments',
          'list_custom_fields',
          'list_application_feedback',
          'list_application_history',
          'list_interview_plans',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'perPage',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page (default 100)',
      condition: {
        field: 'operation',
        value: [
          'list_candidates',
          'list_jobs',
          'list_applications',
          'list_notes',
          'list_offers',
          'list_openings',
          'list_users',
          'list_interviews',
          'list_candidate_tags',
          'list_locations',
          'list_departments',
          'list_custom_fields',
          'list_candidates',
          'list_applications',
          'list_openings',
          'list_users',
          'list_interviews',
          'list_application_feedback',
          'list_interview_plans',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'syncToken',
      title: 'Sync Token',
      type: 'short-input',
      placeholder: 'Sync token for incremental updates',
      condition: {
        field: 'operation',
        value: [
          'list_candidate_tags',
          'list_locations',
          'list_interview_plans',
          'list_departments',
          'list_custom_fields',
          'list_offers',
          'list_jobs',
          'list_application_feedback',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'includeLocationHierarchy',
      title: 'Include Location Hierarchy',
      type: 'switch',
      condition: { field: 'operation', value: 'list_locations' },
      mode: 'advanced',
    },
    {
      id: 'offerApplicationId',
      title: 'Application ID Filter',
      type: 'short-input',
      placeholder: 'Filter offers by application UUID',
      condition: { field: 'operation', value: 'list_offers' },
      mode: 'advanced',
    },
    {
      id: 'offerStatus',
      title: 'Offer Status Filters',
      type: 'code',
      mode: 'advanced',
      placeholder: '["WaitingOnCandidateResponse","CandidateAccepted"]',
      condition: { field: 'operation', value: 'list_offers' },
    },
    {
      id: 'acceptanceStatus',
      title: 'Acceptance Status Filters',
      type: 'code',
      mode: 'advanced',
      placeholder: '["Pending","Accepted"]',
      condition: { field: 'operation', value: 'list_offers' },
    },
    {
      id: 'approvalStatus',
      title: 'Approval Status Filters',
      type: 'code',
      mode: 'advanced',
      placeholder: '["Approved"]',
      condition: { field: 'operation', value: 'list_offers' },
    },
    {
      id: 'alternateEmailAddresses',
      title: 'Alternate Email Addresses',
      type: 'long-input',
      placeholder: 'Comma-separated or JSON array (e.g. ["a@x.com","b@x.com"])',
      condition: { field: 'operation', value: 'create_candidate' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated or JSON array of email addresses based on the user's description.
Examples:
- "her work and personal emails" -> ["work@company.com","personal@example.com"]
Output only the list, nothing else.`,
      },
    },
    {
      id: 'socialLinks',
      title: 'Social Links',
      type: 'long-input',
      placeholder: 'JSON array (e.g. [{"type":"Twitter","url":"https://twitter.com/x"}])',
      condition: { field: 'operation', value: 'update_candidate' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of social link objects ({"type","url"}) based on the user's description.
Examples:
- "his Twitter is @jane and portfolio is jane.dev" -> [{"type":"Twitter","url":"https://twitter.com/jane"},{"type":"Portfolio","url":"https://jane.dev"}]
Output only the JSON array, nothing else.`,
      },
    },
    {
      id: 'includeArchived',
      title: 'Include Archived',
      type: 'switch',
      condition: {
        field: 'operation',
        value: [
          'list_candidate_tags',
          'list_archive_reasons',
          'list_sources',
          'list_departments',
          'list_custom_fields',
          'list_locations',
          'list_interview_plans',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'includeDeactivated',
      title: 'Include Deactivated',
      type: 'switch',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },
    {
      id: 'jobBoardId',
      title: 'Job Board ID',
      type: 'short-input',
      placeholder: 'Optional job board UUID (defaults to external)',
      condition: { field: 'operation', value: ['get_job_posting', 'list_job_postings'] },
      mode: 'advanced',
    },
    {
      id: 'postingLocation',
      title: 'Location Filter',
      type: 'short-input',
      placeholder: 'Filter by location name (case sensitive)',
      condition: { field: 'operation', value: ['list_job_postings', 'get_job_posting'] },
      mode: 'advanced',
    },
    {
      id: 'postingDepartment',
      title: 'Department Filter',
      type: 'short-input',
      placeholder: 'Filter by department name (case sensitive)',
      condition: { field: 'operation', value: 'list_job_postings' },
      mode: 'advanced',
    },
    {
      id: 'listedOnly',
      title: 'Listed Postings Only',
      type: 'switch',
      condition: { field: 'operation', value: 'list_job_postings' },
      mode: 'advanced',
    },
    {
      id: 'includeUnpublishedJobPostings',
      title: 'Include Draft Postings',
      type: 'switch',
      condition: { field: 'operation', value: 'list_job_postings' },
      mode: 'advanced',
    },
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      options: [
        { label: 'Job', id: 'Job' },
        { label: 'Application', id: 'Application' },
        { label: 'Candidate', id: 'Candidate' },
        { label: 'Opening', id: 'Opening' },
      ],
      value: () => 'Job',
      required: {
        field: 'operation',
        value: ['set_custom_field_value', 'set_custom_field_values'],
      },
      condition: {
        field: 'operation',
        value: ['set_custom_field_value', 'set_custom_field_values'],
      },
    },
    {
      id: 'objectId',
      title: 'Object ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['set_custom_field_value', 'set_custom_field_values'],
      },
      placeholder: 'Enter the UUID of the job, application, candidate, or opening',
      condition: {
        field: 'operation',
        value: ['set_custom_field_value', 'set_custom_field_values'],
      },
    },
    {
      id: 'fieldId',
      title: 'Custom Field ID',
      type: 'short-input',
      required: { field: 'operation', value: 'set_custom_field_value' },
      placeholder: 'Custom field definition UUID from List Custom Fields',
      condition: { field: 'operation', value: 'set_custom_field_value' },
    },
    {
      id: 'fieldValue',
      title: 'Custom Field Value',
      type: 'long-input',
      required: { field: 'operation', value: 'set_custom_field_value' },
      placeholder: 'Plain value, or JSON for structured field types. Use null to clear.',
      condition: { field: 'operation', value: 'set_custom_field_value' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Ashby custom field value matching the field's type.

Rules:
- Boolean: true or false
- Number: a bare number, e.g. 42
- String, LongText, Date, Url, ValueSelect: the plain text, e.g. Senior Engineer or 2026-03-01
- MultiValueSelect: a JSON array of option values, e.g. ["Remote","Hybrid"]
- Currency: {"value":150000,"currencyCode":"USD"}
- NumberRange: {"type":"number-range","minValue":1,"maxValue":5}
- CompensationRange: {"type":"compensation-range","minValue":120000,"maxValue":160000,"currencyCode":"USD","interval":"YEAR"}
- Location: {"country":"United States","region":"California","city":"San Francisco"}
- To clear the field, output exactly: null

Output only the value. Do not wrap it in an object or add commentary.`,
        placeholder: 'Describe the value to write...',
      },
    },
    {
      id: 'fieldValues',
      title: 'Custom Field Values',
      type: 'code',
      required: { field: 'operation', value: 'set_custom_field_values' },
      placeholder: '[{ "fieldId": "<uuid>", "fieldValue": "High" }]',
      condition: { field: 'operation', value: 'set_custom_field_values' },
      wandConfig: {
        enabled: true,
        generationType: 'json-array',
        prompt: `Generate a JSON array of Ashby custom field writes for one object.

Each element is {"fieldId": "<custom field definition UUID>", "fieldValue": <value>}.
fieldValue follows the field's type: boolean, number, plain string, a string array for
MultiValueSelect, an object for Currency/NumberRange/CompensationRange/Location, or null to clear.

Example:
[{"fieldId":"11111111-1111-1111-1111-111111111111","fieldValue":"High"},{"fieldId":"22222222-2222-2222-2222-222222222222","fieldValue":true}]

Output only the JSON array.`,
        placeholder: 'Describe the fields to write...',
      },
    },
    {
      id: 'unsetSource',
      title: 'Clear the source instead',
      type: 'switch',
      condition: { field: 'operation', value: 'change_application_source' },
    },
    {
      /**
       * Hidden while the clear switch is on, so the editor cannot hold a source
       * ID and a clear request at the same time. The two are mutually exclusive
       * intents and the tool rejects the pair rather than picking a winner.
       */
      id: 'changeSourceId',
      title: 'Source ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: 'change_application_source',
        and: { field: 'unsetSource', value: true, not: true },
      },
      placeholder: 'Source UUID from List Sources',
      condition: {
        field: 'operation',
        value: 'change_application_source',
        and: { field: 'unsetSource', value: true, not: true },
      },
    },
    {
      id: 'expandJob',
      title: 'Include Job',
      type: 'switch',
      condition: { field: 'operation', value: 'get_job_posting' },
      mode: 'advanced',
    },
    {
      id: 'includeUnpublishedJobPostingIds',
      title: 'Include Draft Posting IDs',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get_job', 'list_jobs'] },
    },
    {
      id: 'excludeFormDefinition',
      title: 'Exclude Form Definition',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_offer' },
    },
    {
      id: 'tagId',
      title: 'Tag ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['add_candidate_tag', 'remove_candidate_tag'],
      },
      placeholder: 'Enter tag UUID',
      condition: {
        field: 'operation',
        value: ['add_candidate_tag', 'remove_candidate_tag'],
      },
    },
    {
      id: 'archiveReasonId',
      title: 'Archive Reason ID',
      type: 'short-input',
      placeholder: 'Archive reason UUID (required for Archived stages)',
      condition: { field: 'operation', value: 'change_application_stage' },
      mode: 'advanced',
    },
    {
      id: 'offerId',
      title: 'Offer ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_offer' },
      placeholder: 'Enter offer UUID',
      condition: { field: 'operation', value: 'get_offer' },
    },
    {
      id: 'jobPostingId',
      title: 'Job Posting ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_job_posting' },
      placeholder: 'Enter job posting UUID',
      condition: { field: 'operation', value: 'get_job_posting' },
    },
    {
      id: 'searchJobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Search by job title',
      condition: { field: 'operation', value: 'search_jobs' },
    },
    {
      id: 'externalMappingId',
      title: 'External Mapping ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'External candidate mapping ID',
      condition: { field: 'operation', value: 'get_candidate' },
    },
    {
      id: 'submittedFormInstanceId',
      title: 'Submitted Form Instance ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Application form submission UUID',
      condition: { field: 'operation', value: 'get_application' },
    },
    {
      id: 'applicationHistory',
      title: 'Application History',
      type: 'code',
      mode: 'advanced',
      placeholder: '[{"stageId":"<uuid>","enteredStageAt":"..."}]',
      condition: { field: 'operation', value: 'create_application' },
    },
    {
      id: 'archiveEmail',
      title: 'Send Archive Email',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'change_application_stage' },
    },
    {
      id: 'requisitionId',
      title: 'Requisition ID',
      type: 'short-input',
      placeholder: 'Search by custom requisition ID',
      condition: { field: 'operation', value: 'search_jobs' },
    },
    {
      id: 'userEmail',
      title: 'User Email',
      type: 'short-input',
      required: { field: 'operation', value: 'search_users' },
      placeholder: 'recruiter@example.com',
      condition: { field: 'operation', value: 'search_users' },
    },
    {
      id: 'openingId',
      title: 'Opening ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_opening' },
      placeholder: 'Opening UUID',
      condition: { field: 'operation', value: 'get_opening' },
    },
    {
      id: 'openingIdentifier',
      title: 'Opening Identifier',
      type: 'short-input',
      required: { field: 'operation', value: 'search_openings' },
      placeholder: 'Human-readable opening identifier',
      condition: { field: 'operation', value: 'search_openings' },
    },
    {
      id: 'startAutomaticActivities',
      title: 'Start Automatic Activities',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'transfer_application' },
    },
    {
      id: 'onBehalfOfUserId',
      title: 'Acting Ashby User ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Active Ashby user UUID',
      condition: {
        field: 'operation',
        value: [
          'add_candidate_tag',
          'anonymize_candidate',
          'change_application_source',
          'change_application_stage',
          'create_application',
          'create_candidate',
          'create_note',
          'delete_application',
          'remove_candidate_tag',
          'set_custom_field_value',
          'set_custom_field_values',
          'update_candidate',
          'transfer_application',
          'upload_resume',
          'upload_candidate_file',
        ],
      },
    },
    {
      id: 'candidateUpload',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a resume or candidate file',
      multiple: false,
      required: true,
      condition: { field: 'operation', value: ['upload_resume', 'upload_candidate_file'] },
    },
    {
      id: 'candidateFileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'File reference from a previous block',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: ['upload_resume', 'upload_candidate_file'] },
    },
    {
      id: 'fileName',
      title: 'Filename Override',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'candidate-resume.pdf',
      condition: { field: 'operation', value: ['upload_resume', 'upload_candidate_file'] },
    },
    ...getTrigger('ashby_application_submit').subBlocks,
    ...getTrigger('ashby_application_update').subBlocks,
    ...getTrigger('ashby_candidate_stage_change').subBlocks,
    ...getTrigger('ashby_candidate_hire').subBlocks,
    ...getTrigger('ashby_candidate_delete').subBlocks,
    ...getTrigger('ashby_candidate_merge').subBlocks,
    ...getTrigger('ashby_interview_schedule_create').subBlocks,
    ...getTrigger('ashby_interview_schedule_update').subBlocks,
    ...getTrigger('ashby_job_create').subBlocks,
    ...getTrigger('ashby_job_update').subBlocks,
    ...getTrigger('ashby_job_posting_update').subBlocks,
    ...getTrigger('ashby_job_posting_delete').subBlocks,
    ...getTrigger('ashby_offer_create').subBlocks,
    ...getTrigger('ashby_offer_update').subBlocks,
    ...getTrigger('ashby_offer_delete').subBlocks,
    ...getTrigger('ashby_opening_create').subBlocks,
    ...getTrigger('ashby_signature_request_update').subBlocks,
  ],

  tools: {
    access: [
      'ashby_add_candidate_tag',
      'ashby_anonymize_candidate',
      'ashby_change_application_source',
      'ashby_change_application_stage',
      'ashby_create_application',
      'ashby_create_candidate',
      'ashby_create_note',
      'ashby_delete_application',
      'ashby_get_application',
      'ashby_get_candidate',
      'ashby_get_job',
      'ashby_get_job_posting',
      'ashby_get_offer',
      'ashby_get_opening',
      'ashby_list_application_feedback',
      'ashby_list_application_history',
      'ashby_list_applications',
      'ashby_list_archive_reasons',
      'ashby_list_candidate_tags',
      'ashby_list_candidates',
      'ashby_list_custom_fields',
      'ashby_list_departments',
      'ashby_list_interviews',
      'ashby_list_interview_plans',
      'ashby_list_interview_stages',
      'ashby_list_job_postings',
      'ashby_list_jobs',
      'ashby_list_locations',
      'ashby_list_notes',
      'ashby_list_offers',
      'ashby_list_openings',
      'ashby_list_sources',
      'ashby_list_users',
      'ashby_remove_candidate_tag',
      'ashby_search_candidates',
      'ashby_search_jobs',
      'ashby_search_openings',
      'ashby_search_users',
      'ashby_set_custom_field_value',
      'ashby_set_custom_field_values',
      'ashby_update_candidate',
      'ashby_transfer_application',
      'ashby_upload_candidate_file',
      'ashby_upload_resume',
    ],
    config: {
      tool: (params) => `ashby_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.perPage) result.perPage = Number(params.perPage)
        if (params.searchName) result.name = params.searchName
        if (params.searchEmail) result.email = params.searchEmail
        if (params.searchJobTitle) result.title = params.searchJobTitle
        if (params.requisitionId) result.requisitionId = params.requisitionId
        if (params.userEmail) result.email = params.userEmail
        if (params.openingIdentifier) result.identifier = params.openingIdentifier
        if (params.filterStatus) result.status = params.filterStatus
        if (params.filterJobId) result.jobId = params.filterJobId
        if (params.jobStatus) result.status = [params.jobStatus]
        if (params.sendNotifications === 'true' || params.sendNotifications === true) {
          result.sendNotifications = true
        }
        if (params.includeArchived === 'true' || params.includeArchived === true) {
          result.includeArchived = true
        }
        if (params.includeDeactivated === 'true' || params.includeDeactivated === true) {
          result.includeDeactivated = true
        }
        if (params.isPrivate === 'true' || params.isPrivate === true) {
          result.isPrivate = true
        }
        if (params.listedOnly === 'true' || params.listedOnly === true) {
          result.listedOnly = true
        }
        if (
          params.includeUnpublishedJobPostings === 'true' ||
          params.includeUnpublishedJobPostings === true
        ) {
          result.includeUnpublishedJobPostings = true
        }
        if (params.expandJob === 'true' || params.expandJob === true) {
          result.expandJob = true
        }
        if (params.archiveEmail === 'true' || params.archiveEmail === true) {
          result.archiveEmail = true
        }
        if (
          params.includeUnpublishedJobPostingIds === 'true' ||
          params.includeUnpublishedJobPostingIds === true
        ) {
          if (params.operation === 'list_jobs') result.includeUnpublishedJobPostingsIds = true
          else result.includeUnpublishedJobPostingIds = true
        }
        if (params.excludeFormDefinition === 'true' || params.excludeFormDefinition === true) {
          result.excludeFormDefinition = true
        }
        for (const key of ['offerStatus', 'acceptanceStatus', 'approvalStatus'] as const) {
          if (params[key]) {
            const values = parseJsonArrayInput(params[key], `Ashby ${key}`)
            if (values.length > 0) result[key] = values
          }
        }
        if (params.applicationHistory) {
          const applicationHistory = parseJsonArrayInput(
            params.applicationHistory,
            'Ashby application history'
          )
          if (applicationHistory.length > 0) result.applicationHistory = applicationHistory
        }
        if (
          (params.operation === 'create_candidate' || params.operation === 'update_candidate') &&
          params.candidateLocation
        ) {
          result.location = parseJsonObjectInput(
            params.candidateLocation,
            'Ashby candidate location'
          )
        }
        if (params.clearCandidateSource === 'true' || params.clearCandidateSource === true) {
          result.clearSource = true
        }
        if (params.clearCreditedToUser === 'true' || params.clearCreditedToUser === true) {
          result.clearCreditedToUser = true
        }
        if (
          params.startAutomaticActivities === 'true' ||
          params.startAutomaticActivities === true
        ) {
          result.startAutomaticActivities = true
        }
        if (params.operation === 'search_jobs' || params.operation === 'search_candidates') {
          result.limit = params.perPage ? Number(params.perPage) : undefined
        }
        if (params.operation === 'upload_resume' || params.operation === 'upload_candidate_file') {
          const file = normalizeFileInput(params.file, { single: true })
          if (!file) throw new Error('A candidate file is required.')
          result.file = file
        }
        if (params.operation === 'create_application' && params.appCandidateId) {
          result.candidateId = params.appCandidateId
        }
        if (params.operation === 'create_application' && params.appCreatedAt) {
          result.createdAt = params.appCreatedAt
        }
        if (
          (params.operation === 'create_candidate' || params.operation === 'update_candidate') &&
          params.candidateCreatedAt
        ) {
          result.createdAt = params.candidateCreatedAt
        }
        if (params.operation === 'create_note' && params.noteCreatedAt) {
          result.createdAt = params.noteCreatedAt
        }
        if (params.updateName) result.name = params.updateName
        if (params.website) result.website = params.website
        if (params.alternateEmail) result.alternateEmail = params.alternateEmail
        if (params.postingLocation) result.location = params.postingLocation
        if (params.postingDepartment) result.department = params.postingDepartment
        if (
          params.includeLocationHierarchy === 'true' ||
          params.includeLocationHierarchy === true
        ) {
          result.includeLocationHierarchy = true
        }
        if (params.operation === 'list_offers' && params.offerApplicationId) {
          result.applicationId = params.offerApplicationId
        }
        if (params.alternateEmailAddresses) {
          const alternateEmailAddresses = parseStringListInput(params.alternateEmailAddresses)
          if (alternateEmailAddresses.length > 0)
            result.alternateEmailAddresses = alternateEmailAddresses
        }
        if (params.socialLinks) {
          const socialLinks = parseSocialLinksInput(params.socialLinks)
          if (socialLinks.length > 0) result.socialLinks = socialLinks
        }
        if (params.operation === 'set_custom_field_value') {
          result.fieldValue = parseCustomFieldValueInput(params.fieldValue)
        }
        if (params.operation === 'set_custom_field_values') {
          result.values = parseCustomFieldValuesInput(params.fieldValues)
        }
        if (params.operation === 'change_application_source') {
          // sourceId is always assigned, never conditionally, because the executor
          // merges `{ ...inputs, ...transformedParams }` and a key this mapping
          // leaves unset simply inherits whatever was in inputs. The create-path
          // `sourceId` subblock leaks into exactly that gap: it is mode
          // 'advanced', and the serializer includes an advanced subblock whenever
          // its value is non-empty without ever evaluating its condition, so a
          // value typed while on Create Application survives into this operation.
          // Inheriting it would attribute a source nobody asked for, or collide
          // with a clear request and fail with no visible cause.
          const unsetSource = params.unsetSource === 'true' || params.unsetSource === true
          const changeSourceId =
            typeof params.changeSourceId === 'string' ? params.changeSourceId.trim() : ''
          result.sourceId = unsetSource || !changeSourceId ? undefined : changeSourceId
          if (unsetSource) result.unsetSource = true
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Ashby API key' },
    candidateId: { type: 'string', description: 'Candidate UUID' },
    externalMappingId: { type: 'string', description: 'External candidate mapping ID' },
    name: { type: 'string', description: 'Candidate full name' },
    email: { type: 'string', description: 'Email address' },
    phoneNumber: { type: 'string', description: 'Phone number' },
    linkedInUrl: { type: 'string', description: 'LinkedIn profile URL' },
    githubUrl: { type: 'string', description: 'GitHub profile URL' },
    websiteUrl: { type: 'string', description: 'Personal website URL' },
    sourceId: { type: 'string', description: 'Source UUID' },
    updateName: { type: 'string', description: 'Updated full name' },
    searchName: { type: 'string', description: 'Name to search for' },
    searchEmail: { type: 'string', description: 'Email to search for' },
    searchJobTitle: { type: 'string', description: 'Job title to search for' },
    requisitionId: { type: 'string', description: 'Job requisition ID to search for' },
    userEmail: { type: 'string', description: 'Ashby user email to search for' },
    jobId: { type: 'string', description: 'Job UUID' },
    applicationId: { type: 'string', description: 'Application UUID' },
    submittedFormInstanceId: { type: 'string', description: 'Submitted form instance UUID' },
    applicationHistory: { type: 'json', description: 'Application history entries' },
    archiveEmail: { type: 'boolean', description: 'Send the configured archive email' },
    appCandidateId: { type: 'string', description: 'Candidate UUID for application' },
    interviewPlanId: { type: 'string', description: 'Interview plan UUID' },
    interviewStageId: { type: 'string', description: 'Interview stage UUID' },
    openingId: { type: 'string', description: 'Opening UUID' },
    openingIdentifier: { type: 'string', description: 'Opening identifier' },
    creditedToUserId: { type: 'string', description: 'User UUID credited to' },
    appCreatedAt: { type: 'string', description: 'Application creation timestamp' },
    note: { type: 'string', description: 'Note content' },
    noteType: { type: 'string', description: 'Content type (text/plain or text/html)' },
    sendNotifications: { type: 'boolean', description: 'Send notifications' },
    filterStatus: { type: 'string', description: 'Application status filter' },
    filterJobId: { type: 'string', description: 'Job UUID filter' },
    createdAfter: { type: 'string', description: 'Filter by creation date' },
    createdBefore: { type: 'string', description: 'Filter by creation date upper bound' },
    openedAfter: { type: 'string', description: 'Filter jobs opened after this timestamp' },
    openedBefore: { type: 'string', description: 'Filter jobs opened before this timestamp' },
    closedAfter: { type: 'string', description: 'Filter jobs closed after this timestamp' },
    closedBefore: { type: 'string', description: 'Filter jobs closed before this timestamp' },
    jobStatus: { type: 'string', description: 'Job status filter' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    perPage: { type: 'number', description: 'Results per page' },
    syncToken: { type: 'string', description: 'Sync token for incremental updates' },
    onBehalfOfUserId: {
      type: 'string',
      description: 'Active Ashby user UUID for mutation attribution',
    },
    startAutomaticActivities: {
      type: 'boolean',
      description: 'Start destination-stage automatic activities',
    },
    file: { type: 'file', description: 'Resume or candidate file to upload' },
    fileName: { type: 'string', description: 'Optional uploaded filename override' },
    includeArchived: { type: 'boolean', description: 'Include archived records' },
    includeDeactivated: { type: 'boolean', description: 'Include deactivated users' },
    website: { type: 'string', description: 'Personal website URL for new candidate' },
    alternateEmail: { type: 'string', description: 'Additional email to add to candidate' },
    candidateCreatedAt: { type: 'string', description: 'Candidate creation timestamp override' },
    candidateLocation: { type: 'json', description: 'Candidate city, region, and country' },
    clearCandidateSource: { type: 'boolean', description: 'Explicitly clear the candidate source' },
    clearCreditedToUser: {
      type: 'boolean',
      description: 'Explicitly clear the candidate credited user',
    },
    noteCreatedAt: { type: 'string', description: 'Note creation timestamp override' },
    isPrivate: { type: 'boolean', description: 'Whether the note is private' },
    postingLocation: { type: 'string', description: 'Filter job postings by location name' },
    postingDepartment: { type: 'string', description: 'Filter job postings by department name' },
    listedOnly: { type: 'boolean', description: 'Only return publicly listed job postings' },
    jobBoardId: { type: 'string', description: 'Job board UUID for job posting lookup' },
    expandJob: {
      type: 'boolean',
      description: 'Include the related job object in job posting response',
    },
    tagId: { type: 'string', description: 'Tag UUID' },
    offerId: { type: 'string', description: 'Offer UUID' },
    jobPostingId: { type: 'string', description: 'Job posting UUID' },
    archiveReasonId: { type: 'string', description: 'Archive reason UUID' },
    includeLocationHierarchy: {
      type: 'boolean',
      description: 'Include hierarchical location data when listing locations',
    },
    offerApplicationId: {
      type: 'string',
      description: 'Application UUID filter for list_offers',
    },
    offerStatus: { type: 'json', description: 'Offer process statuses to include' },
    acceptanceStatus: { type: 'json', description: 'Offer acceptance statuses to include' },
    approvalStatus: { type: 'json', description: 'Offer approval statuses to include' },
    includeUnpublishedJobPostingIds: {
      type: 'boolean',
      description: 'Include draft job posting IDs',
    },
    excludeFormDefinition: { type: 'boolean', description: 'Omit the offer form definition' },
    alternateEmailAddresses: {
      type: 'string',
      description: 'Alternate email addresses (comma-separated or JSON array)',
    },
    socialLinks: {
      type: 'string',
      description: 'Social links as JSON array',
    },
    includeUnpublishedJobPostings: {
      type: 'boolean',
      description: 'Also return unpublished (draft) job postings',
    },
    objectType: {
      type: 'string',
      description: 'Custom field target object type (Application, Candidate, Job, or Opening)',
    },
    objectId: { type: 'string', description: 'UUID of the object to set custom fields on' },
    fieldId: { type: 'string', description: 'Custom field definition UUID' },
    fieldValue: {
      type: 'string',
      description: 'Custom field value (plain value, or JSON for structured types; null clears it)',
    },
    fieldValues: {
      type: 'string',
      description: 'Custom field writes as a JSON array of { fieldId, fieldValue }',
    },
    changeSourceId: {
      type: 'string',
      description: 'Source UUID to attribute an application to',
    },
    unsetSource: {
      type: 'boolean',
      description: 'Deliberately clear an application source instead of setting one',
    },
  },

  outputs: {
    candidates: {
      type: 'json',
      description:
        'List of candidates with rich fields (id, name, primaryEmailAddress, primaryPhoneNumber, emailAddresses[], phoneNumbers[], socialLinks[], linkedInUrl, githubUrl, profileUrl, position, company, school, timezone, location with locationComponents[], tags[], applicationIds[], customFields[], resumeFileHandle, fileHandles[], source with sourceType, creditedToUser, fraudStatus, createdAt, updatedAt)',
    },
    jobs: {
      type: 'json',
      description:
        'List of jobs (id, title, confidential, status, employmentType, locationId, departmentId, defaultInterviewPlanId, interviewPlanIds[], customFields[], jobPostingIds[], customRequisitionId, brandId, hiringTeam[], author, createdAt, updatedAt, openedAt, closedAt, location with address, openings[] with latestVersion)',
    },
    applications: {
      type: 'json',
      description:
        'List of applications (id, status, customFields[], candidate summary, currentInterviewStage, source with sourceType, archiveReason with customFields[], archivedAt, job summary, creditedToUser, hiringTeam[], appliedViaJobPostingId, submitterClientIp, submitterUserAgent, createdAt, updatedAt)',
    },
    notes: {
      type: 'json',
      description: 'List of notes (id, content, author, isPrivate, createdAt)',
    },
    offers: {
      type: 'json',
      description:
        'List of offers (id, decidedAt, applicationId, acceptanceStatus, offerStatus, latestVersion with id/startDate/salary/createdAt/openingId/customFields[]/fileHandles[]/author/approvalStatus)',
    },
    archiveReasons: {
      type: 'json',
      description:
        'List of archive reasons (id, text, reasonType [RejectedByCandidate/RejectedByOrg/Other], isArchived)',
    },
    sources: {
      type: 'json',
      description: 'List of sources (id, title, isArchived, sourceType {id, title, isArchived})',
    },
    customFields: {
      type: 'json',
      description:
        'For List Custom Fields, the field definitions (id, title, isPrivate, fieldType, objectType, isArchived, isRequired, selectableValues[] {label, value, isArchived}). For Set Custom Field Values, the field values written to the object (id, title, isPrivate, valueLabel, value)',
    },
    customField: {
      type: 'json',
      description:
        'A single custom field value after a write (id, title, isPrivate, valueLabel, value)',
    },
    departments: {
      type: 'json',
      description:
        'List of departments (id, name, externalName, isArchived, parentId, createdAt, updatedAt)',
    },
    locations: {
      type: 'json',
      description:
        'List of locations (id, name, externalName, isArchived, isRemote, workplaceType, parentLocationId, type, address with addressCountry/Region/Locality/postalCode/streetAddress)',
    },
    jobPostings: {
      type: 'json',
      description:
        'List of job postings (id, title, jobId, departmentName, teamName, locationName, locationIds, workplaceType, employmentType, isListed, publishedDate, applicationDeadline, externalLink, applyLink, compensationTierSummary, shouldDisplayCompensationOnJobBoard, updatedAt)',
    },
    openings: {
      type: 'json',
      description:
        'List of openings (id, openedAt, closedAt, isArchived, archivedAt, closeReasonId, openingState, latestVersion with identifier/description/authorId/createdAt/teamId/jobIds[]/targetHireDate/targetStartDate/isBackfill/employmentType/locationIds[]/hiringTeam[]/customFields[])',
    },
    users: {
      type: 'json',
      description:
        'List of users (id, firstName, lastName, email, globalRole, isEnabled, updatedAt)',
    },
    interviewSchedules: {
      type: 'json',
      description:
        'List of interview schedules (id, applicationId, interviewStageId, interviewEvents[] with interviewerUserIds/startTime/endTime/feedbackLink/location/meetingLink/hasSubmittedFeedback, status, scheduledBy, createdAt, updatedAt)',
    },
    interviewPlans: {
      type: 'json',
      description: 'Interview plans (id, title, isArchived, createdAt, updatedAt)',
    },
    interviewStages: { type: 'json', description: 'Ordered interview stages for a plan' },
    feedback: {
      type: 'json',
      description: 'Submitted application feedback with form definitions and values',
    },
    history: { type: 'json', description: 'Application stage history and allowed actions' },
    tags: {
      type: 'json',
      description: 'List of candidate tags (id, title, isArchived)',
    },
    id: { type: 'string', description: 'Resource UUID' },
    name: { type: 'string', description: 'Resource name' },
    title: { type: 'string', description: 'Job title or job posting title' },
    status: { type: 'string', description: 'Status' },
    candidate: {
      type: 'json',
      description:
        'Candidate summary (id, name, primaryEmailAddress, primaryPhoneNumber). For full candidate fields use the candidates list output or the get/create/update candidate operations.',
    },
    job: {
      type: 'json',
      description:
        'Job details (id, title, status, employmentType, locationId, departmentId, hiringTeam[], author, location, openings[], createdAt, updatedAt)',
    },
    application: {
      type: 'json',
      description:
        'Application details (id, status, customFields[], candidate, currentInterviewStage, source, archiveReason, job, hiringTeam[], createdAt, updatedAt)',
    },
    offer: {
      type: 'json',
      description:
        'Offer details (id, decidedAt, applicationId, acceptanceStatus, offerStatus, latestVersion)',
    },
    jobPosting: {
      type: 'json',
      description:
        'Job posting details (id, title, descriptionPlain, descriptionHtml, descriptionSocial, descriptionParts, departmentName, teamName, teamNameHierarchy[], jobId, locationName, locationIds, address, isRemote, workplaceType, employmentType, isListed, publishedDate, applicationDeadline, externalLink, applyLink, compensation, updatedAt, job [included when expandJob=true])',
    },
    content: { type: 'string', description: 'Note content' },
    author: {
      type: 'json',
      description: 'Note author (id, firstName, lastName, email)',
    },
    isPrivate: { type: 'boolean', description: 'Whether the note is private' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    applicationId: { type: 'string', description: 'UUID of the deleted application' },
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
    nextSyncCursor: {
      type: 'string',
      description:
        "Ashby's opaque token for the next incremental list run, exposed as a cursor so it remains usable in workflow output",
    },
  },
}

export const AshbyBlockMeta = {
  tags: ['hiring'],
  url: 'https://ashbyhq.com',
  templates: [
    {
      icon: AshbyIcon,
      title: 'Ashby pipeline digest',
      prompt:
        'Build a scheduled daily workflow that lists open Ashby jobs, summarizes candidate counts per stage, flags applications stalled for more than five days, logs metrics to a tracking table, and Slacks hiring managers a personalized pipeline digest.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AshbyIcon,
      title: 'Resume to Ashby candidate',
      prompt:
        'Create a workflow that watches a folder of inbound resumes, extracts contact info and work history, deduplicates against existing Ashby candidates, creates new candidate records when needed, and tags them with the source job they applied through.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
    },
    {
      icon: AshbyIcon,
      title: 'Ashby interview note logger',
      prompt:
        'Build a workflow that runs after every interview is logged in your meeting tool, summarizes the transcript, scores the candidate against the job requirements, creates a structured note on the matching Ashby candidate, and notifies the hiring manager in Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AshbyIcon,
      title: 'Ashby stage-change responder',
      prompt:
        'Create a workflow that detects when an Ashby application moves into a new stage, sends the candidate a stage-appropriate email, prepares the interviewer brief in a file, and updates a recruiting tracking table so coordinators always know who is next.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: AshbyIcon,
      title: 'Ashby DEI snapshot',
      prompt:
        'Build a scheduled monthly workflow that pulls Ashby candidates, applications, and openings, computes funnel diversity metrics by stage, role, and source, and writes a confidential report file shared with people leadership and compliance.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
    },
    {
      icon: AshbyIcon,
      title: 'Ashby candidate enricher',
      prompt:
        'Create a workflow that takes new Ashby candidates, researches each across LinkedIn and the web for relevant background, writes a structured profile summary onto the candidate as an Ashby note, and updates a recruiting table with research links.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'research'],
      alsoIntegrations: ['linkedin'],
    },
    {
      icon: AshbyIcon,
      title: 'Ashby offer-ready brief',
      prompt:
        'Build a workflow that runs when an Ashby application reaches the offer stage, gathers compensation benchmarks, interview feedback, and candidate priorities, drafts an offer brief file for the hiring manager, and Slacks the people team to start the offer process.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'add-candidate',
      description:
        'Create a candidate in Ashby from an inbound application or referral and attach them to a job. Use for sourcing and referral intake.',
      content:
        '# Add Candidate\n\nCapture a new candidate into Ashby and link them to the right role.\n\n## Steps\n1. Gather the candidate name, email, source, and the target job.\n2. If the job is named, list jobs to resolve its ID.\n3. Create the candidate, then create an application linking them to the job with the correct source.\n4. Add a note with referral context or screening details, and apply any relevant tags.\n\n## Output\nReport the created candidate and application IDs, the linked job, and the source applied.',
    },
    {
      name: 'advance-candidate-stage',
      description:
        'Move a candidate application to a new interview stage in Ashby and log the decision. Use to keep the pipeline moving after interviews.',
      content:
        '# Advance Candidate Stage\n\nProgress a candidate through the hiring pipeline.\n\n## Steps\n1. Find the application — by ID, or list applications for the candidate or job.\n2. Confirm the current stage by getting the application.\n3. Change the application stage to the target stage.\n4. Add a note capturing the rationale and any interview feedback.\n\n## Output\nConfirm the candidate, the stage moved from and to, and the note added.',
    },
    {
      name: 'pipeline-status-report',
      description:
        'List candidates and applications by status or job in Ashby and summarize pipeline health. Use for recruiting standups and weekly reports.',
      content:
        '# Pipeline Status Report\n\nSummarize the state of an Ashby hiring pipeline.\n\n## Steps\n1. List the relevant jobs, or focus on one role.\n2. List applications, grouping candidates by current stage and status (active, hired, archived).\n3. Flag candidates stalled in a stage or awaiting feedback.\n4. Note new candidates added since the last report.\n\n## Output\nA pipeline summary: candidate counts per stage and status, stalled candidates called out by name and role, and recent additions.',
    },
    {
      name: 'interview-feedback-chase',
      description:
        'Find scheduled interviews with missing feedback and notify the responsible interviewers. Use after interview loops to keep decisions moving.',
      content:
        '# Interview Feedback Chase\n\nClose feedback gaps after an interview loop.\n\n## Steps\n1. List interview schedules for the application or stage.\n2. Inspect each interview event and list the application feedback already submitted.\n3. Identify interviewers whose events are complete but have no feedback.\n4. Send each interviewer a concise reminder with the candidate, role, and feedback link.\n\n## Output\nReport the interview events checked, completed feedback, missing feedback, and reminders sent.',
    },
    {
      name: 'opening-finance-reconciliation',
      description:
        'Reconcile Ashby headcount openings with a finance or workforce-planning table. Use for hiring-plan and budget reviews.',
      content:
        '# Opening Finance Reconciliation\n\nCompare approved headcount with the active recruiting plan.\n\n## Steps\n1. List or search Ashby openings and resolve their linked jobs.\n2. Compare identifier, state, target dates, hiring team, and custom fields with the planning table.\n3. Flag openings that are missing, duplicated, closed unexpectedly, or attached to the wrong job.\n4. Write a reconciliation report without changing Ashby records unless explicitly requested.\n\n## Output\nReturn matched openings, discrepancies, budget-risk flags, and the exact records that need review.',
    },
    {
      name: 'offer-signature-handoff',
      description:
        'Coordinate the offer-to-preboarding handoff from offer and signature events. Use to prevent accepted candidates from falling into an operations gap.',
      content:
        '# Offer Signature Handoff\n\nTurn an accepted and signed offer into a reliable preboarding handoff.\n\n## Steps\n1. Listen for offer updates and signature-request completion.\n2. Retrieve the offer and application, then confirm the candidate, role, opening, and final status.\n3. Create the downstream People, IT, and manager tasks only when the signature is completed.\n4. Record the Ashby offer, application, and opening IDs for idempotent follow-up.\n\n## Output\nConfirm the signed offer, candidate, linked opening, downstream owners, and every task created.',
    },
  ],
} as const satisfies BlockMeta
