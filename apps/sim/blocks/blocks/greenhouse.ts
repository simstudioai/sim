import { GreenhouseIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { GreenhouseResponse } from '@/tools/greenhouse/types'
import { getTrigger } from '@/triggers'

export const GreenhouseBlock: BlockConfig<GreenhouseResponse> = {
  type: 'greenhouse',
  name: 'Greenhouse',
  description: 'Manage candidates, jobs, and applications in Greenhouse',
  longDescription:
    'Integrate Greenhouse into the workflow. List and retrieve candidates, jobs, applications, users, departments, offices, and job stages from your Greenhouse ATS account.',
  docsLink: 'https://docs.sim.ai/integrations/greenhouse',
  category: 'tools',
  integrationType: IntegrationType.HR,
  bgColor: '#469776',
  iconColor: '#469776',
  icon: GreenhouseIcon,
  authMode: AuthMode.ApiKey,

  triggers: {
    enabled: true,
    available: [
      'greenhouse_candidate_hired',
      'greenhouse_new_application',
      'greenhouse_candidate_stage_change',
      'greenhouse_candidate_rejected',
      'greenhouse_offer_created',
      'greenhouse_job_created',
      'greenhouse_job_updated',
      'greenhouse_webhook',
    ],
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Candidates', id: 'greenhouse_list_candidates' },
        { label: 'Get Candidate', id: 'greenhouse_get_candidate' },
        { label: 'List Jobs', id: 'greenhouse_list_jobs' },
        { label: 'Get Job', id: 'greenhouse_get_job' },
        { label: 'List Applications', id: 'greenhouse_list_applications' },
        { label: 'Get Application', id: 'greenhouse_get_application' },
        { label: 'List Users', id: 'greenhouse_list_users' },
        { label: 'Get User', id: 'greenhouse_get_user' },
        { label: 'List Departments', id: 'greenhouse_list_departments' },
        { label: 'List Offices', id: 'greenhouse_list_offices' },
        { label: 'List Job Stages', id: 'greenhouse_list_job_stages' },
      ],
      value: () => 'greenhouse_list_candidates',
    },

    // ── Get by ID fields ──

    {
      id: 'candidateId',
      title: 'Candidate ID',
      type: 'short-input',
      placeholder: 'Enter candidate ID',
      required: { field: 'operation', value: 'greenhouse_get_candidate' },
      condition: { field: 'operation', value: 'greenhouse_get_candidate' },
    },
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter job ID',
      required: {
        field: 'operation',
        value: ['greenhouse_get_job', 'greenhouse_list_job_stages'],
      },
      condition: {
        field: 'operation',
        value: ['greenhouse_get_job', 'greenhouse_list_job_stages'],
      },
    },
    {
      id: 'applicationId',
      title: 'Application ID',
      type: 'short-input',
      placeholder: 'Enter application ID',
      required: { field: 'operation', value: 'greenhouse_get_application' },
      condition: { field: 'operation', value: 'greenhouse_get_application' },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      required: { field: 'operation', value: 'greenhouse_get_user' },
      condition: { field: 'operation', value: 'greenhouse_get_user' },
    },

    // ── List Candidates filters ──

    {
      id: 'email',
      title: 'Email Filter',
      type: 'short-input',
      placeholder: 'Filter by email address',
      condition: {
        field: 'operation',
        value: ['greenhouse_list_candidates', 'greenhouse_list_users'],
      },
      mode: 'advanced',
    },
    {
      id: 'job_id',
      title: 'Job ID Filter',
      type: 'short-input',
      placeholder: 'Filter by job ID',
      condition: {
        field: 'operation',
        value: ['greenhouse_list_candidates', 'greenhouse_list_applications'],
      },
      mode: 'advanced',
    },
    {
      id: 'candidate_ids',
      title: 'Candidate IDs',
      type: 'short-input',
      placeholder: 'Comma-separated IDs (max 50)',
      condition: { field: 'operation', value: 'greenhouse_list_candidates' },
      mode: 'advanced',
    },

    // ── List Jobs filters ──

    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'Draft', id: 'draft' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'greenhouse_list_jobs' },
    },
    {
      id: 'department_id',
      title: 'Department ID',
      type: 'short-input',
      placeholder: 'Filter by department ID',
      condition: { field: 'operation', value: 'greenhouse_list_jobs' },
      mode: 'advanced',
    },
    {
      id: 'office_id',
      title: 'Office ID',
      type: 'short-input',
      placeholder: 'Filter by office ID',
      condition: { field: 'operation', value: 'greenhouse_list_jobs' },
      mode: 'advanced',
    },

    // ── List Applications filters ──

    {
      id: 'applicationStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active', id: 'active' },
        { label: 'Converted', id: 'converted' },
        { label: 'Hired', id: 'hired' },
        { label: 'Rejected', id: 'rejected' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'greenhouse_list_applications' },
    },
    {
      id: 'last_activity_after',
      title: 'Activity After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (e.g., 2024-01-01T00:00:00Z)',
      condition: { field: 'operation', value: 'greenhouse_list_applications' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for the Greenhouse API based on the user's description.

Examples:
- "last 7 days" -> Calculate 7 days ago from today in ISO 8601 format
- "last 30 days" -> Calculate 30 days ago from today in ISO 8601 format
- "since January 1st 2024" -> 2024-01-01T00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "yesterday" -> Yesterday's date at 00:00:00Z

Return ONLY the ISO 8601 timestamp - no explanations, no extra text.`,
        placeholder: 'Describe the time filter (e.g., "last 7 days", "since January 1st")...',
        generationType: 'timestamp',
      },
    },

    // ── Shared date filters (advanced) ──

    {
      id: 'created_after',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: [
          'greenhouse_list_candidates',
          'greenhouse_list_jobs',
          'greenhouse_list_applications',
          'greenhouse_list_users',
        ],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for the Greenhouse API based on the user's description.

Examples:
- "last 7 days" -> Calculate 7 days ago from today in ISO 8601 format
- "last 30 days" -> Calculate 30 days ago from today in ISO 8601 format
- "since January 1st 2024" -> 2024-01-01T00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z

Return ONLY the ISO 8601 timestamp - no explanations, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last 30 days", "since January 1st")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'updated_after',
      title: 'Updated After',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: {
        field: 'operation',
        value: ['greenhouse_list_candidates', 'greenhouse_list_jobs', 'greenhouse_list_users'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for the Greenhouse API based on the user's description.

Examples:
- "last 24 hours" -> Calculate 24 hours ago in ISO 8601 format
- "last week" -> Calculate 7 days ago in ISO 8601 format
- "since March 2024" -> 2024-03-01T00:00:00Z

Return ONLY the ISO 8601 timestamp - no explanations, no extra text.`,
        placeholder: 'Describe the update date filter (e.g., "last 24 hours")...',
        generationType: 'timestamp',
      },
    },

    // ── Pagination (advanced, shared across list operations) ──

    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '100 (max 500)',
      condition: {
        field: 'operation',
        value: [
          'greenhouse_list_candidates',
          'greenhouse_list_jobs',
          'greenhouse_list_applications',
          'greenhouse_list_users',
          'greenhouse_list_departments',
          'greenhouse_list_offices',
          'greenhouse_list_job_stages',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      condition: {
        field: 'operation',
        value: [
          'greenhouse_list_candidates',
          'greenhouse_list_jobs',
          'greenhouse_list_applications',
          'greenhouse_list_users',
          'greenhouse_list_departments',
          'greenhouse_list_offices',
          'greenhouse_list_job_stages',
        ],
      },
      mode: 'advanced',
    },

    // ── API Key (common) ──

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Greenhouse Harvest API key',
      required: true,
      password: true,
    },

    // ── Trigger subBlocks ──

    ...getTrigger('greenhouse_candidate_hired').subBlocks,
    ...getTrigger('greenhouse_new_application').subBlocks,
    ...getTrigger('greenhouse_candidate_stage_change').subBlocks,
    ...getTrigger('greenhouse_candidate_rejected').subBlocks,
    ...getTrigger('greenhouse_offer_created').subBlocks,
    ...getTrigger('greenhouse_job_created').subBlocks,
    ...getTrigger('greenhouse_job_updated').subBlocks,
    ...getTrigger('greenhouse_webhook').subBlocks,
  ],

  tools: {
    access: [
      'greenhouse_list_candidates',
      'greenhouse_get_candidate',
      'greenhouse_list_jobs',
      'greenhouse_get_job',
      'greenhouse_list_applications',
      'greenhouse_get_application',
      'greenhouse_list_users',
      'greenhouse_get_user',
      'greenhouse_list_departments',
      'greenhouse_list_offices',
      'greenhouse_list_job_stages',
    ],
    config: {
      tool: (params) => `${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        if (params.per_page) result.per_page = Number(params.per_page)
        if (params.page) result.page = Number(params.page)

        if (params.operation === 'greenhouse_list_applications' && params.applicationStatus) {
          result.status = params.applicationStatus
        }
        if (params.operation === 'greenhouse_list_jobs' && params.status === '') {
          result.status = undefined
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Greenhouse Harvest API key' },
    candidateId: { type: 'string', description: 'Candidate ID' },
    jobId: { type: 'string', description: 'Job ID' },
    applicationId: { type: 'string', description: 'Application ID' },
    userId: { type: 'string', description: 'User ID' },
    status: { type: 'string', description: 'Job status filter (open, closed, draft)' },
    applicationStatus: {
      type: 'string',
      description: 'Application status filter (active, converted, hired, rejected)',
    },
    job_id: { type: 'string', description: 'Job ID filter for candidates/applications' },
    email: { type: 'string', description: 'Email address filter' },
    candidate_ids: { type: 'string', description: 'Comma-separated candidate IDs (max 50)' },
    department_id: { type: 'string', description: 'Department ID filter for jobs' },
    office_id: { type: 'string', description: 'Office ID filter for jobs' },
    created_after: { type: 'string', description: 'Created after date filter (ISO 8601)' },
    updated_after: { type: 'string', description: 'Updated after date filter (ISO 8601)' },
    last_activity_after: {
      type: 'string',
      description: 'Last activity after date filter (ISO 8601)',
    },
    per_page: { type: 'number', description: 'Number of results per page (max 500)' },
    page: { type: 'number', description: 'Page number for pagination' },
  },

  outputs: {
    candidates: { type: 'json', description: 'List of candidates' },
    jobs: { type: 'json', description: 'List of jobs' },
    applications: { type: 'json', description: 'List of applications' },
    users: { type: 'json', description: 'List of users' },
    departments: { type: 'json', description: 'List of departments' },
    offices: { type: 'json', description: 'List of offices' },
    stages: { type: 'json', description: 'List of job stages' },
    count: { type: 'number', description: 'Number of results returned' },
    id: { type: 'number', description: 'Resource ID' },
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    name: { type: 'string', description: 'Resource name' },
    status: { type: 'string', description: 'Status' },
    email_addresses: { type: 'json', description: 'Email addresses' },
    phone_numbers: { type: 'json', description: 'Phone numbers' },
    tags: { type: 'json', description: 'Tags' },
    application_ids: { type: 'json', description: 'Associated application IDs' },
    recruiter: { type: 'json', description: 'Assigned recruiter' },
    coordinator: { type: 'json', description: 'Assigned coordinator' },
    current_stage: { type: 'json', description: 'Current interview stage' },
    source: { type: 'json', description: 'Application source' },
    hiring_team: { type: 'json', description: 'Hiring team members' },
    openings: { type: 'json', description: 'Job openings' },
    custom_fields: { type: 'json', description: 'Custom field values' },
    attachments: { type: 'json', description: 'File attachments' },
    educations: { type: 'json', description: 'Education history' },
    employments: { type: 'json', description: 'Employment history' },
    answers: { type: 'json', description: 'Application question answers' },
    prospect: { type: 'boolean', description: 'Whether this is a prospect' },
    confidential: { type: 'boolean', description: 'Whether the job is confidential' },
    is_private: { type: 'boolean', description: 'Whether the candidate is private' },
    can_email: { type: 'boolean', description: 'Whether the candidate can be emailed' },
    disabled: { type: 'boolean', description: 'Whether the user is disabled' },
    site_admin: { type: 'boolean', description: 'Whether the user is a site admin' },
    primary_email_address: { type: 'string', description: 'Primary email address' },
    created_at: { type: 'string', description: 'Creation timestamp (ISO 8601)' },
    updated_at: { type: 'string', description: 'Last updated timestamp (ISO 8601)' },
  },
}

export const GreenhouseBlockMeta = {
  tags: ['hiring'],
  url: 'https://www.greenhouse.com',
  templates: [
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse pipeline monitor',
      prompt:
        'Build a scheduled workflow that syncs open jobs and candidates from Greenhouse to a tracking table daily, flags candidates who have been in the same stage for more than 5 days, and sends a Slack summary to hiring managers with pipeline stats and bottlenecks.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse to onboarding kickoff',
      prompt:
        'Build a workflow that fires when a Greenhouse application is marked hired, gathers the new hire profile, kicks off an onboarding plan in a table, schedules week-one meetings via Google Calendar, and posts a welcome announcement to Slack.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
      alsoIntegrations: ['google_calendar', 'slack'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse candidate enricher',
      prompt:
        'Create a workflow that watches for new Greenhouse candidates, enriches each profile with LinkedIn background, GitHub activity, and public writing, and writes a structured research summary to a recruiting table for recruiters to review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'research'],
      alsoIntegrations: ['linkedin', 'github'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse interview scheduler',
      prompt:
        'Build a workflow that runs after a Greenhouse application reaches the interview stage, finds the right interviewer panel based on job stage, proposes time slots from Google Calendar, drafts a coordination email to the candidate, and confirms the booking in a tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
      alsoIntegrations: ['google_calendar', 'gmail'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse offer drafter',
      prompt:
        'Create a workflow that takes an approved Greenhouse application, pulls compensation bands from a knowledge base, drafts a tailored offer letter file, prepares an explanation email, and routes both to the hiring manager for review before sending to the candidate.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'content'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse rejection follow-up',
      prompt:
        'Build a workflow that runs when a Greenhouse candidate is rejected, drafts a warm and respectful rejection email tailored to how far they progressed, sends it via Gmail, and logs the candidate with their interest areas to a future-talent table for re-engagement.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'communication', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GreenhouseIcon,
      title: 'Greenhouse interview prep packet',
      prompt:
        'Create a workflow that runs the morning of every Greenhouse interview, pulls the candidate profile, prior interview notes, and job rubric, assembles a one-page prep file for the interviewer, and emails it with a Slack DM reminder thirty minutes before the slot.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'team'],
      alsoIntegrations: ['gmail', 'slack'],
    },
  ],
  skills: [
    {
      name: 'build-pipeline-report',
      description:
        'Summarize Greenhouse applications per job by stage to produce a hiring pipeline report.',
      content:
        '# Build Pipeline Report\n\nReport how candidates are progressing through each open job.\n\n## Steps\n1. List jobs and filter to open requisitions, capturing job IDs and titles.\n2. List job stages so application counts can be bucketed correctly.\n3. List applications, optionally filtered by status, and group them by job and current stage.\n4. Compute counts per stage and flag jobs with no recent movement.\n\n## Output\nReturn a per-job breakdown showing candidate counts by stage, total active candidates, and a flagged list of stalled requisitions. Suitable for a weekly recruiting standup.',
    },
    {
      name: 'assemble-candidate-brief',
      description:
        'Pull a Greenhouse candidate and their application details into a one-page interviewer brief.',
      content:
        '# Assemble Candidate Brief\n\nCompile everything an interviewer needs about a candidate.\n\n## Steps\n1. Find the candidate by listing candidates and matching name, or use a known candidate ID.\n2. Get the candidate to retrieve profile details and attachments.\n3. Get the application to read the job applied for, current stage, and source.\n4. Get the job for the role context and requirements.\n\n## Output\nReturn a one-page brief: candidate summary, role and current stage, key background points, and any notes. Ready to email or DM to the interviewer before the slot.',
    },
    {
      name: 'audit-open-roles',
      description: 'List open Greenhouse jobs with their departments, offices, and hiring teams.',
      content:
        '# Audit Open Roles\n\nInventory active requisitions and who owns them.\n\n## Steps\n1. List jobs and filter to open status.\n2. List departments and offices to resolve the names referenced on each job.\n3. List users to map hiring team members and recruiters to each role.\n4. Assemble each job with its department, office, and owning team.\n\n## Output\nReturn an inventory of open roles, each with title, department, office, and hiring team. Flag any role missing a recruiter or hiring manager.',
    },
  ],
} as const satisfies BlockMeta
