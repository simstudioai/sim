import { AshbyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'

export const AshbyBlock: BlockConfig = {
  type: 'ashby',
  name: 'Ashby',
  description: 'Manage candidates, jobs, and applications in Ashby',
  longDescription:
    'Integrate Ashby into the workflow. Can list, search, create, and update candidates, list and get job details, create notes, list notes, list and get applications, create applications, and list offers.',
  docsLink: 'https://docs.sim.ai/tools/ashby',
  category: 'tools',
  bgColor: '#5D4ED6',
  icon: AshbyIcon,
  authMode: AuthMode.ApiKey,

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

    // Get Candidate / Create Note / List Notes / Update Candidate - candidateId
    {
      id: 'candidateId',
      title: 'Candidate ID',
      type: 'short-input',
      required: {
        field: 'operation',
        value: ['get_candidate', 'create_note', 'list_notes', 'update_candidate'],
      },
      placeholder: 'Enter candidate UUID',
      condition: {
        field: 'operation',
        value: ['get_candidate', 'create_note', 'list_notes', 'update_candidate'],
      },
    },

    // Create Candidate fields
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
      id: 'emailType',
      title: 'Email Type',
      type: 'dropdown',
      options: [
        { label: 'Work', id: 'Work' },
        { label: 'Personal', id: 'Personal' },
        { label: 'Other', id: 'Other' },
      ],
      value: () => 'Work',
      condition: { field: 'operation', value: ['create_candidate', 'update_candidate'] },
      mode: 'advanced',
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
      id: 'phoneType',
      title: 'Phone Type',
      type: 'dropdown',
      options: [
        { label: 'Work', id: 'Work' },
        { label: 'Personal', id: 'Personal' },
        { label: 'Other', id: 'Other' },
      ],
      value: () => 'Work',
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

    // Update Candidate fields
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

    // Search Candidates fields
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

    // Get Job fields
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      required: { field: 'operation', value: ['get_job', 'create_application'] },
      placeholder: 'Enter job UUID',
      condition: { field: 'operation', value: ['get_job', 'create_application'] },
    },

    // Get Application fields
    {
      id: 'applicationId',
      title: 'Application ID',
      type: 'short-input',
      required: { field: 'operation', value: 'get_application' },
      placeholder: 'Enter application UUID',
      condition: { field: 'operation', value: 'get_application' },
    },

    // Create Application fields
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
      placeholder: 'Interview stage UUID (defaults to first Lead stage)',
      condition: { field: 'operation', value: 'create_application' },
      mode: 'advanced',
    },
    {
      id: 'creditedToUserId',
      title: 'Credited To User ID',
      type: 'short-input',
      placeholder: 'User UUID the application is credited to',
      condition: { field: 'operation', value: 'create_application' },
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

    // Create Note fields
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
      condition: { field: 'operation', value: 'create_note' },
      mode: 'advanced',
    },

    // List Applications filter fields
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
      id: 'filterCandidateId',
      title: 'Candidate ID Filter',
      type: 'short-input',
      placeholder: 'Filter by candidate UUID',
      condition: { field: 'operation', value: 'list_applications' },
      mode: 'advanced',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      placeholder: 'e.g. 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_applications' },
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

    // List Jobs status filter
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

    // Pagination fields for list operations
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: ['list_candidates', 'list_jobs', 'list_applications', 'list_notes', 'list_offers'],
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
        value: ['list_candidates', 'list_jobs', 'list_applications', 'list_notes', 'list_offers'],
      },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'ashby_create_application',
      'ashby_create_candidate',
      'ashby_create_note',
      'ashby_get_application',
      'ashby_get_candidate',
      'ashby_get_job',
      'ashby_list_applications',
      'ashby_list_candidates',
      'ashby_list_jobs',
      'ashby_list_notes',
      'ashby_list_offers',
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
        if (params.filterCandidateId) result.candidateId = params.filterCandidateId
        if (params.jobStatus) result.status = params.jobStatus
        if (params.sendNotifications === 'true' || params.sendNotifications === true) {
          result.sendNotifications = true
        }
        // Create Application params
        if (params.appCandidateId) result.candidateId = params.appCandidateId
        if (params.appCreatedAt) result.createdAt = params.appCreatedAt
        // Update Candidate params
        if (params.updateName) result.name = params.updateName
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
    emailType: { type: 'string', description: 'Email type (Personal, Work, Other)' },
    phoneNumber: { type: 'string', description: 'Phone number' },
    phoneType: { type: 'string', description: 'Phone type (Personal, Work, Other)' },
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
    filterCandidateId: { type: 'string', description: 'Candidate UUID filter' },
    createdAfter: { type: 'string', description: 'Filter by creation date' },
    jobStatus: { type: 'string', description: 'Job status filter' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    perPage: { type: 'number', description: 'Results per page' },
  },

  outputs: {
    candidates: { type: 'json', description: 'List of candidates' },
    jobs: { type: 'json', description: 'List of jobs' },
    applications: { type: 'json', description: 'List of applications' },
    notes: { type: 'json', description: 'List of notes' },
    offers: { type: 'json', description: 'List of offers' },
    id: { type: 'string', description: 'Resource UUID' },
    name: { type: 'string', description: 'Resource name' },
    title: { type: 'string', description: 'Job title' },
    status: { type: 'string', description: 'Status' },
    content: { type: 'string', description: 'Note content' },
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
  },
}
