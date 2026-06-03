import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Gusto API responses.
 * Fields based on Gusto Embedded Payroll API.
 */

export const COMPANY_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Company UUID' },
  name: { type: 'string', description: 'Legal entity name' },
  trade_name: { type: 'string', description: 'Trade name', optional: true },
  ein: { type: 'string', description: 'Federal Employer Identification Number', optional: true },
  entity_type: {
    type: 'string',
    description: 'Entity type (LLC, Corporation, etc.)',
    optional: true,
  },
  company_status: {
    type: 'string',
    description: 'Company status (Approved, Not Approved, Suspended)',
    optional: true,
  },
  locations: { type: 'array', description: 'Company locations', optional: true },
  compensations: { type: 'object', description: 'Compensation classifications', optional: true },
  primary_signatory: { type: 'object', description: 'Primary signatory', optional: true },
  primary_payroll_admin: { type: 'object', description: 'Primary payroll admin', optional: true },
  tier: { type: 'string', description: 'Company tier', optional: true },
} as const satisfies Record<string, OutputProperty>

export const EMPLOYEE_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Employee UUID' },
  first_name: { type: 'string', description: 'First name' },
  middle_initial: { type: 'string', description: 'Middle initial', optional: true },
  last_name: { type: 'string', description: 'Last name' },
  preferred_first_name: { type: 'string', description: 'Preferred first name', optional: true },
  email: { type: 'string', description: 'Personal email', optional: true },
  company_uuid: { type: 'string', description: 'Company UUID' },
  manager_uuid: { type: 'string', description: 'Manager UUID', optional: true },
  department: { type: 'string', description: 'Department name', optional: true },
  department_uuid: { type: 'string', description: 'Department UUID', optional: true },
  date_of_birth: { type: 'string', description: 'Date of birth', optional: true },
  has_ssn: { type: 'boolean', description: 'Whether SSN is on file', optional: true },
  ssn: { type: 'string', description: 'Social security number (masked)', optional: true },
  phone: { type: 'string', description: 'Phone number', optional: true },
  terminated: { type: 'boolean', description: 'Whether the employee is terminated' },
  terminations: { type: 'array', description: 'Termination records', optional: true },
  onboarded: { type: 'boolean', description: 'Whether the employee is onboarded' },
  onboarding_status: { type: 'string', description: 'Onboarding status', optional: true },
  jobs: { type: 'array', description: 'Employee jobs', optional: true },
  version: { type: 'string', description: 'Record version', optional: true },
} as const satisfies Record<string, OutputProperty>

export const CONTRACTOR_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Contractor UUID' },
  type: { type: 'string', description: 'Contractor type (Individual or Business)' },
  wage_type: { type: 'string', description: 'Wage type (Fixed or Hourly)' },
  is_active: { type: 'boolean', description: 'Whether the contractor is active' },
  first_name: { type: 'string', description: 'First name', optional: true },
  last_name: { type: 'string', description: 'Last name', optional: true },
  business_name: { type: 'string', description: 'Business name', optional: true },
  email: { type: 'string', description: 'Email address', optional: true },
  start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)', optional: true },
  hourly_rate: { type: 'string', description: 'Hourly rate', optional: true },
  company_uuid: { type: 'string', description: 'Company UUID' },
} as const satisfies Record<string, OutputProperty>

export const PAYROLL_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Payroll UUID' },
  payroll_uuid: { type: 'string', description: 'Payroll UUID (legacy alias)', optional: true },
  company_uuid: { type: 'string', description: 'Company UUID', optional: true },
  payroll_deadline: { type: 'string', description: 'Payroll submission deadline', optional: true },
  check_date: { type: 'string', description: 'Check date', optional: true },
  processed: { type: 'boolean', description: 'Whether the payroll has been processed' },
  processed_date: {
    type: 'string',
    description: 'Date the payroll was processed',
    optional: true,
  },
  calculated_at: { type: 'string', description: 'When the payroll was calculated', optional: true },
  off_cycle: { type: 'boolean', description: 'Whether this is an off-cycle payroll' },
  off_cycle_reason: { type: 'string', description: 'Off-cycle payroll reason', optional: true },
  external: { type: 'boolean', description: 'Whether this is an external payroll', optional: true },
  auto_pilot: { type: 'boolean', description: 'Whether autopilot is enabled', optional: true },
  pay_period: { type: 'object', description: 'Pay period details', optional: true },
  totals: { type: 'object', description: 'Payroll totals', optional: true },
  payroll_status_meta: {
    type: 'object',
    description: 'Status metadata (cancellable, expected_check_date, etc.)',
    optional: true,
  },
  employee_compensations: {
    type: 'array',
    description: 'Per-employee compensation breakdown',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PAY_SCHEDULE_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Pay schedule UUID', optional: true },
  frequency: { type: 'string', description: 'Pay frequency', optional: true },
  anchor_pay_date: { type: 'string', description: 'Anchor pay date', optional: true },
  anchor_end_of_pay_period: {
    type: 'string',
    description: 'Anchor end of pay period',
    optional: true,
  },
  day_1: { type: 'number', description: 'First pay day of period (semimonthly)', optional: true },
  day_2: { type: 'number', description: 'Second pay day of period (semimonthly)', optional: true },
  name: { type: 'string', description: 'Pay schedule name', optional: true },
  auto_pilot: { type: 'boolean', description: 'Whether autopilot is enabled', optional: true },
  active: { type: 'boolean', description: 'Whether the schedule is active', optional: true },
  custom_name: { type: 'string', description: 'Custom name', optional: true },
  version: { type: 'string', description: 'Record version', optional: true },
} as const satisfies Record<string, OutputProperty>

export const DEPARTMENT_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Department UUID', optional: true },
  title: { type: 'string', description: 'Department title', optional: true },
  company_uuid: { type: 'string', description: 'Company UUID', optional: true },
  version: { type: 'string', description: 'Record version', optional: true },
  employees: {
    type: 'array',
    description: 'Employees in the department',
    optional: true,
  },
  contractors: {
    type: 'array',
    description: 'Contractors in the department',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const JOB_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Job UUID' },
  employee_uuid: { type: 'string', description: 'Employee UUID' },
  title: { type: 'string', description: 'Job title', optional: true },
  hire_date: { type: 'string', description: 'Hire date (YYYY-MM-DD)', optional: true },
  primary: { type: 'boolean', description: 'Whether this is the primary job', optional: true },
  current_compensation_uuid: {
    type: 'string',
    description: 'Current compensation UUID',
    optional: true,
  },
  rate: { type: 'string', description: 'Pay rate', optional: true },
  payment_unit: { type: 'string', description: 'Payment unit', optional: true },
  compensations: { type: 'array', description: 'Job compensation history', optional: true },
  state_wc_covered: {
    type: 'boolean',
    description: "Whether the job is covered by state workers' comp",
    optional: true,
  },
  state_wc_class_code: {
    type: 'string',
    description: "State workers' comp class code",
    optional: true,
  },
  two_percent_shareholder: {
    type: 'boolean',
    description: 'Whether this job is for a 2% shareholder',
    optional: true,
  },
  version: { type: 'string', description: 'Record version', optional: true },
} as const satisfies Record<string, OutputProperty>

export const PAY_STUB_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Pay stub identifier' },
  payroll_uuid: { type: 'string', description: 'Payroll UUID', optional: true },
  check_date: { type: 'string', description: 'Check date', optional: true },
  gross_pay: { type: 'string', description: 'Gross pay amount', optional: true },
  net_pay: { type: 'string', description: 'Net pay amount', optional: true },
  check_amount: { type: 'string', description: 'Check amount', optional: true },
} as const satisfies Record<string, OutputProperty>

export const TIME_OFF_ACTIVITY_OUTPUT_PROPERTIES = {
  policy_uuid: { type: 'string', description: 'Time off policy UUID', optional: true },
  time_off_type: {
    type: 'string',
    description: 'Time off type (vacation or sick)',
    optional: true,
  },
  policy_name: { type: 'string', description: 'Time off policy name', optional: true },
  event_type: { type: 'string', description: 'Type of the time off event', optional: true },
  event_description: { type: 'string', description: 'Event description', optional: true },
  effective_time: { type: 'string', description: 'Datetime of the activity', optional: true },
  balance: { type: 'string', description: 'Balance at the time of the activity', optional: true },
  balance_change: { type: 'string', description: 'Balance change amount', optional: true },
} as const satisfies Record<string, OutputProperty>

export const CONTRACTOR_PAYMENT_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Contractor payment UUID' },
  contractor_uuid: { type: 'string', description: 'Contractor UUID' },
  bonus: { type: 'string', description: 'Bonus amount', optional: true },
  date: { type: 'string', description: 'Payment date (YYYY-MM-DD)', optional: true },
  hours: { type: 'string', description: 'Hours worked', optional: true },
  reimbursement: { type: 'string', description: 'Reimbursement amount', optional: true },
  wage: { type: 'string', description: 'Fixed wage amount', optional: true },
  wage_type: { type: 'string', description: 'Wage type (Fixed or Hourly)', optional: true },
  wage_total: { type: 'string', description: 'Total wage amount', optional: true },
  payment_method: { type: 'string', description: 'Payment method', optional: true },
  status: { type: 'string', description: 'Payment status', optional: true },
  may_cancel: {
    type: 'boolean',
    description: 'Whether the payment may be canceled',
    optional: true,
  },
  check_number: { type: 'string', description: 'Check number', optional: true },
  debit_date: { type: 'string', description: 'Date funds will be debited', optional: true },
} as const satisfies Record<string, OutputProperty>

export const COMPANY_BENEFIT_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Company benefit UUID' },
  company_uuid: { type: 'string', description: 'Company UUID', optional: true },
  benefit_type: { type: 'number', description: 'Benefit type ID', optional: true },
  active: { type: 'boolean', description: 'Whether active', optional: true },
  description: { type: 'string', description: 'Benefit description', optional: true },
  source: { type: 'string', description: 'Benefit source (Gusto, partner, etc.)', optional: true },
  partner_name: { type: 'string', description: 'Partner name (if external)', optional: true },
  enrollment_count: {
    type: 'number',
    description: 'Number of employees enrolled',
    optional: true,
  },
  deletable: { type: 'boolean', description: 'Whether the benefit can be deleted', optional: true },
  responsible_for_employer_taxes: {
    type: 'boolean',
    description: 'Whether company is responsible for employer taxes',
    optional: true,
  },
  responsible_for_employee_w2: {
    type: 'boolean',
    description: 'Whether benefit appears on employee W2',
    optional: true,
  },
  supports_percentage_amounts: {
    type: 'boolean',
    description: 'Whether the benefit supports percentage-based amounts',
    optional: true,
  },
  version: { type: 'string', description: 'Record version', optional: true },
} as const satisfies Record<string, OutputProperty>

export const EMPLOYEE_BENEFIT_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Employee benefit UUID' },
  employee_uuid: { type: 'string', description: 'Employee UUID' },
  company_benefit_uuid: { type: 'string', description: 'Company benefit UUID' },
  active: { type: 'boolean', description: 'Whether active', optional: true },
  employee_deduction: { type: 'string', description: 'Employee deduction', optional: true },
  company_contribution: { type: 'string', description: 'Company contribution', optional: true },
  employee_deduction_annual_maximum: {
    type: 'string',
    description: 'Annual maximum employee deduction',
    optional: true,
  },
  company_contribution_annual_maximum: {
    type: 'string',
    description: 'Annual maximum company contribution',
    optional: true,
  },
  deduct_as_percentage: {
    type: 'boolean',
    description: 'Whether deduction is calculated as a percentage',
    optional: true,
  },
  contribute_as_percentage: {
    type: 'boolean',
    description: 'Whether contribution is calculated as a percentage',
    optional: true,
  },
  contribution: { type: 'object', description: 'Contribution config', optional: true },
  elective: { type: 'boolean', description: 'Whether the benefit is elective', optional: true },
  catch_up: {
    type: 'boolean',
    description: 'Whether catch-up contributions apply',
    optional: true,
  },
  coverage_amount: { type: 'string', description: 'Coverage amount', optional: true },
  coverage_salary_multiplier: {
    type: 'string',
    description: 'Coverage as a multiplier of salary',
    optional: true,
  },
  deduction_reduces_taxable_income: {
    type: 'string',
    description: 'Whether deduction reduces taxable income (unset, true, false)',
    optional: true,
  },
  deduction_type: { type: 'string', description: 'Deduction type', optional: true },
  version: { type: 'string', description: 'Record version', optional: true },
} as const satisfies Record<string, OutputProperty>

export const FORM_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Form UUID' },
  name: { type: 'string', description: 'Form name', optional: true },
  title: { type: 'string', description: 'Form title', optional: true },
  description: { type: 'string', description: 'Form description', optional: true },
  year: { type: 'number', description: 'Tax year', optional: true },
  quarter: { type: 'number', description: 'Quarter', optional: true },
  requires_signing: {
    type: 'boolean',
    description: 'Whether the form requires signing',
    optional: true,
  },
  draft: { type: 'boolean', description: 'Whether the form is a draft', optional: true },
  document_content_type: {
    type: 'string',
    description: 'Form document MIME type',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ONBOARDING_STATUS_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Employee UUID', optional: true },
  onboarding_status: { type: 'string', description: 'Onboarding status' },
  onboarding_steps: {
    type: 'array',
    description: 'Onboarding step details',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const TERMINATION_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Termination UUID' },
  employee_uuid: { type: 'string', description: 'Employee UUID' },
  active: { type: 'boolean', description: 'Whether the termination is active', optional: true },
  effective_date: {
    type: 'string',
    description: 'Effective date (YYYY-MM-DD)',
    optional: true,
  },
  run_termination_payroll: {
    type: 'boolean',
    description: 'Whether to run a termination payroll',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const REHIRE_OUTPUT_PROPERTIES = {
  employee_uuid: { type: 'string', description: 'Employee UUID' },
  effective_date: { type: 'string', description: 'Effective date (YYYY-MM-DD)', optional: true },
  work_location_uuid: {
    type: 'string',
    description: 'Work location UUID',
    optional: true,
  },
  file_new_hire_report: {
    type: 'boolean',
    description: 'Whether to file a new hire report',
    optional: true,
  },
  employment_status: {
    type: 'string',
    description: 'Employment status',
    optional: true,
  },
  two_percent_shareholder: {
    type: 'boolean',
    description: 'Whether the employee is a 2% shareholder',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const LOCATION_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Location UUID' },
  street_1: { type: 'string', description: 'Street address line 1' },
  street_2: { type: 'string', description: 'Street address line 2', optional: true },
  city: { type: 'string', description: 'City' },
  state: { type: 'string', description: 'State' },
  zip: { type: 'string', description: 'ZIP code' },
  country: { type: 'string', description: 'Country' },
  phone_number: { type: 'string', description: 'Phone number', optional: true },
  mailing_address: { type: 'boolean', description: 'Whether this is the mailing address' },
  filing_address: { type: 'boolean', description: 'Whether this is the filing address' },
  active: { type: 'boolean', description: 'Whether the location is active' },
} as const satisfies Record<string, OutputProperty>

/* ========== Param Types ========== */

export interface GustoGetCompanyParams {
  companyId: string
  accessToken?: string
}

export interface GustoListEmployeesParams {
  companyId: string
  terminated?: boolean
  page?: number
  per?: number
  accessToken?: string
}

export interface GustoGetEmployeeParams {
  employeeId: string
  accessToken?: string
}

export interface GustoCreateEmployeeParams {
  companyId: string
  firstName: string
  lastName: string
  email?: string
  middleInitial?: string
  dateOfBirth?: string
  ssn?: string
  selfOnboarding?: boolean
  accessToken?: string
}

export interface GustoListContractorsParams {
  companyId: string
  searchTerm?: string
  page?: number
  per?: number
  accessToken?: string
}

export interface GustoListPayrollsParams {
  companyId: string
  startDate?: string
  endDate?: string
  processingStatuses?: string
  payrollTypes?: string
  accessToken?: string
}

export interface GustoGetPayrollParams {
  companyId: string
  payrollId: string
  include?: string
  accessToken?: string
}

export interface GustoListPaySchedulesParams {
  companyId: string
  accessToken?: string
}

export interface GustoListLocationsParams {
  companyId: string
  accessToken?: string
}

/* ========== Response Types ========== */

export interface GustoGetCompanyResponse extends ToolResponse {
  output: {
    company?: Record<string, unknown>
  }
}

export interface GustoListEmployeesResponse extends ToolResponse {
  output: {
    employees?: Record<string, unknown>[]
  }
}

export interface GustoGetEmployeeResponse extends ToolResponse {
  output: {
    employee?: Record<string, unknown>
  }
}

export interface GustoCreateEmployeeResponse extends ToolResponse {
  output: {
    employee?: Record<string, unknown>
  }
}

export interface GustoListContractorsResponse extends ToolResponse {
  output: {
    contractors?: Record<string, unknown>[]
  }
}

export interface GustoListPayrollsResponse extends ToolResponse {
  output: {
    payrolls?: Record<string, unknown>[]
  }
}

export interface GustoGetPayrollResponse extends ToolResponse {
  output: {
    payroll?: Record<string, unknown>
  }
}

export interface GustoListPaySchedulesResponse extends ToolResponse {
  output: {
    paySchedules?: Record<string, unknown>[]
  }
}

export interface GustoListLocationsResponse extends ToolResponse {
  output: {
    locations?: Record<string, unknown>[]
  }
}

/* ========== New Param Types ========== */

export interface GustoUpdateEmployeeParams {
  employeeId: string
  version: string
  firstName?: string
  lastName?: string
  middleInitial?: string
  email?: string
  dateOfBirth?: string
  ssn?: string
  preferredFirstName?: string
  twoPercentShareholder?: boolean
  accessToken?: string
}

export interface GustoTerminateEmployeeParams {
  employeeId: string
  effectiveDate: string
  runTerminationPayroll?: boolean
  accessToken?: string
}

export interface GustoRehireEmployeeParams {
  employeeId: string
  effectiveDate: string
  fileNewHireReport: boolean
  workLocationUuid: string
  employmentStatus?: string
  twoPercentShareholder?: boolean
  accessToken?: string
}

export interface GustoListEmployeeJobsParams {
  employeeId: string
  accessToken?: string
}

export interface GustoListPayStubsParams {
  employeeId: string
  page?: number
  per?: number
  accessToken?: string
}

export interface GustoGetEmployeeOnboardingStatusParams {
  employeeId: string
  accessToken?: string
}

export interface GustoCreateContractorParams {
  companyId: string
  type: 'Individual' | 'Business'
  wageType: 'Fixed' | 'Hourly'
  startDate: string
  firstName?: string
  lastName?: string
  middleInitial?: string
  businessName?: string
  email?: string
  selfOnboarding?: boolean
  ein?: string
  hourlyRate?: string
  accessToken?: string
}

export interface GustoGetContractorParams {
  contractorId: string
  accessToken?: string
}

export interface GustoUpdateContractorParams {
  contractorId: string
  version: string
  firstName?: string
  lastName?: string
  middleInitial?: string
  businessName?: string
  email?: string
  startDate?: string
  hourlyRate?: string
  wageType?: 'Fixed' | 'Hourly'
  ein?: string
  accessToken?: string
}

export interface GustoCreateOffCyclePayrollParams {
  companyId: string
  startDate: string
  endDate: string
  offCycleReason: string
  checkDate?: string
  payScheduleUuid?: string
  fixedWithholdingRate?: boolean
  employeeUuids?: string
  withholdingPayPeriod?: string
  skipRegularDeductions?: boolean
  accessToken?: string
}

export interface GustoCalculatePayrollParams {
  companyId: string
  payrollId: string
  accessToken?: string
}

export interface GustoSubmitPayrollParams {
  companyId: string
  payrollId: string
  accessToken?: string
}

export interface GustoCancelPayrollParams {
  companyId: string
  payrollId: string
  accessToken?: string
}

export interface GustoListContractorPaymentsParams {
  companyId: string
  startDate: string
  endDate: string
  page?: number
  per?: number
  accessToken?: string
}

export interface GustoGetContractorPaymentParams {
  companyId: string
  contractorPaymentId: string
  accessToken?: string
}

export interface GustoCreateContractorPaymentParams {
  companyId: string
  contractorUuid: string
  date: string
  wage?: number
  hours?: number
  bonus?: number
  reimbursement?: number
  paymentMethod?: 'Direct Deposit' | 'Check'
  accessToken?: string
}

export interface GustoListEmployeeTimeOffActivitiesParams {
  employeeId: string
  timeOffType: string
  accessToken?: string
}

export interface GustoListDepartmentsParams {
  companyId: string
  accessToken?: string
}

export interface GustoCreateDepartmentParams {
  companyId: string
  title: string
  accessToken?: string
}

export interface GustoListCompanyBenefitsParams {
  companyId: string
  accessToken?: string
}

export interface GustoListEmployeeBenefitsParams {
  employeeId: string
  accessToken?: string
}

export interface GustoListEmployeeFormsParams {
  employeeId: string
  accessToken?: string
}

export interface GustoListContractorFormsParams {
  contractorId: string
  accessToken?: string
}

/* ========== New Response Types ========== */

export interface GustoEmployeeRecordResponse extends ToolResponse {
  output: { employee?: Record<string, unknown> }
}

export interface GustoTerminationResponse extends ToolResponse {
  output: { termination?: Record<string, unknown> }
}

export interface GustoRehireResponse extends ToolResponse {
  output: { rehire?: Record<string, unknown> }
}

export interface GustoJobsListResponse extends ToolResponse {
  output: { jobs?: Record<string, unknown>[] }
}

export interface GustoPayStubsListResponse extends ToolResponse {
  output: { payStubs?: Record<string, unknown>[] }
}

export interface GustoOnboardingStatusResponse extends ToolResponse {
  output: { onboardingStatus?: Record<string, unknown> }
}

export interface GustoContractorRecordResponse extends ToolResponse {
  output: { contractor?: Record<string, unknown> }
}

export interface GustoPayrollRecordResponse extends ToolResponse {
  output: { payroll?: Record<string, unknown> }
}

export interface GustoContractorPaymentsListResponse extends ToolResponse {
  output: { contractorPayments?: Record<string, unknown>[] }
}

export interface GustoContractorPaymentRecordResponse extends ToolResponse {
  output: { contractorPayment?: Record<string, unknown> }
}

export interface GustoTimeOffActivitiesResponse extends ToolResponse {
  output: { timeOffActivities?: Record<string, unknown>[] }
}

export interface GustoDepartmentsListResponse extends ToolResponse {
  output: { departments?: Record<string, unknown>[] }
}

export interface GustoDepartmentRecordResponse extends ToolResponse {
  output: { department?: Record<string, unknown> }
}

export interface GustoCompanyBenefitsListResponse extends ToolResponse {
  output: { companyBenefits?: Record<string, unknown>[] }
}

export interface GustoEmployeeBenefitsListResponse extends ToolResponse {
  output: { employeeBenefits?: Record<string, unknown>[] }
}

export interface GustoFormsListResponse extends ToolResponse {
  output: { forms?: Record<string, unknown>[] }
}

export type GustoResponse =
  | GustoGetCompanyResponse
  | GustoListEmployeesResponse
  | GustoGetEmployeeResponse
  | GustoCreateEmployeeResponse
  | GustoListContractorsResponse
  | GustoListPayrollsResponse
  | GustoGetPayrollResponse
  | GustoListPaySchedulesResponse
  | GustoListLocationsResponse
  | GustoEmployeeRecordResponse
  | GustoTerminationResponse
  | GustoRehireResponse
  | GustoJobsListResponse
  | GustoPayStubsListResponse
  | GustoOnboardingStatusResponse
  | GustoContractorRecordResponse
  | GustoPayrollRecordResponse
  | GustoContractorPaymentsListResponse
  | GustoContractorPaymentRecordResponse
  | GustoTimeOffActivitiesResponse
  | GustoDepartmentsListResponse
  | GustoDepartmentRecordResponse
  | GustoCompanyBenefitsListResponse
  | GustoEmployeeBenefitsListResponse
  | GustoFormsListResponse
