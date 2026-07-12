import { AshbyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
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
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const AshbyBlock: BlockConfig = {
  type: 'ashby',
  name: 'Ashby',
  description: 'Manage candidates, jobs, and applications in Ashby',
  longDescription:
    'Integrate Ashby into the workflow. Manage candidates (list, get, create, update, search, tag), applications (list, get, create, change stage), jobs (list, get), job postings (list, get), offers (list, get), notes (list, create), interviews (list), and reference data (sources, tags, archive reasons, custom fields, departments, locations, openings, users).',
  docsLink: 'https://docs.sim.ai/integrations/ashby',
  category: 'tools',
  integrationType: IntegrationType.HR,
  bgColor: '#5D4ED6',
  iconColor: '#5D4ED6',
  icon: AshbyIcon,
  authMode: AuthMode.ApiKey,

  triggers: {
    enabled: true,
    available: [
      'ashby_application_submit',
      'ashby_candidate_stage_change',
      'ashby_candidate_hire',
      'ashby_candidate_delete',
      'ashby_job_create',
      'ashby_offer_create',
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
        { label: 'List Offers', id: 'list_offers' },
        { label: 'Change Application Stage', id: 'change_application_stage' },
        { label: 'Add Candidate Tag', id: 'add_candidate_tag' },
        { label: 'Remove Candidate Tag', id: 'remove_candidate_tag' },
        { label: 'Get Offer', id: 'get_offer' },
        { label: 'List Sources', id: 'list_sources' },
        { label: 'List Candidate Tags', id: 'list_candidate_tags' },
        { label: 'List Archive Reasons', id: 'list_archive_reasons' },
        { label: 'List Custom Fields', id: 'list_custom_fields' },
        { label: 'List Departments', id: 'list_departments' },
        { label: 'List Locations', id: 'list_locations' },
        { label: 'List Job Postings', id: 'list_job_postings' },
        { label: 'Get Job Posting', id: 'get_job_posting' },
        { label: 'List Openings', id: 'list_openings' },
        { label: 'List Users', id: 'list_users' },
        { label: 'List Interviews', id: 'list_interviews' },
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
          'get_candidate',
          'create_note',
          'list_notes',
          'update_candidate',
          'add_candidate_tag',
          'remove_candidate_tag',
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
      required: { field: 'operation', value: ['get_job', 'create_application'] },
      placeholder: 'Enter job UUID',
      condition: { field: 'operation', value: ['get_job', 'create_application'] },
    },
    {
      id: 'applicationId',
      title: 'Application ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['get_application', 'change_application_stage'],
      },
      placeholder: 'Enter application UUID',
      condition: {
        field: 'operation',
        value: ['get_application', 'change_application_stage', 'list_interviews'],
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
      placeholder: 'Interview plan UUID (defaults to job default)',
      condition: { field: 'operation', value: 'create_application' },
      mode: 'advanced',
    },
    {
      id: 'interviewStageId',
      title: 'Interview Stage ID',
      type: 'short-input',
      required: { field: 'operation', value: 'change_application_stage' },
      placeholder: 'Interview stage UUID',
      condition: {
        field: 'operation',
        value: ['create_application', 'change_application_stage', 'list_interviews'],
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
          'list_departments',
          'list_custom_fields',
          'list_offers',
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
      condition: { field: 'operation', value: 'list_job_postings' },
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
      id: 'expandJob',
      title: 'Include Job',
      type: 'switch',
      condition: { field: 'operation', value: 'get_job_posting' },
      mode: 'advanced',
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
    ...getTrigger('ashby_application_submit').subBlocks,
    ...getTrigger('ashby_candidate_stage_change').subBlocks,
    ...getTrigger('ashby_candidate_hire').subBlocks,
    ...getTrigger('ashby_candidate_delete').subBlocks,
    ...getTrigger('ashby_job_create').subBlocks,
    ...getTrigger('ashby_offer_create').subBlocks,
  ],

  tools: {
    access: [
      'ashby_add_candidate_tag',
      'ashby_change_application_stage',
      'ashby_create_application',
      'ashby_create_candidate',
      'ashby_create_note',
      'ashby_get_application',
      'ashby_get_candidate',
      'ashby_get_job',
      'ashby_get_job_posting',
      'ashby_get_offer',
      'ashby_list_applications',
      'ashby_list_archive_reasons',
      'ashby_list_candidate_tags',
      'ashby_list_candidates',
      'ashby_list_custom_fields',
      'ashby_list_departments',
      'ashby_list_interviews',
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
      'ashby_update_candidate',
    ],
    config: {
      tool: (params) => `ashby_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.perPage) result.perPage = Number(params.perPage)
        if (params.searchName) result.name = params.searchName
        if (params.searchEmail) result.email = params.searchEmail
        if (params.filterStatus) result.status = params.filterStatus
        if (params.filterJobId) result.jobId = params.filterJobId
        if (params.jobStatus) result.status = params.jobStatus
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
        if (params.expandJob === 'true' || params.expandJob === true) {
          result.expandJob = true
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
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Ashby API key' },
    candidateId: { type: 'string', description: 'Candidate UUID' },
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
    jobId: { type: 'string', description: 'Job UUID' },
    applicationId: { type: 'string', description: 'Application UUID' },
    appCandidateId: { type: 'string', description: 'Candidate UUID for application' },
    interviewPlanId: { type: 'string', description: 'Interview plan UUID' },
    interviewStageId: { type: 'string', description: 'Interview stage UUID' },
    creditedToUserId: { type: 'string', description: 'User UUID credited to' },
    appCreatedAt: { type: 'string', description: 'Application creation timestamp' },
    note: { type: 'string', description: 'Note content' },
    noteType: { type: 'string', description: 'Content type (text/plain or text/html)' },
    sendNotifications: { type: 'boolean', description: 'Send notifications' },
    filterStatus: { type: 'string', description: 'Application status filter' },
    filterJobId: { type: 'string', description: 'Job UUID filter' },
    createdAfter: { type: 'string', description: 'Filter by creation date' },
    openedAfter: { type: 'string', description: 'Filter jobs opened after this timestamp' },
    openedBefore: { type: 'string', description: 'Filter jobs opened before this timestamp' },
    closedAfter: { type: 'string', description: 'Filter jobs closed after this timestamp' },
    closedBefore: { type: 'string', description: 'Filter jobs closed before this timestamp' },
    jobStatus: { type: 'string', description: 'Job status filter' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    perPage: { type: 'number', description: 'Results per page' },
    syncToken: { type: 'string', description: 'Sync token for incremental updates' },
    includeArchived: { type: 'boolean', description: 'Include archived records' },
    includeDeactivated: { type: 'boolean', description: 'Include deactivated users' },
    website: { type: 'string', description: 'Personal website URL for new candidate' },
    alternateEmail: { type: 'string', description: 'Additional email to add to candidate' },
    candidateCreatedAt: { type: 'string', description: 'Candidate creation timestamp override' },
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
    alternateEmailAddresses: {
      type: 'string',
      description: 'Alternate email addresses (comma-separated or JSON array)',
    },
    socialLinks: {
      type: 'string',
      description: 'Social links as JSON array',
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
        'List of custom field definitions (id, title, isPrivate, fieldType, objectType, isArchived, isRequired, selectableValues[] {label, value, isArchived})',
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
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
    syncToken: { type: 'string', description: 'Sync token for incremental updates' },
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
      title: 'Interview note logger',
      prompt:
        'Build a workflow that runs after every interview is logged in your meeting tool, summarizes the transcript, scores the candidate against the job requirements, creates a structured note on the matching Ashby candidate, and notifies the hiring manager in Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AshbyIcon,
      title: 'Stage-change responder',
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
      title: 'Candidate research enricher',
      prompt:
        'Create a workflow that takes new Ashby candidates, researches each across LinkedIn and the web for relevant background, writes a structured profile summary onto the candidate as an Ashby note, and updates a recruiting table with research links.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'research'],
      alsoIntegrations: ['linkedin'],
    },
    {
      icon: AshbyIcon,
      title: 'Offer ready brief',
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
  ],
} as const satisfies BlockMeta
