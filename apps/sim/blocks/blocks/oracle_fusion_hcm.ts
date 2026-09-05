import { NetSuiteIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const PERSON_OPERATIONS = [
  'get_worker',
  'list_worker_assignments',
  'get_worker_assignment',
  'list_worker_managers',
  'list_worker_direct_reports',
  'list_absences',
  'list_absence_types',
]
const ASSIGNMENT_OPERATIONS = [
  'get_worker_assignment',
  'list_worker_managers',
  'list_worker_direct_reports',
]
const LIST_OPERATIONS = [
  'list_workers',
  'list_worker_assignments',
  'list_worker_managers',
  'list_worker_direct_reports',
  'list_absences',
  'list_absence_types',
  'list_jobs',
  'list_job_families',
  'list_departments',
  'list_locations',
  'list_positions',
  'list_business_units',
  'list_legal_employers',
  'list_grades',
  'list_person_types',
]
const SEARCH_OPERATIONS = [
  'list_workers',
  'list_absence_types',
  'list_jobs',
  'list_job_families',
  'list_departments',
  'list_locations',
  'list_positions',
  'list_business_units',
  'list_legal_employers',
  'list_grades',
  'list_person_types',
]
const EFFECTIVE_DATE_OPERATIONS = [
  'list_absence_types',
  'list_jobs',
  'list_job_families',
  'list_departments',
  'list_locations',
  'list_positions',
  'list_legal_employers',
  'list_grades',
]

export const OracleFusionHcmBlock: BlockConfig = {
  type: 'oracle_fusion_hcm',
  name: 'Oracle Fusion Cloud HCM',
  description: 'Read workers, absences, reporting lines, and workforce structures',
  longDescription:
    'Connect to Oracle Fusion Cloud HCM with a reusable, least-privilege integration-user credential. Read public worker profiles, assignments, reporting relationships, absences, absence types, and workforce structures without exposing write operations, raw credentials, or sensitive HR fields.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_hcm',
  category: 'tools',
  integrationType: IntegrationType.HR,
  authMode: AuthMode.ApiKey,
  bgColor: '#F80000',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Cloud HCM',
    sentences: {
      byOperation: {
        list_workers: ['List workers', { text: 'matching', field: 'search' }],
        get_worker: [{ text: 'Get worker', field: ['personPicker', 'personIdInput'], core: true }],
        list_worker_assignments: [
          {
            text: 'List assignments for worker',
            field: ['personPicker', 'personIdInput'],
            core: true,
          },
        ],
        get_worker_assignment: [
          { text: 'Get assignment', field: ['assignmentPicker', 'assignmentIdInput'], core: true },
          { text: 'for worker', field: ['personPicker', 'personIdInput'], core: true },
        ],
        list_worker_managers: [
          {
            text: 'List managers for assignment',
            field: ['assignmentPicker', 'assignmentIdInput'],
            core: true,
          },
        ],
        list_worker_direct_reports: [
          {
            text: 'List direct reports for assignment',
            field: ['assignmentPicker', 'assignmentIdInput'],
            core: true,
          },
        ],
        list_absences: [
          {
            text: 'List absences for worker',
            field: ['personPicker', 'personIdInput'],
            core: true,
          },
        ],
        get_absence: [
          { text: 'Get absence', field: ['absencePicker', 'absenceIdInput'], core: true },
        ],
        list_absence_types: [
          {
            text: 'List absence types for worker',
            field: ['personPicker', 'personIdInput'],
            core: true,
          },
        ],
        list_jobs: ['List jobs', { text: 'matching', field: 'search' }],
        list_job_families: ['List job families', { text: 'matching', field: 'search' }],
        list_departments: ['List departments', { text: 'matching', field: 'search' }],
        list_locations: ['List locations', { text: 'matching', field: 'search' }],
        list_positions: ['List positions', { text: 'matching', field: 'search' }],
        list_business_units: ['List business units', { text: 'matching', field: 'search' }],
        list_legal_employers: ['List legal employers', { text: 'matching', field: 'search' }],
        list_grades: ['List grades', { text: 'matching', field: 'search' }],
        list_person_types: ['List person types', { text: 'matching', field: 'search' }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      value: () => 'list_workers',
      options: [
        { label: 'List Workers', id: 'list_workers' },
        { label: 'Get Worker', id: 'get_worker' },
        { label: 'List Worker Assignments', id: 'list_worker_assignments' },
        { label: 'Get Worker Assignment', id: 'get_worker_assignment' },
        { label: 'List Worker Managers', id: 'list_worker_managers' },
        { label: 'List Worker Direct Reports', id: 'list_worker_direct_reports' },
        { label: 'List Absences', id: 'list_absences' },
        { label: 'Get Absence', id: 'get_absence' },
        { label: 'List Absence Types', id: 'list_absence_types' },
        { label: 'List Jobs', id: 'list_jobs' },
        { label: 'List Job Families', id: 'list_job_families' },
        { label: 'List Departments', id: 'list_departments' },
        { label: 'List Locations', id: 'list_locations' },
        { label: 'List Positions', id: 'list_positions' },
        { label: 'List Business Units', id: 'list_business_units' },
        { label: 'List Legal Employers', id: 'list_legal_employers' },
        { label: 'List Grades', id: 'list_grades' },
        { label: 'List Person Types', id: 'list_person_types' },
      ],
    },
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_hcm',
      requiredScopes: getScopesForService('oracle_fusion_hcm'),
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle Fusion credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Fusion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'personPicker',
      title: 'Worker',
      type: 'file-selector',
      canonicalParamId: 'personId',
      serviceId: 'oracle_fusion_hcm',
      selectorKey: 'oracle_fusion_hcm.workers',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...PERSON_OPERATIONS, 'get_absence'] },
      required: { field: 'operation', value: PERSON_OPERATIONS },
      placeholder: 'Select a worker',
    },
    {
      id: 'personIdInput',
      title: 'Person ID',
      type: 'short-input',
      canonicalParamId: 'personId',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PERSON_OPERATIONS, 'get_absence'] },
      required: { field: 'operation', value: PERSON_OPERATIONS },
      placeholder: 'Enter person ID',
    },
    {
      id: 'assignmentPicker',
      title: 'Assignment',
      type: 'file-selector',
      canonicalParamId: 'assignmentId',
      serviceId: 'oracle_fusion_hcm',
      selectorKey: 'oracle_fusion_hcm.assignments',
      dependsOn: ['credential', 'personPicker'],
      mode: 'basic',
      condition: { field: 'operation', value: ASSIGNMENT_OPERATIONS },
      required: { field: 'operation', value: ASSIGNMENT_OPERATIONS },
      placeholder: 'Select an assignment',
    },
    {
      id: 'assignmentIdInput',
      title: 'Assignment ID',
      type: 'short-input',
      canonicalParamId: 'assignmentId',
      mode: 'advanced',
      condition: { field: 'operation', value: ASSIGNMENT_OPERATIONS },
      required: { field: 'operation', value: ASSIGNMENT_OPERATIONS },
      placeholder: 'Enter assignment ID',
    },
    {
      id: 'absencePicker',
      title: 'Absence',
      type: 'file-selector',
      canonicalParamId: 'absenceId',
      serviceId: 'oracle_fusion_hcm',
      selectorKey: 'oracle_fusion_hcm.absences',
      dependsOn: ['credential', 'personPicker'],
      mode: 'basic',
      condition: { field: 'operation', value: 'get_absence' },
      required: { field: 'operation', value: 'get_absence' },
      placeholder: 'Select an absence after choosing a worker',
    },
    {
      id: 'absenceIdInput',
      title: 'Absence ID',
      type: 'short-input',
      canonicalParamId: 'absenceId',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_absence' },
      required: { field: 'operation', value: 'get_absence' },
      placeholder: 'Enter absence ID',
    },
    {
      id: 'absenceTypePicker',
      title: 'Absence Type',
      type: 'file-selector',
      canonicalParamId: 'absenceTypeId',
      serviceId: 'oracle_fusion_hcm',
      selectorKey: 'oracle_fusion_hcm.absenceTypes',
      dependsOn: ['credential', 'personPicker'],
      mode: 'basic',
      condition: { field: 'operation', value: 'list_absences' },
      placeholder: 'Optionally select an absence type',
    },
    {
      id: 'absenceTypeIdInput',
      title: 'Absence Type ID',
      type: 'short-input',
      canonicalParamId: 'absenceTypeId',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_absences' },
      placeholder: 'Enter absence type ID',
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      condition: { field: 'operation', value: 'list_absences' },
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      description: 'Requires End Date and Absence Type',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 date (YYYY-MM-DD). Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      condition: { field: 'operation', value: 'list_absences' },
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      description: 'Requires Start Date and Absence Type',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 date (YYYY-MM-DD). Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      condition: { field: 'operation', value: SEARCH_OPERATIONS },
      placeholder: 'Optional name, code, number, or work email',
    },
    {
      id: 'effectiveDate',
      title: 'Effective Date',
      type: 'short-input',
      condition: { field: 'operation', value: EFFECTIVE_DATE_OPERATIONS },
      mode: 'advanced',
      placeholder: 'YYYY-MM-DD',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 date (YYYY-MM-DD). Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
      placeholder: '20',
      description: 'Maximum 100',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      condition: { field: 'operation', value: LIST_OPERATIONS },
      mode: 'advanced',
      placeholder: '0',
    },
  ],
  tools: {
    access: [
      'oracle_fusion_hcm_list_workers',
      'oracle_fusion_hcm_get_worker',
      'oracle_fusion_hcm_list_worker_assignments',
      'oracle_fusion_hcm_get_worker_assignment',
      'oracle_fusion_hcm_list_worker_managers',
      'oracle_fusion_hcm_list_worker_direct_reports',
      'oracle_fusion_hcm_list_absences',
      'oracle_fusion_hcm_get_absence',
      'oracle_fusion_hcm_list_absence_types',
      'oracle_fusion_hcm_list_jobs',
      'oracle_fusion_hcm_list_job_families',
      'oracle_fusion_hcm_list_departments',
      'oracle_fusion_hcm_list_locations',
      'oracle_fusion_hcm_list_positions',
      'oracle_fusion_hcm_list_business_units',
      'oracle_fusion_hcm_list_legal_employers',
      'oracle_fusion_hcm_list_grades',
      'oracle_fusion_hcm_list_person_types',
    ],
    config: {
      tool: (params) => `oracle_fusion_hcm_${params.operation || 'list_workers'}`,
      params: (params) => {
        const { operation, ...rest } = params
        for (const key of [
          'search',
          'effectiveDate',
          'absenceTypeId',
          'startDate',
          'endDate',
          'limit',
          'offset',
        ] as const) {
          const value = rest[key]
          if (value == null || (typeof value === 'string' && value.trim() === '')) {
            // The executor merges this over raw inputs, so unset values must be explicit.
            rest[key] = undefined
          }
        }
        for (const key of ['limit', 'offset'] as const) {
          if (typeof rest[key] === 'string') rest[key] = Number(rest[key])
        }
        return rest
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Read-only Oracle HCM operation' },
    oauthCredential: { type: 'string', description: 'Oracle Fusion integration-user credential' },
    personId: { type: 'string', description: 'Person ID' },
    assignmentId: { type: 'string', description: 'Assignment ID' },
    absenceId: { type: 'string', description: 'Absence entry ID' },
    absenceTypeId: { type: 'string', description: 'Absence type ID' },
    startDate: { type: 'string', description: 'Absence range start' },
    endDate: { type: 'string', description: 'Absence range end' },
    search: { type: 'string', description: 'Bounded search text' },
    effectiveDate: { type: 'string', description: 'Effective date' },
    limit: { type: 'number', description: 'Page size' },
    offset: { type: 'number', description: 'Page offset' },
  },
  outputs: {
    worker: {
      type: 'json',
      description:
        'Worker object with person ID and number, display and legal name fields, work email, and username',
      condition: { field: 'operation', value: 'get_worker' },
    },
    workers: {
      type: 'json',
      description:
        'Array of workers with person IDs and numbers, display and legal name fields, work email, and username',
      condition: { field: 'operation', value: 'list_workers' },
    },
    assignment: {
      type: 'json',
      description:
        'Assignment object with identity, dates, worker type, employer, business unit, department, job, position, location, and manager name',
      condition: { field: 'operation', value: 'get_worker_assignment' },
    },
    assignments: {
      type: 'json',
      description:
        'Array of assignments with identity, dates, worker type, employer, business unit, department, job, position, location, and manager name',
      condition: { field: 'operation', value: 'list_worker_assignments' },
    },
    managers: {
      type: 'json',
      description:
        'Array of managers with supervisor, assignment, and person IDs; names; relationship type; job; position; and work email',
      condition: { field: 'operation', value: 'list_worker_managers' },
    },
    directReports: {
      type: 'json',
      description:
        'Array of direct reports with nullable assignment and person IDs, names, relationship type, worker type, and report counts',
      condition: { field: 'operation', value: 'list_worker_direct_reports' },
    },
    absence: {
      type: 'json',
      description:
        'Absence object with identity, person and assignment references, type, status, approval, dates, duration, flags, employer, and last update',
      condition: { field: 'operation', value: 'get_absence' },
    },
    absences: {
      type: 'json',
      description:
        'Array of absences with identity, person and assignment references, type, status, approval, dates, duration, flags, employer, and last update',
      condition: { field: 'operation', value: 'list_absences' },
    },
    absenceTypes: {
      type: 'json',
      description:
        'Array of absence types with ID, name, description, employer, duration calculation basis and unit, and display sequence',
      condition: { field: 'operation', value: 'list_absence_types' },
    },
    jobs: {
      type: 'json',
      description:
        'Array of jobs with ID, code, name, status, family and function references, work classification, effective dates, and last update',
      condition: { field: 'operation', value: 'list_jobs' },
    },
    jobFamilies: {
      type: 'json',
      description:
        'Array of job families with ID, code, name, status, effective dates, and last update',
      condition: { field: 'operation', value: 'list_job_families' },
    },
    departments: {
      type: 'json',
      description:
        'Array of departments with organization ID, code, name, classification, status, location, effective dates, and last update',
      condition: { field: 'operation', value: 'list_departments' },
    },
    locations: {
      type: 'json',
      description:
        'Array of locations with ID, code, name, description, status, locality fields, effective dates, and last update',
      condition: { field: 'operation', value: 'list_locations' },
    },
    positions: {
      type: 'json',
      description:
        'Array of positions with ID, code, name, status, type, workforce-structure references, work classification, hiring status, effective dates, and last update',
      condition: { field: 'operation', value: 'list_positions' },
    },
    businessUnits: {
      type: 'json',
      description: 'Array of business units with ID, name, and status',
      condition: { field: 'operation', value: 'list_business_units' },
    },
    legalEmployers: {
      type: 'json',
      description:
        'Array of legal employers with organization ID, name, legislation code, and effective dates',
      condition: { field: 'operation', value: 'list_legal_employers' },
    },
    grades: {
      type: 'json',
      description:
        'Array of grades with ID, code, name, status, category, set reference, effective dates, and last update',
      condition: { field: 'operation', value: 'list_grades' },
    },
    personTypes: {
      type: 'json',
      description:
        'Array of person types with ID, system and user type names, active flag, and default flag',
      condition: { field: 'operation', value: 'list_person_types' },
    },
    count: {
      type: 'number',
      description: 'Records in this page',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page exists',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    limit: {
      type: 'number',
      description: 'Oracle page size',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    offset: {
      type: 'number',
      description: 'Oracle page offset',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    totalResults: {
      type: 'number',
      description: 'Estimated total when Oracle provides it',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
    nextOffset: {
      type: 'number',
      description: 'Next Oracle page offset when another page exists',
      condition: { field: 'operation', value: LIST_OPERATIONS },
    },
  },
}

export const OracleFusionHcmBlockMeta = {
  tags: ['automation'],
  url: 'https://www.oracle.com/human-capital-management/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Oracle worker lookup',
      prompt:
        'Build a workflow that safely searches Oracle Fusion Cloud HCM public workers, retrieves the selected worker and assignments, and returns only work identity and organizational details.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle reporting chain review',
      prompt:
        'Create a workflow that selects an Oracle HCM worker and assignment, lists that assignment’s managers, and formats a concise reporting-chain review.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle direct reports roster',
      prompt:
        'Build a workflow that lists direct reports for a selected Oracle HCM assignment and writes the bounded roster page to a review table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['hr', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle assignment audit',
      prompt:
        'Create a scheduled workflow that reads worker assignments from Oracle HCM, compares department, job, position, and location with a reference table, and flags mismatches without changing Oracle.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['hr', 'compliance'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle absence calendar',
      prompt:
        'Build a workflow that reads one worker’s Oracle HCM absences for a selected absence type and date range, then creates a review calendar without exposing reasons, comments, attachments, or medical data.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'planning'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle absence approval review',
      prompt:
        'Create a workflow that lists a worker’s Oracle HCM absences, summarizes status, approval state, dates, and duration, and routes exceptions for human review.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'review'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle workforce structure catalog',
      prompt:
        'Build a scheduled workflow that reads one page each of Oracle HCM jobs, job families, departments, locations, business units, legal employers, grades, and person types and stores a dated catalog snapshot.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['hr', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Oracle job alignment report',
      prompt:
        'Create a workflow that compares Oracle HCM jobs, positions, and grades by code and effective date, then produces a bounded alignment report for HR review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'reporting'],
    },
  ],
  skills: [
    {
      name: 'find-oracle-hcm-worker',
      description: 'Safely locate and read a public Oracle HCM worker.',
      content:
        '# Find an Oracle HCM Worker\n\n## Steps\n\n1. Search workers by work identity.\n2. Keep the result to one page.\n3. Get the selected worker by person ID.\n\n## Output\n\nReturn only the projected public worker fields.',
    },
    {
      name: 'review-oracle-hcm-assignments',
      description: 'Review a worker’s assignments and organizational placement.',
      content:
        '# Review Oracle HCM Assignments\n\n## Steps\n\n1. Resolve the worker.\n2. List one page of assignments.\n3. Get a selected assignment when needed.\n\n## Output\n\nReport dates, worker type, employer, business unit, department, job, position, and location.',
    },
    {
      name: 'trace-oracle-hcm-reporting-lines',
      description: 'Read managers or direct reports for one assignment.',
      content:
        '# Trace Oracle HCM Reporting Lines\n\n## Steps\n\n1. Select a worker and assignment.\n2. List managers or direct reports.\n3. Do not fetch additional pages unless the user asks.\n\n## Output\n\nReturn the reporting identities and page state.',
    },
    {
      name: 'review-oracle-hcm-absences',
      description: 'Read bounded absence records without sensitive narrative fields.',
      content:
        '# Review Oracle HCM Absences\n\n## Steps\n\n1. Select a worker.\n2. Optionally select an absence type and complete date range.\n3. List one page or get one exact absence ID.\n\n## Output\n\nReturn projected absence fields only. Never request reasons, comments, disease data, certifications, attachments, or entitlements.',
    },
    {
      name: 'catalog-oracle-hcm-workforce-structures',
      description: 'Create a bounded read-only workforce-structure catalog.',
      content:
        '# Catalog Oracle HCM Workforce Structures\n\n## Steps\n\n1. Choose the requested workforce-structure resource.\n2. Read one bounded page.\n3. Continue only when the user needs another page.\n\n## Output\n\nReturn the projected records with effective dates and page state.',
    },
    {
      name: 'compare-oracle-hcm-job-position-grade',
      description: 'Compare jobs, positions, and grades without modifying Oracle.',
      content:
        '# Compare Job, Position, and Grade\n\n## Steps\n\n1. Read matching jobs, positions, and grades using fixed search fields.\n2. Compare codes, names, status, references, and effective dates.\n3. Identify mismatches without modifying Oracle.\n\n## Output\n\nReport the mismatches for human review.',
    },
    {
      name: 'page-oracle-hcm-results',
      description: 'Continue an Oracle HCM collection safely.',
      content:
        '# Page Oracle HCM Results\n\n## Steps\n\n1. Read the returned nextOffset and hasMore values.\n2. Continue at nextOffset only when hasMore is true and another page is needed.\n3. Never auto-load an entire collection.\n\n## Output\n\nReturn the requested page and its updated pagination state.',
    },
  ],
} as const satisfies BlockMeta
