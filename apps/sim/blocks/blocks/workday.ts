import { WorkdayIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'

export const WorkdayBlock: BlockConfig = {
  type: 'workday',
  name: 'Workday',
  description: 'Manage workers, hiring, onboarding, and HR operations in Workday',
  longDescription:
    'Integrate Workday HRIS into your workflow. Create pre-hires, hire employees, manage worker profiles, assign onboarding plans, handle job changes, retrieve compensation data, and process terminations.',
  docsLink: 'https://docs.sim.ai/tools/workday',
  category: 'tools',
  integrationType: IntegrationType.HR,
  tags: ['hiring', 'project-management'],
  bgColor: '#F5F0EB',
  icon: WorkdayIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Worker', id: 'get_worker' },
        { label: 'List Workers', id: 'list_workers' },
        { label: 'Create Pre-Hire', id: 'create_prehire' },
        { label: 'Hire Employee', id: 'hire_employee' },
        { label: 'Update Worker', id: 'update_worker' },
        { label: 'Assign Onboarding Plan', id: 'assign_onboarding' },
        { label: 'Get Organizations', id: 'get_organizations' },
        { label: 'Change Job', id: 'change_job' },
        { label: 'Get Compensation', id: 'get_compensation' },
        { label: 'Terminate Worker', id: 'terminate_worker' },
      ],
      value: () => 'get_worker',
    },
    {
      id: 'tenantUrl',
      title: 'Tenant URL',
      type: 'short-input',
      placeholder: 'https://wd2-impl-services1.workday.com',
      required: true,
      description: 'Your Workday instance URL (e.g., https://wd2-impl-services1.workday.com)',
    },
    {
      id: 'tenant',
      title: 'Tenant Name',
      type: 'short-input',
      placeholder: 'mycompany',
      required: true,
      description: 'Workday tenant identifier',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'ISU username',
      required: true,
      description: 'Integration System User username',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'ISU password',
      password: true,
      required: true,
      description: 'Integration System User password',
    },

    // Get Worker
    {
      id: 'workerId',
      title: 'Worker ID',
      type: 'short-input',
      placeholder: 'e.g., 3aa5550b7fe348b98d7b5741afc65534',
      condition: {
        field: 'operation',
        value: [
          'get_worker',
          'update_worker',
          'assign_onboarding',
          'change_job',
          'get_compensation',
          'terminate_worker',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_worker',
          'update_worker',
          'assign_onboarding',
          'change_job',
          'get_compensation',
          'terminate_worker',
        ],
      },
    },

    // List Workers
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: ['list_workers', 'get_organizations'] },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: ['list_workers', 'get_organizations'] },
      mode: 'advanced',
    },

    // Create Pre-Hire
    {
      id: 'legalName',
      title: 'Legal Name',
      type: 'short-input',
      placeholder: 'e.g., Jane Doe',
      condition: { field: 'operation', value: 'create_prehire' },
      required: { field: 'operation', value: 'create_prehire' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'jane.doe@company.com',
      condition: { field: 'operation', value: 'create_prehire' },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+1-555-0100',
      condition: { field: 'operation', value: 'create_prehire' },
      mode: 'advanced',
    },
    {
      id: 'address',
      title: 'Address',
      type: 'short-input',
      placeholder: '123 Main St, City, State',
      condition: { field: 'operation', value: 'create_prehire' },
      mode: 'advanced',
    },
    {
      id: 'countryCode',
      title: 'Country Code',
      type: 'short-input',
      placeholder: 'US',
      condition: { field: 'operation', value: 'create_prehire' },
      mode: 'advanced',
      description: 'ISO 3166-1 Alpha-2 country code (defaults to US)',
    },

    // Hire Employee
    {
      id: 'preHireId',
      title: 'Pre-Hire ID',
      type: 'short-input',
      placeholder: 'Pre-hire record ID',
      condition: { field: 'operation', value: 'hire_employee' },
      required: { field: 'operation', value: 'hire_employee' },
    },
    {
      id: 'positionId',
      title: 'Position ID',
      type: 'short-input',
      placeholder: 'Position to assign',
      condition: { field: 'operation', value: ['hire_employee', 'change_job'] },
      required: { field: 'operation', value: ['hire_employee'] },
    },
    {
      id: 'hireDate',
      title: 'Hire Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'hire_employee' },
      required: { field: 'operation', value: 'hire_employee' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 date (YYYY-MM-DD). Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'jobProfileId',
      title: 'Job Profile ID',
      type: 'short-input',
      placeholder: 'Job profile ID',
      condition: { field: 'operation', value: 'change_job' },
      mode: 'advanced',
    },
    {
      id: 'locationId',
      title: 'Location ID',
      type: 'short-input',
      placeholder: 'Work location ID',
      condition: { field: 'operation', value: 'change_job' },
      mode: 'advanced',
    },
    {
      id: 'supervisoryOrgId',
      title: 'Supervisory Organization ID',
      type: 'short-input',
      placeholder: 'Target supervisory organization ID',
      condition: { field: 'operation', value: 'change_job' },
      mode: 'advanced',
    },
    {
      id: 'employeeType',
      title: 'Employee Type',
      type: 'dropdown',
      options: [
        { label: 'Regular', id: 'Regular' },
        { label: 'Temporary', id: 'Temporary' },
        { label: 'Contractor', id: 'Contractor' },
      ],
      value: () => 'Regular',
      condition: { field: 'operation', value: 'hire_employee' },
      mode: 'advanced',
    },

    // Update Worker
    {
      id: 'fields',
      title: 'Fields (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "businessTitle": "Senior Engineer",\n  "primaryWorkEmail": "new@company.com"\n}',
      condition: { field: 'operation', value: 'update_worker' },
      required: { field: 'operation', value: 'update_worker' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a Workday worker update payload as JSON.

### COMMON FIELDS
- businessTitle: Job title string
- primaryWorkEmail: Work email address
- primaryWorkPhone: Work phone number
- managerReference: Manager worker ID

### RULES
- Output ONLY valid JSON starting with { and ending with }
- Include only fields that need updating

### EXAMPLE
User: "Update title to Senior Engineer"
Output: {"businessTitle": "Senior Engineer"}`,
        generationType: 'json-object',
      },
    },

    // Assign Onboarding
    {
      id: 'onboardingPlanId',
      title: 'Onboarding Plan ID',
      type: 'short-input',
      placeholder: 'Plan ID to assign',
      condition: { field: 'operation', value: 'assign_onboarding' },
      required: { field: 'operation', value: 'assign_onboarding' },
    },
    {
      id: 'actionEventId',
      title: 'Action Event ID',
      type: 'short-input',
      placeholder: 'Hiring event ID that enables onboarding',
      condition: { field: 'operation', value: 'assign_onboarding' },
      required: { field: 'operation', value: 'assign_onboarding' },
    },

    // Get Organizations
    {
      id: 'orgType',
      title: 'Organization Type',
      type: 'dropdown',
      options: [
        { label: 'All Types', id: '' },
        { label: 'Supervisory', id: 'Supervisory' },
        { label: 'Cost Center', id: 'Cost_Center' },
        { label: 'Company', id: 'Company' },
        { label: 'Region', id: 'Region' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'get_organizations' },
    },

    // Change Job
    {
      id: 'effectiveDate',
      title: 'Effective Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'change_job' },
      required: { field: 'operation', value: 'change_job' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 date (YYYY-MM-DD). Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'reason',
      title: 'Reason',
      type: 'short-input',
      placeholder: 'e.g., Promotion, Transfer',
      condition: { field: 'operation', value: ['change_job', 'terminate_worker'] },
      required: { field: 'operation', value: ['change_job', 'terminate_worker'] },
    },

    // Terminate Worker
    {
      id: 'terminationDate',
      title: 'Termination Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'terminate_worker' },
      required: { field: 'operation', value: 'terminate_worker' },
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 date (YYYY-MM-DD). Return ONLY the date string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'notificationDate',
      title: 'Notification Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'terminate_worker' },
      mode: 'advanced',
    },
    {
      id: 'lastDayOfWork',
      title: 'Last Day of Work',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (defaults to termination date)',
      condition: { field: 'operation', value: 'terminate_worker' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'workday_get_worker',
      'workday_list_workers',
      'workday_create_prehire',
      'workday_hire_employee',
      'workday_update_worker',
      'workday_assign_onboarding',
      'workday_get_organizations',
      'workday_change_job',
      'workday_get_compensation',
      'workday_terminate_worker',
    ],
    config: {
      tool: (params) => `workday_${params.operation}`,
      params: (params) => {
        const { operation, orgType, fields, jobProfileId, locationId, supervisoryOrgId, ...rest } =
          params

        if (rest.limit != null && rest.limit !== '') rest.limit = Number(rest.limit)
        if (rest.offset != null && rest.offset !== '') rest.offset = Number(rest.offset)

        if (orgType) rest.type = orgType

        if (operation === 'change_job') {
          if (rest.positionId) {
            rest.newPositionId = rest.positionId
            rest.positionId = undefined
          }
          if (jobProfileId) rest.newJobProfileId = jobProfileId
          if (locationId) rest.newLocationId = locationId
          if (supervisoryOrgId) rest.newSupervisoryOrgId = supervisoryOrgId
        }

        if (fields && operation === 'update_worker') {
          try {
            const parsedFields = typeof fields === 'string' ? JSON.parse(fields) : fields
            return { ...rest, fields: parsedFields }
          } catch {
            throw new Error('Invalid JSON in Fields block')
          }
        }

        return rest
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Workday operation to perform' },
    tenantUrl: { type: 'string', description: 'Workday instance URL' },
    tenant: { type: 'string', description: 'Workday tenant name' },
    username: { type: 'string', description: 'ISU username' },
    password: { type: 'string', description: 'ISU password' },
    workerId: { type: 'string', description: 'Worker ID' },
    limit: { type: 'number', description: 'Result limit' },
    offset: { type: 'number', description: 'Pagination offset' },
    legalName: { type: 'string', description: 'Legal name for pre-hire' },
    email: { type: 'string', description: 'Email address' },
    phoneNumber: { type: 'string', description: 'Phone number' },
    address: { type: 'string', description: 'Address' },
    countryCode: { type: 'string', description: 'ISO 3166-1 Alpha-2 country code' },
    preHireId: { type: 'string', description: 'Pre-hire record ID' },
    positionId: { type: 'string', description: 'Position ID' },
    hireDate: { type: 'string', description: 'Hire date (YYYY-MM-DD)' },
    jobProfileId: { type: 'string', description: 'Job profile ID' },
    locationId: { type: 'string', description: 'Location ID' },
    supervisoryOrgId: { type: 'string', description: 'Target supervisory organization ID' },
    employeeType: { type: 'string', description: 'Employee type' },
    fields: { type: 'json', description: 'Fields to update' },
    onboardingPlanId: { type: 'string', description: 'Onboarding plan ID' },
    actionEventId: { type: 'string', description: 'Action event ID for onboarding' },
    orgType: { type: 'string', description: 'Organization type filter' },
    effectiveDate: { type: 'string', description: 'Effective date (YYYY-MM-DD)' },
    reason: { type: 'string', description: 'Reason for change or termination' },
    terminationDate: { type: 'string', description: 'Termination date (YYYY-MM-DD)' },
    notificationDate: { type: 'string', description: 'Notification date' },
    lastDayOfWork: { type: 'string', description: 'Last day of work' },
  },
  outputs: {
    worker: { type: 'json', description: 'Worker profile data' },
    workers: { type: 'json', description: 'Array of worker profiles' },
    total: { type: 'number', description: 'Total count of results' },
    preHireId: { type: 'string', description: 'Created pre-hire ID' },
    descriptor: { type: 'string', description: 'Display name of pre-hire' },
    workerId: { type: 'string', description: 'Worker ID' },
    employeeId: { type: 'string', description: 'Employee ID' },
    hireDate: { type: 'string', description: 'Hire date' },
    assignmentId: { type: 'string', description: 'Onboarding assignment ID' },
    planId: { type: 'string', description: 'Onboarding plan ID' },
    organizations: { type: 'json', description: 'Array of organizations' },
    eventId: { type: 'string', description: 'Event ID for staffing changes' },
    effectiveDate: { type: 'string', description: 'Effective date of change' },
    compensationPlans: { type: 'json', description: 'Compensation plan details' },
    terminationDate: { type: 'string', description: 'Termination date' },
  },
}
