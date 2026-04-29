import { GustoIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { GustoResponse } from '@/tools/gusto/types'

const COMPANY_ID_OPS = [
  'gusto_get_company',
  'gusto_list_employees',
  'gusto_create_employee',
  'gusto_list_contractors',
  'gusto_create_contractor',
  'gusto_list_payrolls',
  'gusto_get_payroll',
  'gusto_create_off_cycle_payroll',
  'gusto_calculate_payroll',
  'gusto_submit_payroll',
  'gusto_cancel_payroll',
  'gusto_list_contractor_payments',
  'gusto_get_contractor_payment',
  'gusto_create_contractor_payment',
  'gusto_list_pay_schedules',
  'gusto_list_locations',
  'gusto_list_departments',
  'gusto_create_department',
  'gusto_list_company_benefits',
] as const

const EMPLOYEE_ID_OPS = [
  'gusto_get_employee',
  'gusto_update_employee',
  'gusto_terminate_employee',
  'gusto_rehire_employee',
  'gusto_list_employee_jobs',
  'gusto_list_pay_stubs',
  'gusto_get_employee_onboarding_status',
  'gusto_list_employee_benefits',
  'gusto_list_employee_forms',
  'gusto_list_employee_time_off_activities',
] as const

const CONTRACTOR_ID_OPS = [
  'gusto_get_contractor',
  'gusto_update_contractor',
  'gusto_list_contractor_forms',
] as const

const PAYROLL_ID_OPS = [
  'gusto_get_payroll',
  'gusto_calculate_payroll',
  'gusto_submit_payroll',
  'gusto_cancel_payroll',
] as const

const PERSON_NAME_OPS = ['gusto_create_employee', 'gusto_create_contractor'] as const
const VERSION_OPS = ['gusto_update_employee', 'gusto_update_contractor'] as const
const EFFECTIVE_DATE_OPS = ['gusto_terminate_employee', 'gusto_rehire_employee'] as const
const START_END_DATE_OPS = [
  'gusto_list_payrolls',
  'gusto_list_contractor_payments',
  'gusto_create_off_cycle_payroll',
] as const

const START_DATE_OPS = [...START_END_DATE_OPS, 'gusto_create_contractor'] as const

export const GustoBlock: BlockConfig<GustoResponse> = {
  type: 'gusto',
  name: 'Gusto',
  description: 'Manage employees, contractors, and payroll in Gusto',
  longDescription:
    'Run payroll end-to-end, manage employees and contractors (create, update, terminate, rehire), pay contractors, view time off activities and benefits, and access pay stubs, forms, and onboarding status.',
  docsLink: 'https://docs.sim.ai/tools/gusto',
  category: 'tools',
  authMode: AuthMode.OAuth,
  integrationType: IntegrationType.HR,
  tags: ['hiring'],
  icon: GustoIcon,
  bgColor: '#F45D48',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Company', id: 'gusto_get_company' },
        { label: 'List Employees', id: 'gusto_list_employees' },
        { label: 'Get Employee', id: 'gusto_get_employee' },
        { label: 'Create Employee', id: 'gusto_create_employee' },
        { label: 'Update Employee', id: 'gusto_update_employee' },
        { label: 'Terminate Employee', id: 'gusto_terminate_employee' },
        { label: 'Rehire Employee', id: 'gusto_rehire_employee' },
        { label: 'List Employee Jobs', id: 'gusto_list_employee_jobs' },
        { label: 'List Pay Stubs', id: 'gusto_list_pay_stubs' },
        { label: 'Get Employee Onboarding Status', id: 'gusto_get_employee_onboarding_status' },
        { label: 'List Contractors', id: 'gusto_list_contractors' },
        { label: 'Get Contractor', id: 'gusto_get_contractor' },
        { label: 'Create Contractor', id: 'gusto_create_contractor' },
        { label: 'Update Contractor', id: 'gusto_update_contractor' },
        { label: 'List Payrolls', id: 'gusto_list_payrolls' },
        { label: 'Get Payroll', id: 'gusto_get_payroll' },
        { label: 'Create Off-Cycle Payroll', id: 'gusto_create_off_cycle_payroll' },
        { label: 'Calculate Payroll', id: 'gusto_calculate_payroll' },
        { label: 'Submit Payroll', id: 'gusto_submit_payroll' },
        { label: 'Cancel Payroll', id: 'gusto_cancel_payroll' },
        { label: 'List Contractor Payments', id: 'gusto_list_contractor_payments' },
        { label: 'Get Contractor Payment', id: 'gusto_get_contractor_payment' },
        { label: 'Create Contractor Payment', id: 'gusto_create_contractor_payment' },
        {
          label: 'List Employee Time Off Activities',
          id: 'gusto_list_employee_time_off_activities',
        },
        { label: 'List Pay Schedules', id: 'gusto_list_pay_schedules' },
        { label: 'List Locations', id: 'gusto_list_locations' },
        { label: 'List Departments', id: 'gusto_list_departments' },
        { label: 'Create Department', id: 'gusto_create_department' },
        { label: 'List Company Benefits', id: 'gusto_list_company_benefits' },
        { label: 'List Employee Benefits', id: 'gusto_list_employee_benefits' },
        { label: 'List Employee Forms', id: 'gusto_list_employee_forms' },
        { label: 'List Contractor Forms', id: 'gusto_list_contractor_forms' },
      ],
      value: () => 'gusto_list_employees',
    },
    {
      id: 'credential',
      title: 'Gusto Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'gusto',
      requiredScopes: getScopesForService('gusto'),
      placeholder: 'Select Gusto account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Gusto Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Enter Gusto company UUID',
      required: { field: 'operation', value: [...COMPANY_ID_OPS] },
      condition: { field: 'operation', value: [...COMPANY_ID_OPS] },
    },
    {
      id: 'employeeId',
      title: 'Employee ID',
      type: 'short-input',
      placeholder: 'Enter Gusto employee UUID',
      required: { field: 'operation', value: [...EMPLOYEE_ID_OPS] },
      condition: { field: 'operation', value: [...EMPLOYEE_ID_OPS] },
    },
    {
      id: 'contractorId',
      title: 'Contractor ID',
      type: 'short-input',
      placeholder: 'Enter Gusto contractor UUID',
      required: { field: 'operation', value: [...CONTRACTOR_ID_OPS] },
      condition: { field: 'operation', value: [...CONTRACTOR_ID_OPS] },
    },
    {
      id: 'payrollId',
      title: 'Payroll ID',
      type: 'short-input',
      placeholder: 'Enter Gusto payroll UUID',
      required: { field: 'operation', value: [...PAYROLL_ID_OPS] },
      condition: { field: 'operation', value: [...PAYROLL_ID_OPS] },
    },
    {
      id: 'contractorPaymentId',
      title: 'Contractor Payment ID',
      type: 'short-input',
      placeholder: 'Enter contractor payment UUID',
      required: { field: 'operation', value: 'gusto_get_contractor_payment' },
      condition: { field: 'operation', value: 'gusto_get_contractor_payment' },
    },
    {
      id: 'version',
      title: 'Version',
      type: 'short-input',
      placeholder: 'Current record version (required for updates)',
      required: { field: 'operation', value: [...VERSION_OPS] },
      condition: { field: 'operation', value: [...VERSION_OPS] },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'First name',
      required: { field: 'operation', value: 'gusto_create_employee' },
      condition: {
        field: 'operation',
        value: [...PERSON_NAME_OPS, 'gusto_update_employee', 'gusto_update_contractor'],
      },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Last name',
      required: { field: 'operation', value: 'gusto_create_employee' },
      condition: {
        field: 'operation',
        value: [...PERSON_NAME_OPS, 'gusto_update_employee', 'gusto_update_contractor'],
      },
    },
    {
      id: 'email',
      title: 'Personal Email',
      type: 'short-input',
      placeholder: 'Personal email address',
      condition: {
        field: 'operation',
        value: [...PERSON_NAME_OPS, 'gusto_update_employee', 'gusto_update_contractor'],
      },
    },
    {
      id: 'middleInitial',
      title: 'Middle Initial',
      type: 'short-input',
      placeholder: 'Middle initial',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [...PERSON_NAME_OPS, 'gusto_update_employee', 'gusto_update_contractor'],
      },
    },
    {
      id: 'dateOfBirth',
      title: 'Date of Birth',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: ['gusto_create_employee', 'gusto_update_employee'] },
    },
    {
      id: 'ssn',
      title: 'SSN',
      type: 'short-input',
      placeholder: 'Social security number (digits only)',
      password: true,
      mode: 'advanced',
      condition: { field: 'operation', value: ['gusto_create_employee', 'gusto_update_employee'] },
    },
    {
      id: 'preferredFirstName',
      title: 'Preferred First Name',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_update_employee' },
    },
    {
      id: 'twoPercentShareholder',
      title: '2% Shareholder',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gusto_update_employee', 'gusto_rehire_employee'],
      },
    },
    {
      id: 'selfOnboarding',
      title: 'Self Onboarding',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: [...PERSON_NAME_OPS] },
    },
    {
      id: 'type',
      title: 'Contractor Type',
      type: 'dropdown',
      options: [
        { label: 'Individual', id: 'Individual' },
        { label: 'Business', id: 'Business' },
      ],
      value: () => 'Individual',
      required: { field: 'operation', value: 'gusto_create_contractor' },
      condition: { field: 'operation', value: 'gusto_create_contractor' },
    },
    {
      id: 'wageType',
      title: 'Wage Type',
      type: 'dropdown',
      options: [
        { label: 'Fixed', id: 'Fixed' },
        { label: 'Hourly', id: 'Hourly' },
      ],
      value: () => 'Fixed',
      required: { field: 'operation', value: 'gusto_create_contractor' },
      condition: {
        field: 'operation',
        value: ['gusto_create_contractor', 'gusto_update_contractor'],
      },
    },
    {
      id: 'businessName',
      title: 'Business Name',
      type: 'short-input',
      placeholder: 'Business name (Business contractors only)',
      condition: {
        field: 'operation',
        value: ['gusto_create_contractor', 'gusto_update_contractor'],
      },
    },
    {
      id: 'ein',
      title: 'EIN',
      type: 'short-input',
      placeholder: 'Employer Identification Number',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gusto_create_contractor', 'gusto_update_contractor'],
      },
    },
    {
      id: 'hourlyRate',
      title: 'Hourly Rate',
      type: 'short-input',
      placeholder: 'e.g. 25.00',
      condition: {
        field: 'operation',
        value: ['gusto_create_contractor', 'gusto_update_contractor'],
      },
    },
    {
      id: 'effectiveDate',
      title: 'Effective Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: { field: 'operation', value: [...EFFECTIVE_DATE_OPS] },
      condition: { field: 'operation', value: [...EFFECTIVE_DATE_OPS] },
    },
    {
      id: 'runTerminationPayroll',
      title: 'Run Termination Payroll',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_terminate_employee' },
    },
    {
      id: 'fileNewHireReport',
      title: 'File New Hire Report',
      type: 'switch',
      required: { field: 'operation', value: 'gusto_rehire_employee' },
      condition: { field: 'operation', value: 'gusto_rehire_employee' },
    },
    {
      id: 'workLocationUuid',
      title: 'Work Location UUID',
      type: 'short-input',
      placeholder: 'UUID of the rehired employee work location',
      required: { field: 'operation', value: 'gusto_rehire_employee' },
      condition: { field: 'operation', value: 'gusto_rehire_employee' },
    },
    {
      id: 'employmentStatus',
      title: 'Employment Status',
      type: 'dropdown',
      options: [
        { label: 'Full Time', id: 'full_time' },
        { label: 'Part Time', id: 'part_time' },
        { label: 'Part Time Eligible', id: 'part_time_eligible' },
        { label: 'Variable', id: 'variable' },
        { label: 'Seasonal', id: 'seasonal' },
        { label: 'Not Set', id: 'not_set' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_rehire_employee' },
    },
    {
      id: 'checkDate',
      title: 'Check Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'offCycleReason',
      title: 'Off-Cycle Reason',
      type: 'dropdown',
      options: [
        { label: 'Benefit reversal', id: 'Benefit reversal' },
        { label: 'Bonus', id: 'Bonus' },
        { label: 'Correction', id: 'Correction' },
        { label: 'Disability insurance distribution', id: 'Disability insurance distribution' },
        { label: 'Dismissed employee', id: 'Dismissed employee' },
        { label: 'Hired employee', id: 'Hired employee' },
        { label: 'Reversal', id: 'Reversal' },
        { label: 'Tax reconciliation', id: 'Tax reconciliation' },
        { label: 'Transition from old pay schedule', id: 'Transition from old pay schedule' },
        { label: 'Wage correction', id: 'Wage correction' },
      ],
      required: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'payScheduleUuid',
      title: 'Pay Schedule UUID',
      type: 'short-input',
      placeholder: 'Pay schedule to associate (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'fixedWithholdingRate',
      title: 'Fixed Withholding Rate',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'employeeUuids',
      title: 'Employee UUIDs',
      type: 'short-input',
      placeholder: 'Comma-separated employee UUIDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'withholdingPayPeriod',
      title: 'Withholding Pay Period',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'skipRegularDeductions',
      title: 'Skip Regular Deductions',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_off_cycle_payroll' },
    },
    {
      id: 'contractorUuid',
      title: 'Contractor UUID',
      type: 'short-input',
      placeholder: 'Contractor UUID to pay',
      required: { field: 'operation', value: 'gusto_create_contractor_payment' },
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'date',
      title: 'Payment Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: { field: 'operation', value: 'gusto_create_contractor_payment' },
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'wage',
      title: 'Wage',
      type: 'short-input',
      placeholder: 'Fixed wage amount',
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'hours',
      title: 'Hours',
      type: 'short-input',
      placeholder: 'Hours worked',
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'bonus',
      title: 'Bonus',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'reimbursement',
      title: 'Reimbursement',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'paymentMethod',
      title: 'Payment Method',
      type: 'dropdown',
      options: [
        { label: 'Direct Deposit', id: 'Direct Deposit' },
        { label: 'Check', id: 'Check' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_create_contractor_payment' },
    },
    {
      id: 'timeOffType',
      title: 'Time Off Type',
      type: 'dropdown',
      options: [
        { label: 'Vacation', id: 'vacation' },
        { label: 'Sick', id: 'sick' },
      ],
      required: { field: 'operation', value: 'gusto_list_employee_time_off_activities' },
      condition: { field: 'operation', value: 'gusto_list_employee_time_off_activities' },
    },
    {
      id: 'title',
      title: 'Department Title',
      type: 'short-input',
      placeholder: 'Department title',
      required: { field: 'operation', value: 'gusto_create_department' },
      condition: { field: 'operation', value: 'gusto_create_department' },
    },
    {
      id: 'include',
      title: 'Include',
      type: 'short-input',
      placeholder: 'taxes,benefits,deductions',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_get_payroll' },
    },
    {
      id: 'terminated',
      title: 'Terminated Only',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_list_employees' },
    },
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Filter contractors by search term',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_list_contractors' },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'gusto_list_employees',
          'gusto_list_pay_stubs',
          'gusto_list_contractors',
          'gusto_list_contractor_payments',
        ],
      },
    },
    {
      id: 'per',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Items per page',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'gusto_list_employees',
          'gusto_list_pay_stubs',
          'gusto_list_contractors',
          'gusto_list_contractor_payments',
        ],
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: {
        field: 'operation',
        value: [
          'gusto_create_off_cycle_payroll',
          'gusto_list_contractor_payments',
          'gusto_create_contractor',
        ],
      },
      condition: { field: 'operation', value: [...START_DATE_OPS] },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      required: {
        field: 'operation',
        value: ['gusto_create_off_cycle_payroll', 'gusto_list_contractor_payments'],
      },
      condition: { field: 'operation', value: [...START_END_DATE_OPS] },
    },
    {
      id: 'processingStatuses',
      title: 'Processing Statuses',
      type: 'short-input',
      placeholder: 'processed,unprocessed',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_list_payrolls' },
    },
    {
      id: 'payrollTypes',
      title: 'Payroll Types',
      type: 'short-input',
      placeholder: 'regular,off_cycle',
      mode: 'advanced',
      condition: { field: 'operation', value: 'gusto_list_payrolls' },
    },
  ],
  tools: {
    access: [
      'gusto_get_company',
      'gusto_list_employees',
      'gusto_get_employee',
      'gusto_create_employee',
      'gusto_update_employee',
      'gusto_terminate_employee',
      'gusto_rehire_employee',
      'gusto_list_employee_jobs',
      'gusto_list_pay_stubs',
      'gusto_get_employee_onboarding_status',
      'gusto_list_contractors',
      'gusto_get_contractor',
      'gusto_create_contractor',
      'gusto_update_contractor',
      'gusto_list_payrolls',
      'gusto_get_payroll',
      'gusto_create_off_cycle_payroll',
      'gusto_calculate_payroll',
      'gusto_submit_payroll',
      'gusto_cancel_payroll',
      'gusto_list_contractor_payments',
      'gusto_get_contractor_payment',
      'gusto_create_contractor_payment',
      'gusto_list_employee_time_off_activities',
      'gusto_list_pay_schedules',
      'gusto_list_locations',
      'gusto_list_departments',
      'gusto_create_department',
      'gusto_list_company_benefits',
      'gusto_list_employee_benefits',
      'gusto_list_employee_forms',
      'gusto_list_contractor_forms',
    ],
    config: {
      tool: (params) => params.operation || 'gusto_list_employees',
      params: (params) => {
        const base: Record<string, any> = { oauthCredential: params.oauthCredential }
        const op = params.operation as string
        const trimmed = (v: unknown) =>
          typeof v === 'string' ? v.trim() || undefined : (v as undefined)

        switch (op) {
          case 'gusto_get_company':
          case 'gusto_list_pay_schedules':
          case 'gusto_list_locations':
          case 'gusto_list_departments':
          case 'gusto_list_company_benefits':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            return { ...base, companyId: params.companyId.trim() }

          case 'gusto_list_employees':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              terminated: params.terminated,
              page: params.page ? Number(params.page) : undefined,
              per: params.per ? Number(params.per) : undefined,
            }

          case 'gusto_get_employee':
          case 'gusto_list_employee_jobs':
          case 'gusto_get_employee_onboarding_status':
          case 'gusto_list_employee_benefits':
          case 'gusto_list_employee_forms':
            if (!params.employeeId?.trim()) throw new Error('Employee ID is required.')
            return { ...base, employeeId: params.employeeId.trim() }

          case 'gusto_create_employee':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.firstName?.trim() || !params.lastName?.trim()) {
              throw new Error('First name and last name are required.')
            }
            return {
              ...base,
              companyId: params.companyId.trim(),
              firstName: params.firstName.trim(),
              lastName: params.lastName.trim(),
              email: trimmed(params.email),
              middleInitial: trimmed(params.middleInitial),
              dateOfBirth: trimmed(params.dateOfBirth),
              ssn: trimmed(params.ssn),
              selfOnboarding: params.selfOnboarding,
            }

          case 'gusto_update_employee':
            if (!params.employeeId?.trim()) throw new Error('Employee ID is required.')
            if (!params.version?.trim()) throw new Error('Version is required.')
            return {
              ...base,
              employeeId: params.employeeId.trim(),
              version: params.version.trim(),
              firstName: trimmed(params.firstName),
              lastName: trimmed(params.lastName),
              middleInitial: trimmed(params.middleInitial),
              email: trimmed(params.email),
              dateOfBirth: trimmed(params.dateOfBirth),
              ssn: trimmed(params.ssn),
              preferredFirstName: trimmed(params.preferredFirstName),
              twoPercentShareholder: params.twoPercentShareholder,
            }

          case 'gusto_terminate_employee':
            if (!params.employeeId?.trim()) throw new Error('Employee ID is required.')
            if (!params.effectiveDate?.trim()) throw new Error('Effective date is required.')
            return {
              ...base,
              employeeId: params.employeeId.trim(),
              effectiveDate: params.effectiveDate.trim(),
              runTerminationPayroll: params.runTerminationPayroll,
            }

          case 'gusto_rehire_employee':
            if (!params.employeeId?.trim()) throw new Error('Employee ID is required.')
            if (!params.effectiveDate?.trim()) throw new Error('Effective date is required.')
            if (!params.workLocationUuid?.trim()) {
              throw new Error('Work location UUID is required.')
            }
            if (params.fileNewHireReport === undefined || params.fileNewHireReport === null) {
              throw new Error('File new hire report is required.')
            }
            return {
              ...base,
              employeeId: params.employeeId.trim(),
              effectiveDate: params.effectiveDate.trim(),
              fileNewHireReport: params.fileNewHireReport,
              workLocationUuid: params.workLocationUuid.trim(),
              employmentStatus: trimmed(params.employmentStatus),
              twoPercentShareholder: params.twoPercentShareholder,
            }

          case 'gusto_list_pay_stubs':
            if (!params.employeeId?.trim()) throw new Error('Employee ID is required.')
            return {
              ...base,
              employeeId: params.employeeId.trim(),
              page: params.page ? Number(params.page) : undefined,
              per: params.per ? Number(params.per) : undefined,
            }

          case 'gusto_list_contractors':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              searchTerm: trimmed(params.searchTerm),
              page: params.page ? Number(params.page) : undefined,
              per: params.per ? Number(params.per) : undefined,
            }

          case 'gusto_get_contractor':
          case 'gusto_list_contractor_forms':
            if (!params.contractorId?.trim()) throw new Error('Contractor ID is required.')
            return { ...base, contractorId: params.contractorId.trim() }

          case 'gusto_create_contractor': {
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.type) throw new Error('Contractor type is required.')
            if (!params.wageType) throw new Error('Wage type is required.')
            if (!params.startDate?.trim()) throw new Error('Start date is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              type: params.type,
              wageType: params.wageType,
              startDate: params.startDate.trim(),
              firstName: trimmed(params.firstName),
              lastName: trimmed(params.lastName),
              middleInitial: trimmed(params.middleInitial),
              businessName: trimmed(params.businessName),
              email: trimmed(params.email),
              selfOnboarding: params.selfOnboarding,
              ein: trimmed(params.ein),
              hourlyRate: trimmed(params.hourlyRate),
            }
          }

          case 'gusto_update_contractor':
            if (!params.contractorId?.trim()) throw new Error('Contractor ID is required.')
            if (!params.version?.trim()) throw new Error('Version is required.')
            return {
              ...base,
              contractorId: params.contractorId.trim(),
              version: params.version.trim(),
              firstName: trimmed(params.firstName),
              lastName: trimmed(params.lastName),
              middleInitial: trimmed(params.middleInitial),
              businessName: trimmed(params.businessName),
              email: trimmed(params.email),
              startDate: trimmed(params.startDate),
              hourlyRate: trimmed(params.hourlyRate),
              wageType: trimmed(params.wageType),
              ein: trimmed(params.ein),
            }

          case 'gusto_list_payrolls':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              startDate: trimmed(params.startDate),
              endDate: trimmed(params.endDate),
              processingStatuses: trimmed(params.processingStatuses),
              payrollTypes: trimmed(params.payrollTypes),
            }

          case 'gusto_get_payroll':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.payrollId?.trim()) throw new Error('Payroll ID is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              payrollId: params.payrollId.trim(),
              include: trimmed(params.include),
            }

          case 'gusto_create_off_cycle_payroll':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.startDate?.trim() || !params.endDate?.trim()) {
              throw new Error('Start date and end date are required.')
            }
            if (!params.offCycleReason?.trim()) {
              throw new Error('Off-cycle reason is required.')
            }
            return {
              ...base,
              companyId: params.companyId.trim(),
              startDate: params.startDate.trim(),
              endDate: params.endDate.trim(),
              checkDate: trimmed(params.checkDate),
              offCycleReason: params.offCycleReason.trim(),
              payScheduleUuid: trimmed(params.payScheduleUuid),
              fixedWithholdingRate: params.fixedWithholdingRate,
              employeeUuids: trimmed(params.employeeUuids),
              withholdingPayPeriod: trimmed(params.withholdingPayPeriod),
              skipRegularDeductions: params.skipRegularDeductions,
            }

          case 'gusto_calculate_payroll':
          case 'gusto_submit_payroll':
          case 'gusto_cancel_payroll':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.payrollId?.trim()) throw new Error('Payroll ID is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              payrollId: params.payrollId.trim(),
            }

          case 'gusto_list_contractor_payments':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.startDate?.trim()) throw new Error('Start date is required.')
            if (!params.endDate?.trim()) throw new Error('End date is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              startDate: params.startDate.trim(),
              endDate: params.endDate.trim(),
              page: params.page ? Number(params.page) : undefined,
              per: params.per ? Number(params.per) : undefined,
            }

          case 'gusto_get_contractor_payment':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.contractorPaymentId?.trim()) {
              throw new Error('Contractor payment ID is required.')
            }
            return {
              ...base,
              companyId: params.companyId.trim(),
              contractorPaymentId: params.contractorPaymentId.trim(),
            }

          case 'gusto_create_contractor_payment':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.contractorUuid?.trim()) throw new Error('Contractor UUID is required.')
            if (!params.date?.trim()) throw new Error('Date is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              contractorUuid: params.contractorUuid.trim(),
              date: params.date.trim(),
              wage:
                params.wage !== undefined && params.wage !== '' ? Number(params.wage) : undefined,
              hours:
                params.hours !== undefined && params.hours !== ''
                  ? Number(params.hours)
                  : undefined,
              bonus:
                params.bonus !== undefined && params.bonus !== ''
                  ? Number(params.bonus)
                  : undefined,
              reimbursement:
                params.reimbursement !== undefined && params.reimbursement !== ''
                  ? Number(params.reimbursement)
                  : undefined,
              paymentMethod: trimmed(params.paymentMethod),
            }

          case 'gusto_list_employee_time_off_activities':
            if (!params.employeeId?.trim()) throw new Error('Employee ID is required.')
            if (!params.timeOffType?.trim()) throw new Error('Time off type is required.')
            return {
              ...base,
              employeeId: params.employeeId.trim(),
              timeOffType: params.timeOffType.trim(),
            }

          case 'gusto_create_department':
            if (!params.companyId?.trim()) throw new Error('Company ID is required.')
            if (!params.title?.trim()) throw new Error('Department title is required.')
            return {
              ...base,
              companyId: params.companyId.trim(),
              title: params.title.trim(),
            }

          default:
            return base
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Gusto OAuth credential' },
    companyId: { type: 'string', description: 'Gusto company UUID' },
    employeeId: { type: 'string', description: 'Gusto employee UUID' },
    contractorId: { type: 'string', description: 'Gusto contractor UUID' },
    payrollId: { type: 'string', description: 'Gusto payroll UUID' },
    contractorPaymentId: { type: 'string', description: 'Contractor payment UUID' },
    version: { type: 'string', description: 'Record version (for updates)' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    email: { type: 'string', description: 'Email address' },
    middleInitial: { type: 'string', description: 'Middle initial' },
    dateOfBirth: { type: 'string', description: 'Date of birth (YYYY-MM-DD)' },
    ssn: { type: 'string', description: 'Social security number' },
    preferredFirstName: { type: 'string', description: 'Preferred first name' },
    twoPercentShareholder: {
      type: 'boolean',
      description: 'Whether the employee is a 2% shareholder',
    },
    selfOnboarding: { type: 'boolean', description: 'Send self-onboarding invite' },
    type: { type: 'string', description: 'Contractor type (Individual or Business)' },
    wageType: { type: 'string', description: 'Wage type (Fixed or Hourly)' },
    businessName: { type: 'string', description: 'Business name' },
    ein: { type: 'string', description: 'Employer Identification Number' },
    hourlyRate: { type: 'string', description: 'Hourly rate' },
    effectiveDate: { type: 'string', description: 'Effective date (YYYY-MM-DD)' },
    runTerminationPayroll: { type: 'boolean', description: 'Run a termination payroll' },
    fileNewHireReport: { type: 'boolean', description: 'File a new hire report' },
    workLocationUuid: { type: 'string', description: 'Work location UUID' },
    employmentStatus: { type: 'string', description: 'Employment status' },
    checkDate: { type: 'string', description: 'Check date (YYYY-MM-DD)' },
    payScheduleUuid: { type: 'string', description: 'Pay schedule UUID for off-cycle payroll' },
    fixedWithholdingRate: {
      type: 'boolean',
      description: 'Use fixed supplemental withholding rate',
    },
    offCycleReason: { type: 'string', description: 'Off-cycle payroll reason' },
    employeeUuids: { type: 'string', description: 'Comma-separated employee UUIDs' },
    withholdingPayPeriod: { type: 'string', description: 'Withholding pay period override' },
    skipRegularDeductions: { type: 'boolean', description: 'Skip regular deductions' },
    contractorUuid: { type: 'string', description: 'Contractor UUID' },
    date: { type: 'string', description: 'Payment date (YYYY-MM-DD)' },
    wage: { type: 'number', description: 'Wage amount' },
    hours: { type: 'number', description: 'Hours worked' },
    bonus: { type: 'number', description: 'Bonus amount' },
    reimbursement: { type: 'number', description: 'Reimbursement amount' },
    paymentMethod: { type: 'string', description: 'Payment method' },
    timeOffType: { type: 'string', description: 'Time off type (e.g. vacation or sick)' },
    title: { type: 'string', description: 'Department title' },
    include: { type: 'string', description: 'Comma-separated include fields for payroll detail' },
    terminated: { type: 'boolean', description: 'Filter for terminated employees' },
    searchTerm: { type: 'string', description: 'Search term for contractors' },
    page: { type: 'number', description: 'Pagination page number' },
    per: { type: 'number', description: 'Items per page' },
    startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
    endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
    processingStatuses: { type: 'string', description: 'Comma-separated processing statuses' },
    payrollTypes: { type: 'string', description: 'Comma-separated payroll types' },
  },
  outputs: {
    company: { type: 'json', description: 'Gusto company (uuid, name, ein, entity_type, ...)' },
    employee: { type: 'json', description: 'Gusto employee record' },
    employees: { type: 'json', description: 'List of employees' },
    contractor: { type: 'json', description: 'Gusto contractor record' },
    contractors: { type: 'json', description: 'List of contractors' },
    payroll: { type: 'json', description: 'Gusto payroll' },
    payrolls: { type: 'json', description: 'List of payrolls' },
    contractorPayment: { type: 'json', description: 'Contractor payment' },
    contractorPayments: { type: 'json', description: 'List of contractor payments' },
    timeOffActivities: { type: 'json', description: 'Time off activities' },
    paySchedules: { type: 'json', description: 'List of pay schedules' },
    locations: { type: 'json', description: 'List of locations' },
    department: { type: 'json', description: 'Department record' },
    departments: { type: 'json', description: 'List of departments' },
    companyBenefits: { type: 'json', description: 'Company benefits' },
    employeeBenefits: { type: 'json', description: 'Employee benefits' },
    forms: { type: 'json', description: 'Forms (W-2, 1099, etc.)' },
    jobs: { type: 'json', description: 'Employee jobs' },
    payStubs: { type: 'json', description: 'Pay stubs' },
    onboardingStatus: { type: 'json', description: 'Employee onboarding status' },
    termination: { type: 'json', description: 'Termination record' },
    rehire: { type: 'json', description: 'Rehire record' },
  },
}
