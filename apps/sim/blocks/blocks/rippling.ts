import { RipplingIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const RipplingBlock: BlockConfig = {
  type: 'rippling',
  name: 'Rippling',
  description: 'Manage employees, leave, departments, and company data in Rippling',
  longDescription:
    'Integrate Rippling into your workflow. Manage employees, departments, teams, leave requests, work locations, groups, candidates, and company information.',
  docsLink: 'https://docs.sim.ai/tools/rippling',
  category: 'tools',
  integrationType: IntegrationType.HR,
  tags: ['hiring'],
  bgColor: '#FFCC1C',
  icon: RipplingIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Employees', id: 'list_employees' },
        { label: 'Get Employee', id: 'get_employee' },
        { label: 'List Employees (Including Terminated)', id: 'list_employees_with_terminated' },
        { label: 'List Departments', id: 'list_departments' },
        { label: 'List Teams', id: 'list_teams' },
        { label: 'List Levels', id: 'list_levels' },
        { label: 'List Work Locations', id: 'list_work_locations' },
        { label: 'Get Company', id: 'get_company' },
        { label: 'Get Company Activity', id: 'get_company_activity' },
        { label: 'List Custom Fields', id: 'list_custom_fields' },
        { label: 'Get Current User', id: 'get_current_user' },
        { label: 'List Leave Requests', id: 'list_leave_requests' },
        { label: 'Approve/Decline Leave Request', id: 'process_leave_request' },
        { label: 'List Leave Balances', id: 'list_leave_balances' },
        { label: 'Get Leave Balance', id: 'get_leave_balance' },
        { label: 'List Leave Types', id: 'list_leave_types' },
        { label: 'Create Group', id: 'create_group' },
        { label: 'Update Group', id: 'update_group' },
        { label: 'Push Candidate', id: 'push_candidate' },
      ],
      value: () => 'list_employees',
    },
    // Employee ID - for get_employee
    {
      id: 'employeeId',
      title: 'Employee ID',
      type: 'short-input',
      placeholder: 'Enter the employee ID',
      required: { field: 'operation', value: 'get_employee' },
      condition: { field: 'operation', value: 'get_employee' },
    },
    // Leave Request fields
    {
      id: 'leaveRequestId',
      title: 'Leave Request ID',
      type: 'short-input',
      placeholder: 'Enter the leave request ID',
      required: { field: 'operation', value: 'process_leave_request' },
      condition: { field: 'operation', value: 'process_leave_request' },
    },
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      options: [
        { label: 'Approve', id: 'approve' },
        { label: 'Decline', id: 'decline' },
      ],
      value: () => 'approve',
      required: { field: 'operation', value: 'process_leave_request' },
      condition: { field: 'operation', value: 'process_leave_request' },
    },
    // Leave balance - role ID
    {
      id: 'roleId',
      title: 'Employee/Role ID',
      type: 'short-input',
      placeholder: 'Enter the employee or role ID',
      required: { field: 'operation', value: 'get_leave_balance' },
      condition: { field: 'operation', value: 'get_leave_balance' },
    },
    // Group fields
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Enter group name',
      required: { field: 'operation', value: 'create_group' },
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
    },
    {
      id: 'spokeId',
      title: 'Spoke ID',
      type: 'short-input',
      placeholder: 'Third-party app identifier',
      required: { field: 'operation', value: 'create_group' },
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
    },
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Enter the group ID to update',
      required: { field: 'operation', value: 'update_group' },
      condition: { field: 'operation', value: 'update_group' },
    },
    {
      id: 'users',
      title: 'User IDs',
      type: 'long-input',
      placeholder: '["user-id-1", "user-id-2"]',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_group', 'update_group'] },
    },
    {
      id: 'groupVersion',
      title: 'Version',
      type: 'short-input',
      placeholder: 'Group version number',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_group' },
    },
    // Candidate fields
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Candidate first name',
      required: { field: 'operation', value: 'push_candidate' },
      condition: { field: 'operation', value: 'push_candidate' },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Candidate last name',
      required: { field: 'operation', value: 'push_candidate' },
      condition: { field: 'operation', value: 'push_candidate' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Candidate email address',
      required: { field: 'operation', value: 'push_candidate' },
      condition: { field: 'operation', value: 'push_candidate' },
    },
    {
      id: 'candidatePhone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Candidate phone number',
      mode: 'advanced',
      condition: { field: 'operation', value: 'push_candidate' },
    },
    {
      id: 'jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Job title for the candidate',
      mode: 'advanced',
      condition: { field: 'operation', value: 'push_candidate' },
    },
    {
      id: 'candidateDepartment',
      title: 'Department',
      type: 'short-input',
      placeholder: 'Department for the candidate',
      mode: 'advanced',
      condition: { field: 'operation', value: 'push_candidate' },
    },
    {
      id: 'candidateStartDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'push_candidate' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for a candidate start date. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    // Date filters for leave requests and company activity
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_leave_requests', 'get_company_activity'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for filtering by start date. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_leave_requests', 'get_company_activity'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format for filtering by end date. Return ONLY the date string - no explanations, no extra text.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'short-input',
      placeholder: 'e.g., pending, approved, declined',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_leave_requests' },
    },
    {
      id: 'managedBy',
      title: 'Managed By',
      type: 'short-input',
      placeholder: 'Filter by manager',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_leave_types' },
    },
    // Pagination - shared across list operations (offset-based)
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_employees',
          'list_employees_with_terminated',
          'list_departments',
          'list_teams',
          'list_levels',
          'list_work_locations',
          'list_custom_fields',
          'list_leave_balances',
          'get_company_activity',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'list_employees',
          'list_employees_with_terminated',
          'list_departments',
          'list_teams',
          'list_levels',
          'list_work_locations',
          'list_custom_fields',
          'list_leave_balances',
        ],
      },
    },
    // Cursor-based pagination for company activity
    {
      id: 'nextCursor',
      title: 'Next Page Cursor',
      type: 'short-input',
      placeholder: 'Cursor from previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: 'get_company_activity' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Rippling API key',
      required: true,
      password: true,
    },
  ],

  tools: {
    access: [
      'rippling_list_employees',
      'rippling_get_employee',
      'rippling_list_employees_with_terminated',
      'rippling_list_departments',
      'rippling_list_teams',
      'rippling_list_levels',
      'rippling_list_work_locations',
      'rippling_get_company',
      'rippling_get_company_activity',
      'rippling_list_custom_fields',
      'rippling_get_current_user',
      'rippling_list_leave_requests',
      'rippling_process_leave_request',
      'rippling_list_leave_balances',
      'rippling_get_leave_balance',
      'rippling_list_leave_types',
      'rippling_create_group',
      'rippling_update_group',
      'rippling_push_candidate',
    ],
    config: {
      tool: (params) => `rippling_${params.operation}`,
      params: (params) => {
        const mapped: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        if (params.employeeId) mapped.employeeId = params.employeeId
        if (params.leaveRequestId) mapped.leaveRequestId = params.leaveRequestId
        if (params.action) mapped.action = params.action
        if (params.roleId) mapped.roleId = params.roleId
        if (params.spokeId) mapped.spokeId = params.spokeId
        if (params.groupId) mapped.groupId = params.groupId
        if (params.firstName) mapped.firstName = params.firstName
        if (params.lastName) mapped.lastName = params.lastName
        if (params.email) mapped.email = params.email
        if (params.jobTitle) mapped.jobTitle = params.jobTitle
        if (params.startDate && params.operation !== 'push_candidate')
          mapped.startDate = params.startDate
        if (params.endDate && params.operation !== 'push_candidate') mapped.endDate = params.endDate
        if (params.status) mapped.status = params.status
        if (params.managedBy) mapped.managedBy = params.managedBy

        if (params.limit != null && params.limit !== '') mapped.limit = Number(params.limit)
        if (params.offset != null && params.offset !== '') mapped.offset = Number(params.offset)
        if (params.groupVersion != null && params.groupVersion !== '')
          mapped.version = Number(params.groupVersion)
        if (params.groupName) mapped.name = params.groupName
        if (params.candidatePhone) mapped.phone = params.candidatePhone
        if (params.candidateDepartment) mapped.department = params.candidateDepartment
        if (params.candidateStartDate && params.operation === 'push_candidate')
          mapped.startDate = params.candidateStartDate
        if (params.nextCursor) mapped.next = params.nextCursor

        if (params.users) {
          try {
            mapped.users =
              typeof params.users === 'string' ? JSON.parse(params.users) : params.users
          } catch {
            throw new Error(
              'Invalid JSON for "User IDs" field. Expected an array like ["user-id-1", "user-id-2"].'
            )
          }
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    employeeId: { type: 'string', description: 'Employee ID' },
    leaveRequestId: { type: 'string', description: 'Leave request ID' },
    action: { type: 'string', description: 'Action to take (approve or decline)' },
    roleId: { type: 'string', description: 'Employee/role ID for leave balance' },
    groupName: { type: 'string', description: 'Group name' },
    spokeId: { type: 'string', description: 'Third-party app identifier' },
    groupId: { type: 'string', description: 'Group ID to update' },
    users: { type: 'json', description: 'Array of user IDs' },
    firstName: { type: 'string', description: 'Candidate first name' },
    lastName: { type: 'string', description: 'Candidate last name' },
    email: { type: 'string', description: 'Candidate email' },
    candidatePhone: { type: 'string', description: 'Candidate phone number' },
    jobTitle: { type: 'string', description: 'Job title' },
    candidateDepartment: { type: 'string', description: 'Department' },
    candidateStartDate: { type: 'string', description: 'Start date (ISO format)' },
    startDate: { type: 'string', description: 'Filter start date' },
    endDate: { type: 'string', description: 'Filter end date' },
    status: { type: 'string', description: 'Leave request status filter' },
    managedBy: { type: 'string', description: 'Filter leave types by manager' },
    limit: { type: 'number', description: 'Maximum number of results' },
    offset: { type: 'number', description: 'Pagination offset' },
    nextCursor: { type: 'string', description: 'Cursor for next page (company activity)' },
    apiKey: { type: 'string', description: 'Rippling API key' },
  },

  outputs: {
    employees: {
      type: 'array',
      description:
        'List of employees (id, firstName, lastName, workEmail, roleState, department, title)',
    },
    departments: { type: 'array', description: 'List of departments (id, name, parent)' },
    teams: { type: 'array', description: 'List of teams (id, name, parent)' },
    levels: { type: 'array', description: 'List of position levels (id, name, parent)' },
    workLocations: {
      type: 'array',
      description: 'List of work locations (id, nickname, street, city, state, zip, country)',
    },
    customFields: {
      type: 'array',
      description: 'List of custom fields (id, type, title, mandatory)',
    },
    events: {
      type: 'array',
      description: 'List of company activity events (id, type, description, createdAt, actor)',
    },
    leaveRequests: {
      type: 'array',
      description: 'List of leave requests (id, requestedBy, status, startDate, endDate)',
    },
    leaveBalances: { type: 'array', description: 'List of leave balances (employeeId, balances)' },
    leaveTypes: { type: 'array', description: 'List of leave types (id, name, managedBy)' },
    totalCount: { type: 'number', description: 'Total number of items returned' },
    id: { type: 'string', description: 'Resource ID' },
    name: { type: 'string', description: 'Resource name' },
    workEmail: { type: 'string', description: 'Work email address' },
    company: { type: 'string', description: 'Company ID' },
    status: { type: 'string', description: 'Status of the resource' },
    users: { type: 'array', description: 'Array of user IDs in a group' },
    version: { type: 'number', description: 'Group version number' },
    address: { type: 'json', description: 'Company address (street, city, state, zip, country)' },
    email: { type: 'string', description: 'Email address' },
    phone: { type: 'string', description: 'Phone number' },
    balances: { type: 'array', description: 'Leave balance entries (leaveType, minutesRemaining)' },
    employeeId: { type: 'string', description: 'Employee ID' },
    nextCursor: { type: 'string', description: 'Cursor for fetching the next page of results' },
  },
}
