import { AshbyIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const AshbyBlock: BlockConfig = {
  type: 'ashby',
  name: 'Ashby',
  description: 'Manage candidates, jobs, and applications in Ashby',
  longDescription:
    'Integrate Ashby into the workflow. Manage candidates (list, get, create, update, search, tag), applications (list, get, create, change stage), jobs (list, get), job postings (list, get), offers (list, get), notes (list, create), interviews (list), and reference data (sources, tags, archive reasons, custom fields, departments, locations, openings, users).',
  docsLink: 'https://docs.sim.ai/tools/ashby',
  category: 'tools',
  integrationType: IntegrationType.HR,
  tags: ['hiring'],
  bgColor: '#5D4ED6',
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
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'syncToken',
      title: 'Sync Token',
      type: 'short-input',
      placeholder: 'Sync token for incremental updates',
      condition: { field: 'operation', value: 'list_candidate_tags' },
      mode: 'advanced',
    },
    {
      id: 'includeArchived',
      title: 'Include Archived',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['list_candidate_tags', 'list_archive_reasons'],
      },
      mode: 'advanced',
    },
    {
      id: 'expandApplicationFormDefinition',
      title: 'Include Application Form Definition',
      type: 'switch',
      condition: { field: 'operation', value: 'get_job_posting' },
      mode: 'advanced',
    },
    {
      id: 'expandSurveyFormDefinitions',
      title: 'Include Survey Form Definitions',
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
        if (
          params.expandApplicationFormDefinition === 'true' ||
          params.expandApplicationFormDefinition === true
        ) {
          result.expandApplicationFormDefinition = true
        }
        if (
          params.expandSurveyFormDefinitions === 'true' ||
          params.expandSurveyFormDefinitions === true
        ) {
          result.expandSurveyFormDefinitions = true
        }
        if (params.appCandidateId) result.candidateId = params.appCandidateId
        if (params.appCreatedAt) result.createdAt = params.appCreatedAt
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
    jobStatus: { type: 'string', description: 'Job status filter' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    perPage: { type: 'number', description: 'Results per page' },
    syncToken: { type: 'string', description: 'Sync token for incremental updates' },
    includeArchived: { type: 'boolean', description: 'Include archived records' },
    expandApplicationFormDefinition: {
      type: 'boolean',
      description: 'Include application form definition in job posting',
    },
    expandSurveyFormDefinitions: {
      type: 'boolean',
      description: 'Include survey form definitions in job posting',
    },
    tagId: { type: 'string', description: 'Tag UUID' },
    offerId: { type: 'string', description: 'Offer UUID' },
    jobPostingId: { type: 'string', description: 'Job posting UUID' },
    archiveReasonId: { type: 'string', description: 'Archive reason UUID' },
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
        'List of jobs (id, title, confidential, status, employmentType, locationId, departmentId, defaultInterviewPlanId, interviewPlanIds[], customFields[], jobPostingIds[], customRequisitionId, brandId, hiringTeam[], author, createdAt, updatedAt, openedAt, closedAt, location with address, openings[] with latestVersion, compensation with compensationTiers[])',
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
        'List of users (id, firstName, lastName, email, globalRole, isEnabled, updatedAt, managerId)',
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
        'Candidate details (id, name, primaryEmailAddress, primaryPhoneNumber, emailAddresses[], phoneNumbers[], socialLinks[], customFields[], source, creditedToUser, createdAt, updatedAt)',
    },
    job: {
      type: 'json',
      description:
        'Job details (id, title, status, employmentType, locationId, departmentId, hiringTeam[], author, location, openings[], compensation, createdAt, updatedAt)',
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
        'Job posting details (id, title, descriptionPlain, descriptionHtml, descriptionSocial, descriptionParts, departmentName, teamName, teamNameHierarchy[], jobId, locationName, locationIds, linkedData, address, isRemote, workplaceType, employmentType, isListed, publishedDate, applicationDeadline, externalLink, applyLink, compensation, updatedAt)',
    },
    content: { type: 'string', description: 'Note content' },
    author: {
      type: 'json',
      description: 'Note author (id, firstName, lastName, email, globalRole, isEnabled)',
    },
    isPrivate: { type: 'boolean', description: 'Whether the note is private' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Pagination cursor for next page' },
    syncToken: { type: 'string', description: 'Sync token for incremental updates' },
  },
}
