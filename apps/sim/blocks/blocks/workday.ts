import { WorkdayIcon } from '@/components/icons'
import { WorkdayBlockDisplay } from '@/blocks/blocks/workday.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'

export const WorkdayBlock: BlockConfig = {
  ...WorkdayBlockDisplay,
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
        { label: 'Update Personal Information', id: 'update_worker' },
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
      title: 'Personal Information (JSON)',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "Marital_Status_Reference": {\n    "ID": { "attributes": { "wd:type": "Marital_Status_ID" }, "$value": "Married" }\n  }\n}',
      description:
        'Demographic fields supported by Workday Change_Personal_Information (e.g. Date_of_Birth, Gender_Reference, Marital_Status_Reference, Ethnicity_Reference, Citizenship_Status_Reference). Does not update business title or work contact info.',
      condition: { field: 'operation', value: 'update_worker' },
      required: { field: 'operation', value: 'update_worker' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a Workday Personal_Information_Data payload as JSON for the Change_Personal_Information SOAP operation.

### SUPPORTED FIELDS (demographics only)
- Date_of_Birth: ISO date string (YYYY-MM-DD)
- Gender_Reference: { ID: { attributes: { "wd:type": "Gender_Code" }, $value: "Male" | "Female" | ... } }
- Marital_Status_Reference: { ID: { attributes: { "wd:type": "Marital_Status_ID" }, $value: "Married" | "Single" | ... } }
- Ethnicity_Reference: { ID: { attributes: { "wd:type": "Ethnicity_ID" }, $value: "..." } }
- Citizenship_Status_Reference: same shape

### NOT SUPPORTED BY THIS OPERATION
- Business title (use Change_Job)
- Work email / phone / manager (different SOAP ops)

### RULES
- Output ONLY valid JSON starting with { and ending with }
- Include only fields that need updating

### EXAMPLE
User: "Mark marital status as Married"
Output: {"Marital_Status_Reference":{"ID":{"attributes":{"wd:type":"Marital_Status_ID"},"$value":"Married"}}}`,
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
    worker: {
      type: 'json',
      description:
        'Worker profile (id, descriptor, personalData, employmentData, compensationData, organizationData)',
    },
    workers: {
      type: 'json',
      description: 'Array of worker profiles (id, descriptor, personalData, employmentData)',
    },
    total: { type: 'number', description: 'Total count of results' },
    preHireId: { type: 'string', description: 'Created pre-hire ID' },
    descriptor: { type: 'string', description: 'Display name of pre-hire' },
    workerId: { type: 'string', description: 'Worker ID' },
    employeeId: { type: 'string', description: 'Employee ID' },
    hireDate: { type: 'string', description: 'Hire date' },
    assignmentId: { type: 'string', description: 'Onboarding assignment ID' },
    planId: { type: 'string', description: 'Onboarding plan ID' },
    organizations: {
      type: 'json',
      description: 'Array of organizations (id, descriptor, type, subtype, isActive)',
    },
    eventId: { type: 'string', description: 'Event ID for staffing changes' },
    effectiveDate: { type: 'string', description: 'Effective date of change' },
    compensationPlans: {
      type: 'json',
      description: 'Compensation plans (id, planName, amount, currency, frequency)',
    },
    terminationDate: { type: 'string', description: 'Termination date' },
  },
}

export const WorkdayBlockMeta = {
  tags: ['hiring'],
  url: 'https://www.workday.com',
  templates: [
    {
      icon: WorkdayIcon,
      title: 'Workday new-hire kickoff',
      prompt:
        'Build a scheduled workflow that polls Workday for newly hired employees, gathers each one’s position and start date, kicks off provisioning in downstream tools, assigns an onboarding plan, schedules introductions on Google Calendar, and notifies the team in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'enterprise'],
      alsoIntegrations: ['slack', 'google_calendar'],
    },
    {
      icon: WorkdayIcon,
      title: 'Pre-hire creation pipeline',
      prompt:
        'Create a workflow exposed as a form that captures candidate details from recruiters, validates required fields, creates a pre-hire record in Workday, returns the pre-hire identifier, and logs the submission in a recruiting tracking table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'recruiting', 'automation'],
    },
    {
      icon: WorkdayIcon,
      title: 'Job change orchestrator',
      prompt:
        'Build a workflow that watches a Sim table of approved promotions, transfers, and demotions, performs the Workday change-job action for each row, updates downstream tools and Slack channel membership, and writes the outcome back to the table for audit.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: WorkdayIcon,
      title: 'Compensation review prep',
      prompt:
        'Create a scheduled workflow that pulls Workday workers and their current compensation, joins with a performance ratings table, drafts manager-by-manager compensation review packets as files, and emails each manager their packet ahead of the cycle.',
      modules: ['scheduled', 'tables', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: WorkdayIcon,
      title: 'Termination workflow',
      prompt:
        'Build a workflow triggered by an approved offboarding request that initiates the Workday Terminate Employee business process, deactivates downstream accounts, schedules an exit interview on Google Calendar, and writes a compliance record to an audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'compliance'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: WorkdayIcon,
      title: 'Org structure snapshot',
      prompt:
        'Create a scheduled weekly workflow that pulls Workday workers and organizations, builds an org chart file with departments and cost centers, diffs against last week to highlight structural changes, and emails the result to people leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise', 'reporting'],
    },
    {
      icon: WorkdayIcon,
      title: 'Personal info update self-service',
      prompt:
        'Build a workflow exposed as a chat or form endpoint that takes employee-submitted personal info changes, validates the request, calls the Workday Update Personal Information action, confirms back to the employee, and logs the change in a people-operations audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation', 'team'],
    },
  ],
  skills: [
    {
      name: 'look-up-worker',
      description: 'Find a worker in Workday and return their core profile and employment details.',
      content:
        '# Look Up a Worker in Workday\n\nRetrieve a worker record for HR review or downstream use.\n\n## Steps\n1. Resolve the worker by ID, or list workers and match on name or email.\n2. Call the get-worker operation for the matched worker.\n3. Extract the relevant fields: name, position, organization, manager, and status.\n\n## Output\nReturn the worker profile as structured fields. If multiple workers matched the search, list the candidates and ask which one before fetching full detail.',
    },
    {
      name: 'onboard-new-hire',
      description:
        'Create a pre-hire, hire the employee, and assign an onboarding plan in Workday.',
      content:
        '# Onboard a New Hire in Workday\n\nMove a candidate from pre-hire to onboarded employee.\n\n## Steps\n1. Create the pre-hire record with the candidate personal and contact details.\n2. Hire the employee using the pre-hire, setting position, organization, start date, and worker type.\n3. Assign the onboarding plan for the new worker.\n4. Confirm each step succeeded before moving to the next.\n\n## Output\nReport the new worker ID, position, start date, and the onboarding plan assigned. Stop and surface the error if any step fails rather than continuing.',
    },
    {
      name: 'process-job-change',
      description:
        'Apply a job change such as a transfer or promotion to an existing Workday worker.',
      content:
        '# Process a Job Change in Workday\n\nUpdate a worker position with a transfer, promotion, or reassignment.\n\n## Steps\n1. Look up the worker and confirm their current position and organization.\n2. Determine the new position, organization, or compensation involved in the change.\n3. Call the change-job operation with the change details and effective date.\n4. Optionally fetch compensation to confirm the new package.\n\n## Output\nReport the worker ID, the old and new position, the effective date, and confirmation the change was recorded.',
    },
    {
      name: 'update-worker-info',
      description:
        'Update a Workday worker personal information record with validated field changes.',
      content:
        '# Update Worker Personal Information\n\nApply validated personal-information changes for a worker.\n\n## Steps\n1. Look up the worker to confirm the record and current values.\n2. Validate the requested changes against expected formats before applying.\n3. Build the fields JSON with only the values that change.\n4. Call the update-worker operation and confirm acceptance.\n\n## Output\nReport which fields changed for the worker ID and confirm the update succeeded. Reject and explain any field that failed validation.',
    },
  ],
} as const satisfies BlockMeta
