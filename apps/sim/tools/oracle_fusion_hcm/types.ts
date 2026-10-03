import type * as Schemas from '@/lib/internal/oracle-fusion-hcm/schema'
import type { ToolOutputProperty } from '@/tools/types'

export const ORACLE_FUSION_HCM_WORKER_OUTPUT_PROPERTIES = {
  personId: { type: 'string', description: 'Person ID' },
  personNumber: { type: 'string', description: 'Person number', nullable: true },
  displayName: { type: 'string', description: 'Display name', nullable: true },
  fullName: { type: 'string', description: 'Full name', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  knownAs: { type: 'string', description: 'Known-as name', nullable: true },
  workEmail: { type: 'string', description: 'Work email', nullable: true },
  username: { type: 'string', description: 'Oracle username', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_ASSIGNMENT_OUTPUT_PROPERTIES = {
  assignmentId: { type: 'string', description: 'Assignment ID' },
  assignmentNumber: { type: 'string', description: 'Assignment number', nullable: true },
  assignmentName: { type: 'string', description: 'Assignment name', nullable: true },
  startDate: { type: 'string', description: 'Start date', nullable: true },
  primaryFlag: { type: 'boolean', description: 'Primary assignment for worker', nullable: true },
  primaryAssignmentFlag: {
    type: 'boolean',
    description: 'Primary assignment for work relationship',
    nullable: true,
  },
  workerType: { type: 'string', description: 'Worker type', nullable: true },
  workerNumber: { type: 'string', description: 'Worker number', nullable: true },
  fullPartTime: { type: 'string', description: 'Full-time or part-time value', nullable: true },
  legalEmployerName: { type: 'string', description: 'Legal employer', nullable: true },
  businessUnitName: { type: 'string', description: 'Business unit', nullable: true },
  departmentName: { type: 'string', description: 'Department', nullable: true },
  jobCode: { type: 'string', description: 'Job code', nullable: true },
  jobName: { type: 'string', description: 'Job name', nullable: true },
  positionCode: { type: 'string', description: 'Position code', nullable: true },
  positionName: { type: 'string', description: 'Position name', nullable: true },
  locationCode: { type: 'string', description: 'Location code', nullable: true },
  locationName: { type: 'string', description: 'Location name', nullable: true },
  managerName: { type: 'string', description: 'Manager name', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_MANAGER_OUTPUT_PROPERTIES = {
  assignmentSupervisorId: { type: 'string', description: 'Assignment supervisor ID' },
  managerAssignmentId: { type: 'string', description: 'Manager assignment ID', nullable: true },
  managerAssignmentNumber: {
    type: 'string',
    description: 'Manager assignment number',
    nullable: true,
  },
  managerAssignmentName: {
    type: 'string',
    description: 'Manager assignment name',
    nullable: true,
  },
  managerPersonId: { type: 'string', description: 'Manager person ID', nullable: true },
  managerPersonNumber: { type: 'string', description: 'Manager person number', nullable: true },
  displayName: { type: 'string', description: 'Manager display name', nullable: true },
  firstName: { type: 'string', description: 'Manager first name', nullable: true },
  knownAs: { type: 'string', description: 'Manager known-as name', nullable: true },
  lastName: { type: 'string', description: 'Manager last name', nullable: true },
  managerType: { type: 'string', description: 'Manager type', nullable: true },
  managerTypeMeaning: { type: 'string', description: 'Manager type meaning', nullable: true },
  jobCode: { type: 'string', description: 'Job code', nullable: true },
  jobName: { type: 'string', description: 'Job name', nullable: true },
  positionCode: { type: 'string', description: 'Position code', nullable: true },
  positionName: { type: 'string', description: 'Position name', nullable: true },
  workEmail: { type: 'string', description: 'Work email', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_DIRECT_REPORT_OUTPUT_PROPERTIES = {
  assignmentId: { type: 'string', description: 'Assignment ID', nullable: true },
  assignmentNumber: { type: 'string', description: 'Assignment number', nullable: true },
  assignmentName: { type: 'string', description: 'Assignment name', nullable: true },
  personId: { type: 'string', description: 'Person ID', nullable: true },
  personNumber: { type: 'string', description: 'Person number', nullable: true },
  displayName: { type: 'string', description: 'Display name', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  knownAs: { type: 'string', description: 'Known-as name', nullable: true },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  relationshipType: { type: 'string', description: 'Relationship type', nullable: true },
  relationshipTypeMeaning: {
    type: 'string',
    description: 'Relationship meaning',
    nullable: true,
  },
  workerType: { type: 'string', description: 'Worker type', nullable: true },
  directReportsCount: { type: 'number', description: 'Direct report count', nullable: true },
  allReportsCount: { type: 'number', description: 'All report count', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_ABSENCE_OUTPUT_PROPERTIES = {
  absenceId: { type: 'string', description: 'Absence entry ID' },
  personId: { type: 'string', description: 'Person ID', nullable: true },
  personNumber: { type: 'string', description: 'Person number', nullable: true },
  absenceTypeId: { type: 'string', description: 'Absence type ID', nullable: true },
  absenceType: { type: 'string', description: 'Absence type', nullable: true },
  absenceStatusCode: { type: 'string', description: 'Absence status code', nullable: true },
  displayStatus: { type: 'string', description: 'Display status', nullable: true },
  displayStatusMeaning: { type: 'string', description: 'Display status meaning', nullable: true },
  approvalStatusCode: { type: 'string', description: 'Approval status code', nullable: true },
  assignmentId: { type: 'string', description: 'Assignment ID', nullable: true },
  assignmentName: { type: 'string', description: 'Assignment name', nullable: true },
  assignmentNumber: { type: 'string', description: 'Assignment number', nullable: true },
  startDate: { type: 'string', description: 'Start date', nullable: true },
  startTime: { type: 'string', description: 'Start time', nullable: true },
  endDate: { type: 'string', description: 'End date', nullable: true },
  endTime: { type: 'string', description: 'End time', nullable: true },
  duration: { type: 'number', description: 'Duration', nullable: true },
  formattedDuration: { type: 'string', description: 'Formatted duration', nullable: true },
  unitOfMeasure: { type: 'string', description: 'Duration unit', nullable: true },
  unitOfMeasureMeaning: { type: 'string', description: 'Duration unit meaning', nullable: true },
  openEndedFlag: { type: 'boolean', description: 'Open-ended flag', nullable: true },
  singleDayFlag: { type: 'boolean', description: 'Single-day flag', nullable: true },
  employer: { type: 'string', description: 'Employer', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_ABSENCE_TYPE_OUTPUT_PROPERTIES = {
  absenceTypeId: { type: 'string', description: 'Absence type ID' },
  name: { type: 'string', description: 'Absence type name', nullable: true },
  nameWithEmployer: { type: 'string', description: 'Name with employer', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  employerId: { type: 'string', description: 'Employer ID', nullable: true },
  employerName: { type: 'string', description: 'Employer name', nullable: true },
  durationCalculationBasis: {
    type: 'string',
    description: 'Duration calculation basis',
    nullable: true,
  },
  durationUomCode: { type: 'string', description: 'Duration unit code', nullable: true },
  durationUomMeaning: { type: 'string', description: 'Duration unit meaning', nullable: true },
  displaySequence: { type: 'number', description: 'Display sequence', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_JOB_OUTPUT_PROPERTIES = {
  jobId: { type: 'string', description: 'Job ID' },
  jobCode: { type: 'string', description: 'Job code', nullable: true },
  name: { type: 'string', description: 'Job name', nullable: true },
  activeStatus: { type: 'string', description: 'Active status', nullable: true },
  jobFamilyId: { type: 'string', description: 'Job family ID', nullable: true },
  jobFunctionCode: { type: 'string', description: 'Job function code', nullable: true },
  managerLevel: { type: 'string', description: 'Manager level', nullable: true },
  regularTemporary: { type: 'string', description: 'Regular or temporary', nullable: true },
  fullPartTime: { type: 'string', description: 'Full-time or part-time', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_JOB_FAMILY_OUTPUT_PROPERTIES = {
  jobFamilyId: { type: 'string', description: 'Job family ID' },
  jobFamilyCode: { type: 'string', description: 'Job family code', nullable: true },
  name: { type: 'string', description: 'Job family name', nullable: true },
  activeStatus: { type: 'string', description: 'Active status', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_DEPARTMENT_OUTPUT_PROPERTIES = {
  organizationId: { type: 'string', description: 'Organization ID' },
  organizationCode: { type: 'string', description: 'Organization code', nullable: true },
  name: { type: 'string', description: 'Department name', nullable: true },
  classificationCode: { type: 'string', description: 'Classification code', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  locationId: { type: 'string', description: 'Location ID', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LOCATION_OUTPUT_PROPERTIES = {
  locationId: { type: 'string', description: 'Location ID' },
  locationCode: { type: 'string', description: 'Location code', nullable: true },
  name: { type: 'string', description: 'Location name', nullable: true },
  description: { type: 'string', description: 'Location description', nullable: true },
  activeStatus: { type: 'string', description: 'Active status', nullable: true },
  country: { type: 'string', description: 'Country', nullable: true },
  townOrCity: { type: 'string', description: 'Town or city', nullable: true },
  region1: { type: 'string', description: 'Region 1', nullable: true },
  region2: { type: 'string', description: 'Region 2', nullable: true },
  region3: { type: 'string', description: 'Region 3', nullable: true },
  postalCode: { type: 'string', description: 'Postal code', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_POSITION_OUTPUT_PROPERTIES = {
  positionId: { type: 'string', description: 'Position ID' },
  positionCode: { type: 'string', description: 'Position code', nullable: true },
  name: { type: 'string', description: 'Position name', nullable: true },
  activeStatus: { type: 'string', description: 'Active status', nullable: true },
  positionType: { type: 'string', description: 'Position type', nullable: true },
  jobId: { type: 'string', description: 'Job ID', nullable: true },
  departmentId: { type: 'string', description: 'Department ID', nullable: true },
  locationId: { type: 'string', description: 'Location ID', nullable: true },
  businessUnitId: { type: 'string', description: 'Business unit ID', nullable: true },
  regularTemporary: { type: 'string', description: 'Regular or temporary', nullable: true },
  fullPartTime: { type: 'string', description: 'Full-time or part-time', nullable: true },
  hiringStatus: { type: 'string', description: 'Hiring status', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_BUSINESS_UNIT_OUTPUT_PROPERTIES = {
  businessUnitId: { type: 'string', description: 'Business unit ID' },
  name: { type: 'string', description: 'Business unit name', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LEGAL_EMPLOYER_OUTPUT_PROPERTIES = {
  organizationId: { type: 'string', description: 'Organization ID' },
  name: { type: 'string', description: 'Legal employer name', nullable: true },
  legislationCode: { type: 'string', description: 'Legislation code', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_GRADE_OUTPUT_PROPERTIES = {
  gradeId: { type: 'string', description: 'Grade ID' },
  gradeCode: { type: 'string', description: 'Grade code', nullable: true },
  name: { type: 'string', description: 'Grade name', nullable: true },
  activeStatus: { type: 'string', description: 'Active status', nullable: true },
  categoryCode: { type: 'string', description: 'Category code', nullable: true },
  setId: { type: 'string', description: 'Reference data set ID', nullable: true },
  effectiveStartDate: { type: 'string', description: 'Effective start date', nullable: true },
  effectiveEndDate: { type: 'string', description: 'Effective end date', nullable: true },
  lastUpdateDate: { type: 'string', description: 'Last update date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERSON_TYPE_OUTPUT_PROPERTIES = {
  personTypeId: { type: 'string', description: 'Person type ID' },
  systemPersonType: { type: 'string', description: 'System person type', nullable: true },
  userPersonType: { type: 'string', description: 'User person type', nullable: true },
  activeFlag: { type: 'boolean', description: 'Active flag', nullable: true },
  defaultFlag: { type: 'boolean', description: 'Default flag', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES = {
  count: { type: 'number', description: 'Records in this page' },
  hasMore: { type: 'boolean', description: 'Whether another page exists' },
  limit: { type: 'number', description: 'Page size used by Oracle' },
  offset: { type: 'number', description: 'Page offset used by Oracle' },
  nextOffset: {
    type: 'number',
    description: 'Next Oracle page offset when another page exists',
    optional: true,
  },
  totalResults: {
    type: 'number',
    description: 'Estimated total when Oracle provides it',
    optional: true,
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_WORKERS_OUTPUTS = {
  workers: {
    type: 'array',
    description: 'Workers',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_WORKER_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_GET_WORKER_OUTPUTS = {
  worker: {
    type: 'object',
    description: 'Worker',
    properties: ORACLE_FUSION_HCM_WORKER_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_ASSIGNMENTS_OUTPUTS = {
  assignments: {
    type: 'array',
    description: 'Assignments',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_ASSIGNMENT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_GET_ASSIGNMENT_OUTPUTS = {
  assignment: {
    type: 'object',
    description: 'Assignment',
    properties: ORACLE_FUSION_HCM_ASSIGNMENT_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_MANAGERS_OUTPUTS = {
  managers: {
    type: 'array',
    description: 'Managers',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_MANAGER_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_DIRECT_REPORTS_OUTPUTS = {
  directReports: {
    type: 'array',
    description: 'Direct reports',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_DIRECT_REPORT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_ABSENCES_OUTPUTS = {
  absences: {
    type: 'array',
    description: 'Absences',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_ABSENCE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_GET_ABSENCE_OUTPUTS = {
  absence: {
    type: 'object',
    description: 'Absence',
    properties: ORACLE_FUSION_HCM_ABSENCE_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_ABSENCE_TYPES_OUTPUTS = {
  absenceTypes: {
    type: 'array',
    description: 'Absence types',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_ABSENCE_TYPE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_JOBS_OUTPUTS = {
  jobs: {
    type: 'array',
    description: 'Jobs',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_JOB_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_JOB_FAMILIES_OUTPUTS = {
  jobFamilies: {
    type: 'array',
    description: 'Job families',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_JOB_FAMILY_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_DEPARTMENTS_OUTPUTS = {
  departments: {
    type: 'array',
    description: 'Departments',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_DEPARTMENT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_LOCATIONS_OUTPUTS = {
  locations: {
    type: 'array',
    description: 'Locations',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_LOCATION_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_POSITIONS_OUTPUTS = {
  positions: {
    type: 'array',
    description: 'Positions',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_POSITION_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_BUSINESS_UNITS_OUTPUTS = {
  businessUnits: {
    type: 'array',
    description: 'Business units',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_BUSINESS_UNIT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_LEGAL_EMPLOYERS_OUTPUTS = {
  legalEmployers: {
    type: 'array',
    description: 'Legal employers',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_LEGAL_EMPLOYER_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_GRADES_OUTPUTS = {
  grades: {
    type: 'array',
    description: 'Grades',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_GRADE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_PERSON_TYPES_OUTPUTS = {
  personTypes: {
    type: 'array',
    description: 'Person types',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PERSON_TYPE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListWorkersParams = Omit<
  Schemas.OracleFusionHcmListWorkersBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListWorkersResponse = Schemas.OracleFusionHcmListWorkersResponse

export type OracleFusionHcmGetWorkerParams = Omit<
  Schemas.OracleFusionHcmGetWorkerBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetWorkerResponse = Schemas.OracleFusionHcmGetWorkerResponse

export type OracleFusionHcmListWorkerAssignmentsParams = Omit<
  Schemas.OracleFusionHcmListWorkerAssignmentsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListWorkerAssignmentsResponse =
  Schemas.OracleFusionHcmListWorkerAssignmentsResponse

export type OracleFusionHcmGetWorkerAssignmentParams = Omit<
  Schemas.OracleFusionHcmGetWorkerAssignmentBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetWorkerAssignmentResponse =
  Schemas.OracleFusionHcmGetWorkerAssignmentResponse

export type OracleFusionHcmListWorkerManagersParams = Omit<
  Schemas.OracleFusionHcmListWorkerManagersBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListWorkerManagersResponse =
  Schemas.OracleFusionHcmListWorkerManagersResponse

export type OracleFusionHcmListWorkerDirectReportsParams = Omit<
  Schemas.OracleFusionHcmListWorkerDirectReportsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListWorkerDirectReportsResponse =
  Schemas.OracleFusionHcmListWorkerDirectReportsResponse

export type OracleFusionHcmListAbsencesParams = Omit<
  Schemas.OracleFusionHcmListAbsencesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListAbsencesResponse = Schemas.OracleFusionHcmListAbsencesResponse

export type OracleFusionHcmGetAbsenceParams = Omit<
  Schemas.OracleFusionHcmGetAbsenceBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetAbsenceResponse = Schemas.OracleFusionHcmGetAbsenceResponse

export type OracleFusionHcmListAbsenceTypesParams = Omit<
  Schemas.OracleFusionHcmListAbsenceTypesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListAbsenceTypesResponse =
  Schemas.OracleFusionHcmListAbsenceTypesResponse

export type OracleFusionHcmListJobsParams = Omit<
  Schemas.OracleFusionHcmListJobsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListJobsResponse = Schemas.OracleFusionHcmListJobsResponse

export type OracleFusionHcmListJobFamiliesParams = Omit<
  Schemas.OracleFusionHcmListJobFamiliesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListJobFamiliesResponse = Schemas.OracleFusionHcmListJobFamiliesResponse

export type OracleFusionHcmListDepartmentsParams = Omit<
  Schemas.OracleFusionHcmListDepartmentsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListDepartmentsResponse = Schemas.OracleFusionHcmListDepartmentsResponse

export type OracleFusionHcmListLocationsParams = Omit<
  Schemas.OracleFusionHcmListLocationsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListLocationsResponse = Schemas.OracleFusionHcmListLocationsResponse

export type OracleFusionHcmListPositionsParams = Omit<
  Schemas.OracleFusionHcmListPositionsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPositionsResponse = Schemas.OracleFusionHcmListPositionsResponse

export type OracleFusionHcmListBusinessUnitsParams = Omit<
  Schemas.OracleFusionHcmListBusinessUnitsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListBusinessUnitsResponse =
  Schemas.OracleFusionHcmListBusinessUnitsResponse

export type OracleFusionHcmListLegalEmployersParams = Omit<
  Schemas.OracleFusionHcmListLegalEmployersBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListLegalEmployersResponse =
  Schemas.OracleFusionHcmListLegalEmployersResponse

export type OracleFusionHcmListGradesParams = Omit<
  Schemas.OracleFusionHcmListGradesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListGradesResponse = Schemas.OracleFusionHcmListGradesResponse

export type OracleFusionHcmListPersonTypesParams = Omit<
  Schemas.OracleFusionHcmListPersonTypesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPersonTypesResponse = Schemas.OracleFusionHcmListPersonTypesResponse

export const ORACLE_FUSION_HCM_PAYROLL_RELATIONSHIP_OUTPUT_PROPERTIES = {
  payrollRelationshipId: { type: 'string', description: 'PayrollRelationshipId' },
  payrollRelationshipNumber: {
    type: 'string',
    description: 'PayrollRelationshipNumber',
    nullable: true,
  },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  country: { type: 'string', description: 'Country', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  endDate: { type: 'string', description: 'EndDate', nullable: true },
  overridingPeriodId: { type: 'string', description: 'OverridingPeriodId', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_ASSIGNMENT_OUTPUT_PROPERTIES = {
  payrollAssignmentId: { type: 'string', description: 'RelationshipGroupId' },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  assignmentNumber: { type: 'string', description: 'AssignmentNumber', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  overridingPeriodId: { type: 'string', description: 'OverridingPeriodId', nullable: true },
  timeCardRequired: { type: 'string', description: 'TimeCardRequired', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_ASSIGNED_PAYROLL_OUTPUT_PROPERTIES = {
  assignedPayrollId: { type: 'string', description: 'AssignedPayrollId' },
  payrollId: { type: 'string', description: 'PayrollId', nullable: true },
  payrollName: { type: 'string', description: 'PayrollName', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  endDate: { type: 'string', description: 'EndDate', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  lsed: { type: 'string', description: 'Lsed', nullable: true },
  overridingPeriodId: { type: 'string', description: 'OverridingPeriodId', nullable: true },
  timeCardRequired: { type: 'string', description: 'TimeCardRequired', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_DEFINITION_OUTPUT_PROPERTIES = {
  payrollId: { type: 'string', description: 'PayrollId' },
  payrollName: { type: 'string', description: 'PayrollName', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
  legislativeDataGroupName: {
    type: 'string',
    description: 'LegislativeDataGroupName',
    nullable: true,
  },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  periodType: { type: 'string', description: 'PeriodType', nullable: true },
  consolidationSetId: { type: 'string', description: 'ConsolidationSetId', nullable: true },
  consolidationSetName: { type: 'string', description: 'ConsolidationSetName', nullable: true },
  reportingName: { type: 'string', description: 'ReportingName', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_TIME_PERIOD_OUTPUT_PROPERTIES = {
  timePeriodId: { type: 'string', description: 'TimePeriodId', nullable: true },
  payrollId: { type: 'string', description: 'PayrollId', nullable: true },
  payrollName: { type: 'string', description: 'PayrollName', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
  periodName: { type: 'string', description: 'PeriodName', nullable: true },
  periodNumber: { type: 'number', description: 'PeriodNumber', nullable: true },
  periodType: { type: 'string', description: 'PeriodType', nullable: true },
  periodCategory: { type: 'string', description: 'PeriodCategory', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  endDate: { type: 'string', description: 'EndDate', nullable: true },
  regularEarnDate: { type: 'string', description: 'RegularEarnDate', nullable: true },
  regularProcessDate: { type: 'string', description: 'RegularProcessDate', nullable: true },
  defaultPaydate: { type: 'string', description: 'DefaultPaydate', nullable: true },
  payslipViewDate: { type: 'string', description: 'PayslipViewDate', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_ELEMENT_DEFINITION_OUTPUT_PROPERTIES = {
  elementTypeId: { type: 'string', description: 'ElementTypeId' },
  elementName: { type: 'string', description: 'ElementName', nullable: true },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
  legislationCode: { type: 'string', description: 'LegislationCode', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  processingType: { type: 'string', description: 'ProcessingType', nullable: true },
  useAtAssignmentLevel: { type: 'string', description: 'UseAtAssignmentLevel', nullable: true },
  useAtRelationshipLevel: { type: 'string', description: 'UseAtRelationshipLevel', nullable: true },
  inputCurrencyCode: { type: 'string', description: 'InputCurrencyCode', nullable: true },
  outputCurrencyCode: { type: 'string', description: 'OutputCurrencyCode', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_INPUT_VALUE_OUTPUT_PROPERTIES = {
  inputValueId: { type: 'string', description: 'InputValueId' },
  inputValueName: { type: 'string', description: 'InputValueName', nullable: true },
  elementTypeId: { type: 'string', description: 'ElementTypeId', nullable: true },
  elementName: { type: 'string', description: 'ElementName', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  uom: { type: 'string', description: 'UOM', nullable: true },
  reservedInputValue: { type: 'string', description: 'ReservedInputValue', nullable: true },
  displaySequence: { type: 'number', description: 'DisplaySequence', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_ELEMENT_ENTRY_OUTPUT_PROPERTIES = {
  elementEntryId: { type: 'string', description: 'ElementEntryId' },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  assignmentNumber: { type: 'string', description: 'AssignmentNumber', nullable: true },
  elementTypeId: { type: 'string', description: 'ElementTypeId', nullable: true },
  elementName: { type: 'string', description: 'ElementName', nullable: true },
  entryType: { type: 'string', description: 'EntryType', nullable: true },
  creatorType: { type: 'string', description: 'CreatorType', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  usageLevel: { type: 'string', description: 'UsageLevel', nullable: true },
  processingType: { type: 'string', description: 'ProcessingType', nullable: true },
  inputCurrencyCode: { type: 'string', description: 'InputCurrencyCode', nullable: true },
  legCode: { type: 'string', description: 'LegCode', nullable: true },
  legDataGroupId: { type: 'string', description: 'LegDataGroupId', nullable: true },
  payrollRelationshipNumber: {
    type: 'string',
    description: 'PayrollRelationshipNumber',
    nullable: true,
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_ELEMENT_ENTRY_VALUE_OUTPUT_PROPERTIES = {
  elementEntryValueId: { type: 'string', description: 'ElementEntryValueId' },
  inputValueId: { type: 'string', description: 'InputValueId', nullable: true },
  inputValueName: { type: 'string', description: 'InputValueName', nullable: true },
  screenEntryValue: { type: 'string', description: 'ScreenEntryValue', nullable: true },
  uom: { type: 'string', description: 'UOM', nullable: true },
  mandatoryFlag: { type: 'boolean', description: 'MandatoryFlag', nullable: true },
  userEnterableFlag: { type: 'boolean', description: 'UserEnterableFlag', nullable: true },
  displaySequence: { type: 'number', description: 'DisplaySequence', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERSON_PROCESS_RESULT_OUTPUT_PROPERTIES = {
  objectActionId: { type: 'string', description: 'ObjectActionId', nullable: true },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  assignmentNumber: { type: 'string', description: 'AssignmentNumber', nullable: true },
  payrollRelationshipId: { type: 'string', description: 'PayrollRelationshipId', nullable: true },
  payrollId: { type: 'string', description: 'PayrollId', nullable: true },
  payroll: { type: 'string', description: 'Payroll', nullable: true },
  actionTypeCode: { type: 'string', description: 'ActionTypeCode', nullable: true },
  actionStatusCode: { type: 'string', description: 'ActionStatusCode', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  processDate: { type: 'string', description: 'ProcessDate', nullable: true },
  processStartDate: { type: 'string', description: 'ProcessStartDate', nullable: true },
  processEndDate: { type: 'string', description: 'ProcessEndDate', nullable: true },
  flowInstanceId: { type: 'string', description: 'FlowInstanceId', nullable: true },
  flowName: { type: 'string', description: 'FlowName', nullable: true },
  payrollPeriodName: { type: 'string', description: 'PayrollPeriodName', nullable: true },
  legislationCode: { type: 'string', description: 'LegislationCode', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_RUN_RESULT_OUTPUT_PROPERTIES = {
  runResultId: { type: 'string', description: 'RunResultId' },
  inputValueId: { type: 'string', description: 'InputValueId', nullable: true },
  inputValueName: { type: 'string', description: 'InputValueName', nullable: true },
  elementEntryId: { type: 'string', description: 'ElementEntryId', nullable: true },
  elementTypeId: { type: 'string', description: 'ElementTypeId', nullable: true },
  elementName: { type: 'string', description: 'ElementName', nullable: true },
  resultValue: { type: 'string', description: 'ResultValue', nullable: true },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  assignmentNumber: { type: 'string', description: 'AssignmentNumber', nullable: true },
  payrollRelationshipId: { type: 'string', description: 'PayrollRelationshipId', nullable: true },
  dateEarned: { type: 'string', description: 'DateEarned', nullable: true },
  outputCurrencyCode: { type: 'string', description: 'OutputCurrencyCode', nullable: true },
  inputCurrencyCode: { type: 'string', description: 'Inputcurrencycode', nullable: true },
  uom: { type: 'string', description: 'Uom', nullable: true },
  prorationStartDate: { type: 'string', description: 'ProrationStartDate', nullable: true },
  prorationEndDate: { type: 'string', description: 'ProrationEndDate', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PAYROLL_BALANCE_OUTPUT_PROPERTIES = {
  balanceTypeId: { type: 'string', description: 'BalanceTypeId', nullable: true },
  balanceName: { type: 'string', description: 'BalanceName', nullable: true },
  dimensionName: { type: 'string', description: 'DimensionName', nullable: true },
  payrollRelActionId: { type: 'string', description: 'PayrollRelActionId', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
  legislationCode: { type: 'string', description: 'LegislationCode', nullable: true },
  uom: { type: 'string', description: 'Uom', nullable: true },
  uomCode: { type: 'string', description: 'UomCode', nullable: true },
  ctxString: { type: 'string', description: 'CtxString', nullable: true },
  ctxUserString: { type: 'string', description: 'CtxUserString', nullable: true },
  value1: { type: 'string', description: 'Value1', nullable: true },
  defbalId1: { type: 'string', description: 'DefbalId1', nullable: true },
  value2: { type: 'string', description: 'Value2', nullable: true },
  defbalId2: { type: 'string', description: 'DefbalId2', nullable: true },
  value3: { type: 'string', description: 'Value3', nullable: true },
  defbalId3: { type: 'string', description: 'DefbalId3', nullable: true },
  value4: { type: 'string', description: 'Value4', nullable: true },
  defbalId4: { type: 'string', description: 'DefbalId4', nullable: true },
  value5: { type: 'string', description: 'Value5', nullable: true },
  defbalId5: { type: 'string', description: 'DefbalId5', nullable: true },
  value6: { type: 'string', description: 'Value6', nullable: true },
  defbalId6: { type: 'string', description: 'DefbalId6', nullable: true },
  value7: { type: 'string', description: 'Value7', nullable: true },
  defbalId7: { type: 'string', description: 'DefbalId7', nullable: true },
  value8: { type: 'string', description: 'Value8', nullable: true },
  defbalId8: { type: 'string', description: 'DefbalId8', nullable: true },
  value9: { type: 'string', description: 'Value9', nullable: true },
  defbalId9: { type: 'string', description: 'DefbalId9', nullable: true },
  value10: { type: 'string', description: 'Value10', nullable: true },
  defbalId10: { type: 'string', description: 'DefbalId10', nullable: true },
  totalValue1: { type: 'string', description: 'TotalValue1', nullable: true },
  totalValue2: { type: 'string', description: 'TotalValue2', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_SALARY_OUTPUT_PROPERTIES = {
  salaryId: { type: 'string', description: 'SalaryId' },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  assignmentNumber: { type: 'string', description: 'AssignmentNumber', nullable: true },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  salaryBasisId: { type: 'string', description: 'SalaryBasisId', nullable: true },
  salaryBasisName: { type: 'string', description: 'SalaryBasisName', nullable: true },
  salaryBasisType: { type: 'string', description: 'SalaryBasisType', nullable: true },
  salaryAmount: { type: 'number', description: 'SalaryAmount', nullable: true },
  currencyCode: { type: 'string', description: 'CurrencyCode', nullable: true },
  salaryFrequencyCode: { type: 'string', description: 'SalaryFrequencyCode', nullable: true },
  dateFrom: { type: 'string', description: 'DateFrom', nullable: true },
  dateTo: { type: 'string', description: 'DateTo', nullable: true },
  annualSalary: { type: 'number', description: 'AnnualSalary', nullable: true },
  annualFullTimeSalary: { type: 'number', description: 'AnnualFullTimeSalary', nullable: true },
  multipleComponents: { type: 'string', description: 'MultipleComponents', nullable: true },
  pendingTransactionExists: {
    type: 'string',
    description: 'PendingTransactionExists',
    nullable: true,
  },
  salaryTransactionStatus: {
    type: 'string',
    description: 'SalaryTransactionStatus',
    nullable: true,
  },
  salaryAmountScale: { type: 'number', description: 'SalaryAmountScale', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_SALARY_BASIS_OUTPUT_PROPERTIES = {
  salaryBasisId: { type: 'string', description: 'SalaryBasisId' },
  salaryBasisName: { type: 'string', description: 'SalaryBasisName', nullable: true },
  salaryBasisType: { type: 'string', description: 'SalaryBasisType', nullable: true },
  code: { type: 'string', description: 'Code', nullable: true },
  frequencyCode: { type: 'string', description: 'FrequencyCode', nullable: true },
  frequencyName: { type: 'string', description: 'FrequencyName', nullable: true },
  inputCurrencyCode: { type: 'string', description: 'InputCurrencyCode', nullable: true },
  legislativeDataGroupId: { type: 'string', description: 'LegislativeDataGroupId', nullable: true },
  gradeRateId: { type: 'string', description: 'GradeRateId', nullable: true },
  componentUsage: { type: 'string', description: 'ComponentUsage', nullable: true },
  salaryAmountScale: { type: 'number', description: 'SalaryAmountScale', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  useAtAssignmentLevel: { type: 'string', description: 'UseAtAssignmentLevel', nullable: true },
  useAtRelationshipLevel: { type: 'string', description: 'UseAtRelationshipLevel', nullable: true },
  useAtTermsLevel: { type: 'string', description: 'UseAtTermsLevel', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_STANDARD_SALARY_COMPONENT_OUTPUT_PROPERTIES = {
  salaryComponentId: { type: 'string', description: 'SalaryComponentId' },
  salaryId: { type: 'string', description: 'SalaryId', nullable: true },
  componentName: { type: 'string', description: 'ComponentName', nullable: true },
  componentReasonCode: { type: 'string', description: 'ComponentReasonCode', nullable: true },
  adjustmentAmount: { type: 'number', description: 'AdjustmentAmount', nullable: true },
  adjustmentPercentage: { type: 'number', description: 'AdjustmentPercentage', nullable: true },
  displaySequence: { type: 'number', description: 'DisplaySequence', nullable: true },
  changeAmountScale: { type: 'number', description: 'ChangeAmountScale', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_SIMPLE_SALARY_COMPONENT_OUTPUT_PROPERTIES = {
  simpleSalaryCompntId: { type: 'string', description: 'SimpleSalaryCompntId' },
  salaryId: { type: 'string', description: 'SalaryId', nullable: true },
  basisSimpleComponentId: { type: 'string', description: 'BasisSimpleComponentId', nullable: true },
  componentName: { type: 'string', description: 'ComponentName', nullable: true },
  componentCode: { type: 'string', description: 'ComponentCode', nullable: true },
  componentType: { type: 'string', description: 'ComponentType', nullable: true },
  currencyCode: { type: 'string', description: 'CurrencyCode', nullable: true },
  amount: { type: 'number', description: 'Amount', nullable: true },
  annualAmount: { type: 'number', description: 'AnnualAmount', nullable: true },
  annualFtAmount: { type: 'number', description: 'AnnualFtAmount', nullable: true },
  adjustmentAmount: { type: 'number', description: 'AdjustmentAmount', nullable: true },
  adjustmentPercent: { type: 'number', description: 'AdjustmentPercent', nullable: true },
  percentage: { type: 'number', description: 'Percentage', nullable: true },
  scale: { type: 'number', description: 'Scale', nullable: true },
  userSelectedComponent: { type: 'string', description: 'UserSelectedComponent', nullable: true },
  overallSalaryAffect: { type: 'string', description: 'OverallSalaryAffect', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_RATE_SALARY_COMPONENT_OUTPUT_PROPERTIES = {
  salaryPayComponentId: { type: 'string', description: 'SalaryPayComponentId' },
  salaryId: { type: 'string', description: 'SalaryId', nullable: true },
  payRateDefinitionId: { type: 'string', description: 'PayRateDefinitionId', nullable: true },
  name: { type: 'string', description: 'Name', nullable: true },
  shortName: { type: 'string', description: 'ShortName', nullable: true },
  rateAmount: { type: 'number', description: 'RateAmount', nullable: true },
  rateAnnualAmount: { type: 'number', description: 'RateAnnualAmount', nullable: true },
  rateAnnualFtAmount: { type: 'number', description: 'RateAnnualFtAmount', nullable: true },
  rateCurrencyCode: { type: 'string', description: 'RateCurrencyCode', nullable: true },
  ratePeriodicityCode: { type: 'string', description: 'RatePeriodicityCode', nullable: true },
  rateMinimumAmount: { type: 'number', description: 'RateMinimumAmount', nullable: true },
  rateMaximumAmount: { type: 'number', description: 'RateMaximumAmount', nullable: true },
  rateAdjustmentAmount: { type: 'number', description: 'RateAdjustmentAmount', nullable: true },
  rateAdjustmentPercent: { type: 'number', description: 'RateAdjustmentPercent', nullable: true },
  rateFactor: { type: 'number', description: 'RateFactor', nullable: true },
  rateOverallSalaryFlag: { type: 'boolean', description: 'RateOverallSalaryFlag', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_GRADE_RATE_VALUE_OUTPUT_PROPERTIES = {
  rateValueId: { type: 'string', description: 'RateValueId' },
  gradeId: { type: 'string', description: 'GradeId', nullable: true },
  effectiveStartDate: { type: 'string', description: 'EffectiveStartDate', nullable: true },
  effectiveEndDate: { type: 'string', description: 'EffectiveEndDate', nullable: true },
  minimumAmount: { type: 'number', description: 'MinimumAmount', nullable: true },
  midValueAmount: { type: 'number', description: 'MidValueAmount', nullable: true },
  maximumAmount: { type: 'number', description: 'MaximumAmount', nullable: true },
  valueAmount: { type: 'number', description: 'ValueAmount', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_GOAL_PLAN_OUTPUT_PROPERTIES = {
  goalPlanId: { type: 'string', description: 'GoalPlanId' },
  goalPlanName: { type: 'string', description: 'GoalPlanName', nullable: true },
  reviewPeriodId: { type: 'string', description: 'ReviewPeriodId', nullable: true },
  reviewPeriodName: { type: 'string', description: 'ReviewPeriodName', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  endDate: { type: 'string', description: 'EndDate', nullable: true },
  goalSettingStartDate: { type: 'string', description: 'GoalSettingStartDate', nullable: true },
  goalSettingEndDate: { type: 'string', description: 'GoalSettingEndDate', nullable: true },
  goalPlanActiveCode: { type: 'string', description: 'GoalPlanActiveCode', nullable: true },
  restrictGoalCreationFlag: {
    type: 'boolean',
    description: 'RestrictGoalCreationFlag',
    nullable: true,
  },
  restrictGoalUpdateFlag: {
    type: 'boolean',
    description: 'RestrictGoalUpdateFlag',
    nullable: true,
  },
  enableWeightingFlag: { type: 'boolean', description: 'EnableWeightingFlag', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERFORMANCE_GOAL_OUTPUT_PROPERTIES = {
  goalId: { type: 'string', description: 'GoalId' },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  goalName: { type: 'string', description: 'GoalName', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  targetCompletionDate: { type: 'string', description: 'TargetCompletionDate', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  statusMeaning: { type: 'string', description: 'StatusMeaning', nullable: true },
  percentComplete: { type: 'string', description: 'PercentComplete', nullable: true },
  reviewPeriodId: { type: 'string', description: 'ReviewPeriodId', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_DEVELOPMENT_GOAL_OUTPUT_PROPERTIES = {
  goalId: { type: 'string', description: 'GoalId' },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  assignmentNumber: { type: 'string', description: 'AssignmentNumber', nullable: true },
  goalName: { type: 'string', description: 'GoalName', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  targetCompletionDate: { type: 'string', description: 'TargetCompletionDate', nullable: true },
  actualCompletionDate: { type: 'string', description: 'ActualCompletionDate', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  statusMeaning: { type: 'string', description: 'StatusMeaning', nullable: true },
  percentComplete: { type: 'string', description: 'PercentComplete', nullable: true },
  privateFlag: { type: 'boolean', description: 'PrivateFlag', nullable: true },
  requiresApprovalStatus: { type: 'string', description: 'RequiresApprovalStatus', nullable: true },
  goalApprovalState: { type: 'string', description: 'GoalApprovalState', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_OUTPUT_PROPERTIES = {
  evaluationId: { type: 'string', description: 'EvaluationId' },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  assignmentId: { type: 'string', description: 'AssignmentId', nullable: true },
  performanceDocumentName: {
    type: 'string',
    description: 'PerformanceDocumentName',
    nullable: true,
  },
  evalStatus: { type: 'string', description: 'EvalStatus', nullable: true },
  statusCode: { type: 'string', description: 'StatusCode', nullable: true },
  reviewPeriodId: { type: 'string', description: 'ReviewPeriodId', nullable: true },
  startDate: { type: 'string', description: 'StartDate', nullable: true },
  endDate: { type: 'string', description: 'EndDate', nullable: true },
  managerId: { type: 'string', description: 'ManagerId', nullable: true },
  managerAssignmentId: { type: 'string', description: 'ManagerAssignmentId', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_ROLE_OUTPUT_PROPERTIES = {
  evalRoleId: { type: 'string', description: 'EvalRoleId' },
  roleTypeCode: { type: 'string', description: 'RoleTypeCode', nullable: true },
  minimumNumberPcpns: { type: 'number', description: 'MinimumNumberPcpns', nullable: true },
  matrixParticipantFlag: { type: 'boolean', description: 'MatrixParticipantFlag', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_PARTICIPANT_OUTPUT_PROPERTIES = {
  evalParticipantId: { type: 'string', description: 'EvalParticipantId' },
  evalRoleId: { type: 'string', description: 'EvalRoleId', nullable: true },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  participationStatusCode: {
    type: 'string',
    description: 'ParticipationStatusCode',
    nullable: true,
  },
  dueDate: { type: 'string', description: 'DueDate', nullable: true },
  fdbackCompletionDate: { type: 'string', description: 'FdbackCompletionDate', nullable: true },
  matrixParticipantFlag: { type: 'boolean', description: 'MatrixParticipantFlag', nullable: true },
  roleTypeCode: { type: 'string', description: 'RoleTypeCode', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_TASK_OUTPUT_PROPERTIES = {
  evalStepId: { type: 'string', description: 'EvalStepId' },
  stepCode: { type: 'string', description: 'StepCode', nullable: true },
  stepStatus: { type: 'string', description: 'StepStatus', nullable: true },
  taskName: { type: 'string', description: 'TaskName', nullable: true },
  taskStatus: { type: 'string', description: 'TaskStatus', nullable: true },
  dueDate: { type: 'string', description: 'DueDate', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TALENT_PROFILE_OUTPUT_PROPERTIES = {
  profileId: { type: 'string', description: 'ProfileId' },
  personId: { type: 'string', description: 'PersonId', nullable: true },
  personNumber: { type: 'string', description: 'PersonNumber', nullable: true },
  profileCode: { type: 'string', description: 'ProfileCode', nullable: true },
  displayName: { type: 'string', description: 'DisplayName', nullable: true },
  statusCode: { type: 'string', description: 'StatusCode', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TALENT_PROFILE_SECTION_OUTPUT_PROPERTIES = {
  profileSectionId: { type: 'string', description: 'ProfileSectionId' },
  sectionId: { type: 'string', description: 'SectionId', nullable: true },
  sectionName: { type: 'string', description: 'SectionName', nullable: true },
  sectionContext: { type: 'string', description: 'SectionContext', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TALENT_PROFILE_SKILL_OUTPUT_PROPERTIES = {
  skillId: { type: 'string', description: 'SkillId' },
  profileId: { type: 'string', description: 'ProfileId', nullable: true },
  sectionId: { type: 'string', description: 'SectionId', nullable: true },
  skill: { type: 'string', description: 'Skill', nullable: true },
  skillType: { type: 'string', description: 'SkillType', nullable: true },
  skillTypeMeaning: { type: 'string', description: 'SkillTypeMeaning', nullable: true },
  dateAchieved: { type: 'string', description: 'DateAchieved', nullable: true },
  yearsOfExperience: { type: 'number', description: 'YearsOfExperience', nullable: true },
  projectOrActivity: { type: 'string', description: 'ProjectOrActivity', nullable: true },
  source: { type: 'string', description: 'Source', nullable: true },
  sourceType: { type: 'string', description: 'SourceType', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TALENT_PROFILE_CERTIFICATION_OUTPUT_PROPERTIES = {
  certificationId: { type: 'string', description: 'CertificationId' },
  profileId: { type: 'string', description: 'ProfileId', nullable: true },
  sectionId: { type: 'string', description: 'SectionId', nullable: true },
  licenseOrCertificate: { type: 'string', description: 'LicenseOrCertificate', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  issueDate: { type: 'string', description: 'IssueDate', nullable: true },
  expirationDate: { type: 'string', description: 'ExpirationDate', nullable: true },
  renewalDate: { type: 'string', description: 'RenewalDate', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  statusMeaning: { type: 'string', description: 'StatusMeaning', nullable: true },
  issuedBy: { type: 'string', description: 'IssuedBy', nullable: true },
  verified: { type: 'string', description: 'Verified', nullable: true },
  verifiedMeaning: { type: 'string', description: 'VerifiedMeaning', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_RECORD_OUTPUT_PROPERTIES = {
  timeRecordId: { type: 'string', description: 'timeRecordId' },
  timeRecordVersion: { type: 'number', description: 'timeRecordVersion', nullable: true },
  timeRecordGroupId: { type: 'string', description: 'timeRecordGroupId', nullable: true },
  timeRecordGroupVersion: { type: 'number', description: 'timeRecordGroupVersion', nullable: true },
  personId: { type: 'string', description: 'personId', nullable: true },
  personNumber: { type: 'string', description: 'personNumber', nullable: true },
  assignmentNumber: { type: 'string', description: 'assignmentNumber', nullable: true },
  recordType: { type: 'string', description: 'recordType', nullable: true },
  groupType: { type: 'string', description: 'groupType', nullable: true },
  startTime: { type: 'string', description: 'startTime', nullable: true },
  stopTime: { type: 'string', description: 'stopTime', nullable: true },
  measure: { type: 'number', description: 'measure', nullable: true },
  unitOfMeasure: { type: 'string', description: 'unitOfMeasure', nullable: true },
  earnedDate: { type: 'string', description: 'earnedDate', nullable: true },
  overtimeDate: { type: 'string', description: 'overtimeDate', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_CARD_OUTPUT_PROPERTIES = {
  timeRecordGroupId: { type: 'string', description: 'timeRecordGroupId' },
  timeRecordGroupVersion: { type: 'number', description: 'timeRecordGroupVersion', nullable: true },
  personId: { type: 'string', description: 'personId', nullable: true },
  personNumber: { type: 'string', description: 'personNumber', nullable: true },
  assignmentNumber: { type: 'string', description: 'assignmentNumber', nullable: true },
  startTime: { type: 'string', description: 'startTime', nullable: true },
  stopTime: { type: 'string', description: 'stopTime', nullable: true },
  totalHours: { type: 'number', description: 'totalHours', nullable: true },
  groupType: { type: 'string', description: 'groupType', nullable: true },
  parentTimeRecordGroupId: {
    type: 'string',
    description: 'parentTimeRecordGroupId',
    nullable: true,
  },
  parentTimeRecordGroupVersion: {
    type: 'number',
    description: 'parentTimeRecordGroupVersion',
    nullable: true,
  },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_ATTRIBUTE_OUTPUT_PROPERTIES = {
  tmAtrbFldId: { type: 'string', description: 'tmAtrbFldId' },
  tmAtrbFldUsageId: { type: 'string', description: 'tmAtrbFldUsageId', nullable: true },
  attributeName: { type: 'string', description: 'attributeName', nullable: true },
  contextCode: { type: 'string', description: 'contextCode', nullable: true },
  displayName: { type: 'string', description: 'displayName', nullable: true },
  description: { type: 'string', description: 'description', nullable: true },
  name: { type: 'string', description: 'name', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_ATTRIBUTE_DATA_SOURCE_OUTPUT_PROPERTIES = {
  dataSourceUsageId: { type: 'string', description: 'dataSourceUsageId' },
  dataSourceUsageCode: { type: 'string', description: 'dataSourceUsageCode', nullable: true },
  tmAtrbFldId: { type: 'string', description: 'tmAtrbFldId', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_ATTRIBUTE_CRITERIA_BIND_OUTPUT_PROPERTIES = {
  bindName: { type: 'string', description: 'bindName', nullable: true },
  criteriaName: { type: 'string', description: 'criteriaName', nullable: true },
  dataType: { type: 'string', description: 'dataType', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_ATTRIBUTE_VALUE_OUTPUT_PROPERTIES = {
  value: { type: 'string', description: 'value', nullable: true },
  displayValue: { type: 'string', description: 'displayValue', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_OUTPUT_PROPERTIES = {
  timeRecordEventRequestId: { type: 'string', description: 'timeRecordEventRequestId' },
  processInline: { type: 'string', description: 'processInline', nullable: true },
  processMode: { type: 'string', description: 'processMode', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_EVENT_OUTPUT_PROPERTIES = {
  timeRecordEventId: { type: 'string', description: 'timeRecordEventId', nullable: true },
  timeRecordEventRequestId: {
    type: 'string',
    description: 'timeRecordEventRequestId',
    nullable: true,
  },
  timeRecordId: { type: 'string', description: 'timeRecordId', nullable: true },
  timeRecordVersion: { type: 'number', description: 'timeRecordVersion', nullable: true },
  operationType: { type: 'string', description: 'operationType', nullable: true },
  eventStatus: { type: 'string', description: 'eventStatus', nullable: true },
  eventStatusValue: { type: 'number', description: 'eventStatusValue', nullable: true },
  crudStatusValue: { type: 'number', description: 'crudStatusValue', nullable: true },
  personId: { type: 'string', description: 'personId', nullable: true },
  reporterId: { type: 'string', description: 'reporterId', nullable: true },
  reporterIdType: { type: 'string', description: 'reporterIdType', nullable: true },
  assignmentNumber: { type: 'string', description: 'assignmentNumber', nullable: true },
  startTime: { type: 'string', description: 'startTime', nullable: true },
  stopTime: { type: 'string', description: 'stopTime', nullable: true },
  measure: { type: 'number', description: 'measure', nullable: true },
  referenceDate: { type: 'string', description: 'referenceDate', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_TIME_RECORD_EVENT_MESSAGE_OUTPUT_PROPERTIES = {
  timeRecordEventMessageId: { type: 'string', description: 'timeRecordEventMessageId' },
  timeRecordId: { type: 'string', description: 'timeRecordId', nullable: true },
  timeBldgBlkVersion: { type: 'number', description: 'timeBldgBlkVersion', nullable: true },
  messageId: { type: 'string', description: 'messageId', nullable: true },
  messageName: { type: 'string', description: 'messageName', nullable: true },
  messageField: { type: 'string', description: 'messageField', nullable: true },
  attributeType: { type: 'string', description: 'attributeType', nullable: true },
  allowException: { type: 'string', description: 'allowException', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export const ORACLE_FUSION_HCM_LIST_PAYROLL_RELATIONSHIPS_OUTPUTS = {
  payrollRelationships: {
    type: 'array',
    description: 'Payroll Relationship records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_RELATIONSHIP_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollRelationshipsParams = Omit<
  Schemas.OracleFusionHcmListPayrollRelationshipsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollRelationshipsResponse =
  Schemas.OracleFusionHcmListPayrollRelationshipsResponse

export const ORACLE_FUSION_HCM_GET_PAYROLL_RELATIONSHIP_OUTPUTS = {
  payrollRelationship: {
    type: 'object',
    description: 'Payroll Relationship',
    properties: ORACLE_FUSION_HCM_PAYROLL_RELATIONSHIP_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetPayrollRelationshipParams = Omit<
  Schemas.OracleFusionHcmGetPayrollRelationshipBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetPayrollRelationshipResponse =
  Schemas.OracleFusionHcmGetPayrollRelationshipResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_ASSIGNMENTS_OUTPUTS = {
  payrollAssignments: {
    type: 'array',
    description: 'Payroll Assignment records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_ASSIGNMENT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollAssignmentsParams = Omit<
  Schemas.OracleFusionHcmListPayrollAssignmentsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollAssignmentsResponse =
  Schemas.OracleFusionHcmListPayrollAssignmentsResponse

export const ORACLE_FUSION_HCM_GET_PAYROLL_ASSIGNMENT_OUTPUTS = {
  payrollAssignment: {
    type: 'object',
    description: 'Payroll Assignment',
    properties: ORACLE_FUSION_HCM_PAYROLL_ASSIGNMENT_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetPayrollAssignmentParams = Omit<
  Schemas.OracleFusionHcmGetPayrollAssignmentBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetPayrollAssignmentResponse =
  Schemas.OracleFusionHcmGetPayrollAssignmentResponse

export const ORACLE_FUSION_HCM_LIST_ASSIGNED_PAYROLLS_OUTPUTS = {
  assignedPayrolls: {
    type: 'array',
    description: 'Assigned Payroll records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_ASSIGNED_PAYROLL_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListAssignedPayrollsParams = Omit<
  Schemas.OracleFusionHcmListAssignedPayrollsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListAssignedPayrollsResponse =
  Schemas.OracleFusionHcmListAssignedPayrollsResponse

export const ORACLE_FUSION_HCM_GET_ASSIGNED_PAYROLL_OUTPUTS = {
  assignedPayroll: {
    type: 'object',
    description: 'Assigned Payroll',
    properties: ORACLE_FUSION_HCM_ASSIGNED_PAYROLL_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetAssignedPayrollParams = Omit<
  Schemas.OracleFusionHcmGetAssignedPayrollBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetAssignedPayrollResponse =
  Schemas.OracleFusionHcmGetAssignedPayrollResponse

export const ORACLE_FUSION_HCM_CREATE_ASSIGNED_PAYROLL_OUTPUTS = {
  assignedPayroll: {
    type: 'object',
    description: 'Assigned Payroll',
    properties: ORACLE_FUSION_HCM_ASSIGNED_PAYROLL_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmCreateAssignedPayrollParams = Omit<
  Schemas.OracleFusionHcmCreateAssignedPayrollBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmCreateAssignedPayrollResponse =
  Schemas.OracleFusionHcmCreateAssignedPayrollResponse

export const ORACLE_FUSION_HCM_UPDATE_ASSIGNED_PAYROLL_OUTPUTS = {
  assignedPayroll: {
    type: 'object',
    description: 'Assigned Payroll',
    properties: ORACLE_FUSION_HCM_ASSIGNED_PAYROLL_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmUpdateAssignedPayrollParams = Omit<
  Schemas.OracleFusionHcmUpdateAssignedPayrollBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmUpdateAssignedPayrollResponse =
  Schemas.OracleFusionHcmUpdateAssignedPayrollResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_DEFINITIONS_OUTPUTS = {
  payrollDefinitions: {
    type: 'array',
    description: 'Payroll Definition records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_DEFINITION_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollDefinitionsParams = Omit<
  Schemas.OracleFusionHcmListPayrollDefinitionsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollDefinitionsResponse =
  Schemas.OracleFusionHcmListPayrollDefinitionsResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_TIME_PERIODS_OUTPUTS = {
  payrollTimePeriods: {
    type: 'array',
    description: 'Payroll Time Period records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_TIME_PERIOD_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollTimePeriodsParams = Omit<
  Schemas.OracleFusionHcmListPayrollTimePeriodsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollTimePeriodsResponse =
  Schemas.OracleFusionHcmListPayrollTimePeriodsResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_ELEMENT_DEFINITIONS_OUTPUTS = {
  payrollElementDefinitions: {
    type: 'array',
    description: 'Payroll Element Definition records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_PAYROLL_ELEMENT_DEFINITION_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollElementDefinitionsParams = Omit<
  Schemas.OracleFusionHcmListPayrollElementDefinitionsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollElementDefinitionsResponse =
  Schemas.OracleFusionHcmListPayrollElementDefinitionsResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_INPUT_VALUES_OUTPUTS = {
  payrollInputValues: {
    type: 'array',
    description: 'Payroll Input Value records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_INPUT_VALUE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollInputValuesParams = Omit<
  Schemas.OracleFusionHcmListPayrollInputValuesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollInputValuesResponse =
  Schemas.OracleFusionHcmListPayrollInputValuesResponse

export const ORACLE_FUSION_HCM_LIST_ELEMENT_ENTRIES_OUTPUTS = {
  elementEntries: {
    type: 'array',
    description: 'Element Entry records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_ELEMENT_ENTRY_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListElementEntriesParams = Omit<
  Schemas.OracleFusionHcmListElementEntriesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListElementEntriesResponse =
  Schemas.OracleFusionHcmListElementEntriesResponse

export const ORACLE_FUSION_HCM_GET_ELEMENT_ENTRY_OUTPUTS = {
  elementEntry: {
    type: 'object',
    description: 'Element Entry',
    properties: ORACLE_FUSION_HCM_ELEMENT_ENTRY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetElementEntryParams = Omit<
  Schemas.OracleFusionHcmGetElementEntryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetElementEntryResponse = Schemas.OracleFusionHcmGetElementEntryResponse

export const ORACLE_FUSION_HCM_LIST_ELEMENT_ENTRY_VALUES_OUTPUTS = {
  elementEntryValues: {
    type: 'array',
    description: 'Element Entry Value records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_ELEMENT_ENTRY_VALUE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListElementEntryValuesParams = Omit<
  Schemas.OracleFusionHcmListElementEntryValuesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListElementEntryValuesResponse =
  Schemas.OracleFusionHcmListElementEntryValuesResponse

export const ORACLE_FUSION_HCM_CREATE_ELEMENT_ENTRY_OUTPUTS = {
  elementEntry: {
    type: 'object',
    description: 'Element Entry',
    properties: ORACLE_FUSION_HCM_ELEMENT_ENTRY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmCreateElementEntryParams = Omit<
  Schemas.OracleFusionHcmCreateElementEntryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmCreateElementEntryResponse =
  Schemas.OracleFusionHcmCreateElementEntryResponse

export const ORACLE_FUSION_HCM_UPDATE_ELEMENT_ENTRY_VALUE_OUTPUTS = {
  elementEntryValue: {
    type: 'object',
    description: 'Element Entry Value',
    properties: ORACLE_FUSION_HCM_ELEMENT_ENTRY_VALUE_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmUpdateElementEntryValueParams = Omit<
  Schemas.OracleFusionHcmUpdateElementEntryValueBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmUpdateElementEntryValueResponse =
  Schemas.OracleFusionHcmUpdateElementEntryValueResponse

export const ORACLE_FUSION_HCM_LIST_PERSON_PROCESS_RESULTS_OUTPUTS = {
  personProcessResults: {
    type: 'array',
    description: 'Person Process Result records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_PERSON_PROCESS_RESULT_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPersonProcessResultsParams = Omit<
  Schemas.OracleFusionHcmListPersonProcessResultsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPersonProcessResultsResponse =
  Schemas.OracleFusionHcmListPersonProcessResultsResponse

export const ORACLE_FUSION_HCM_GET_PERSON_PROCESS_RESULT_OUTPUTS = {
  personProcessResult: {
    type: 'object',
    description: 'Person Process Result',
    properties: ORACLE_FUSION_HCM_PERSON_PROCESS_RESULT_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetPersonProcessResultParams = Omit<
  Schemas.OracleFusionHcmGetPersonProcessResultBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetPersonProcessResultResponse =
  Schemas.OracleFusionHcmGetPersonProcessResultResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_RUN_RESULTS_OUTPUTS = {
  payrollRunResults: {
    type: 'array',
    description: 'Payroll Run Result records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_RUN_RESULT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollRunResultsParams = Omit<
  Schemas.OracleFusionHcmListPayrollRunResultsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollRunResultsResponse =
  Schemas.OracleFusionHcmListPayrollRunResultsResponse

export const ORACLE_FUSION_HCM_LIST_PAYROLL_BALANCES_OUTPUTS = {
  payrollBalances: {
    type: 'array',
    description: 'Payroll Balance records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PAYROLL_BALANCE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPayrollBalancesParams = Omit<
  Schemas.OracleFusionHcmListPayrollBalancesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPayrollBalancesResponse =
  Schemas.OracleFusionHcmListPayrollBalancesResponse

export const ORACLE_FUSION_HCM_LIST_SALARIES_OUTPUTS = {
  salaries: {
    type: 'array',
    description: 'Salary records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_SALARY_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListSalariesParams = Omit<
  Schemas.OracleFusionHcmListSalariesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListSalariesResponse = Schemas.OracleFusionHcmListSalariesResponse

export const ORACLE_FUSION_HCM_GET_SALARY_OUTPUTS = {
  salary: {
    type: 'object',
    description: 'Salary',
    properties: ORACLE_FUSION_HCM_SALARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetSalaryParams = Omit<
  Schemas.OracleFusionHcmGetSalaryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetSalaryResponse = Schemas.OracleFusionHcmGetSalaryResponse

export const ORACLE_FUSION_HCM_CREATE_SALARY_OUTPUTS = {
  salary: {
    type: 'object',
    description: 'Salary',
    properties: ORACLE_FUSION_HCM_SALARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmCreateSalaryParams = Omit<
  Schemas.OracleFusionHcmCreateSalaryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmCreateSalaryResponse = Schemas.OracleFusionHcmCreateSalaryResponse

export const ORACLE_FUSION_HCM_CORRECT_SALARY_OUTPUTS = {
  salary: {
    type: 'object',
    description: 'Salary',
    properties: ORACLE_FUSION_HCM_SALARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmCorrectSalaryParams = Omit<
  Schemas.OracleFusionHcmCorrectSalaryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmCorrectSalaryResponse = Schemas.OracleFusionHcmCorrectSalaryResponse

export const ORACLE_FUSION_HCM_LIST_SALARY_BASES_OUTPUTS = {
  salaryBases: {
    type: 'array',
    description: 'Salary Basis records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_SALARY_BASIS_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListSalaryBasesParams = Omit<
  Schemas.OracleFusionHcmListSalaryBasesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListSalaryBasesResponse = Schemas.OracleFusionHcmListSalaryBasesResponse

export const ORACLE_FUSION_HCM_LIST_SALARY_COMPONENTS_OUTPUTS = {
  componentKind: { type: 'string', description: 'Selected component family' },
  standardComponents: {
    type: 'array',
    description: 'StandardSalaryComponent records; empty when another component family is selected',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_STANDARD_SALARY_COMPONENT_OUTPUT_PROPERTIES,
    },
  },
  simpleComponents: {
    type: 'array',
    description: 'SimpleSalaryComponent records; empty when another component family is selected',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_SIMPLE_SALARY_COMPONENT_OUTPUT_PROPERTIES,
    },
  },
  rateComponents: {
    type: 'array',
    description: 'RateSalaryComponent records; empty when another component family is selected',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_RATE_SALARY_COMPONENT_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListSalaryComponentsParams = Omit<
  Schemas.OracleFusionHcmListSalaryComponentsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListSalaryComponentsResponse =
  Schemas.OracleFusionHcmListSalaryComponentsResponse

export const ORACLE_FUSION_HCM_LIST_GRADE_RATE_VALUES_OUTPUTS = {
  gradeRateValues: {
    type: 'array',
    description: 'Grade Rate Value records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_GRADE_RATE_VALUE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListGradeRateValuesParams = Omit<
  Schemas.OracleFusionHcmListGradeRateValuesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListGradeRateValuesResponse =
  Schemas.OracleFusionHcmListGradeRateValuesResponse

export const ORACLE_FUSION_HCM_LIST_GOAL_PLANS_OUTPUTS = {
  goalPlans: {
    type: 'array',
    description: 'Goal Plan records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_GOAL_PLAN_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListGoalPlansParams = Omit<
  Schemas.OracleFusionHcmListGoalPlansBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListGoalPlansResponse = Schemas.OracleFusionHcmListGoalPlansResponse

export const ORACLE_FUSION_HCM_GET_GOAL_PLAN_OUTPUTS = {
  goalPlan: {
    type: 'object',
    description: 'Goal Plan',
    properties: ORACLE_FUSION_HCM_GOAL_PLAN_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetGoalPlanParams = Omit<
  Schemas.OracleFusionHcmGetGoalPlanBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetGoalPlanResponse = Schemas.OracleFusionHcmGetGoalPlanResponse

export const ORACLE_FUSION_HCM_LIST_PERFORMANCE_GOALS_OUTPUTS = {
  performanceGoals: {
    type: 'array',
    description: 'Performance Goal records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PERFORMANCE_GOAL_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPerformanceGoalsParams = Omit<
  Schemas.OracleFusionHcmListPerformanceGoalsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPerformanceGoalsResponse =
  Schemas.OracleFusionHcmListPerformanceGoalsResponse

export const ORACLE_FUSION_HCM_GET_PERFORMANCE_GOAL_OUTPUTS = {
  performanceGoal: {
    type: 'object',
    description: 'Performance Goal',
    properties: ORACLE_FUSION_HCM_PERFORMANCE_GOAL_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetPerformanceGoalParams = Omit<
  Schemas.OracleFusionHcmGetPerformanceGoalBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetPerformanceGoalResponse =
  Schemas.OracleFusionHcmGetPerformanceGoalResponse

export const ORACLE_FUSION_HCM_LIST_DEVELOPMENT_GOALS_OUTPUTS = {
  developmentGoals: {
    type: 'array',
    description: 'Development Goal records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_DEVELOPMENT_GOAL_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListDevelopmentGoalsParams = Omit<
  Schemas.OracleFusionHcmListDevelopmentGoalsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListDevelopmentGoalsResponse =
  Schemas.OracleFusionHcmListDevelopmentGoalsResponse

export const ORACLE_FUSION_HCM_GET_DEVELOPMENT_GOAL_OUTPUTS = {
  developmentGoal: {
    type: 'object',
    description: 'Development Goal',
    properties: ORACLE_FUSION_HCM_DEVELOPMENT_GOAL_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetDevelopmentGoalParams = Omit<
  Schemas.OracleFusionHcmGetDevelopmentGoalBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetDevelopmentGoalResponse =
  Schemas.OracleFusionHcmGetDevelopmentGoalResponse

export const ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENTS_OUTPUTS = {
  performanceDocuments: {
    type: 'array',
    description: 'Performance Document records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPerformanceDocumentsParams = Omit<
  Schemas.OracleFusionHcmListPerformanceDocumentsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPerformanceDocumentsResponse =
  Schemas.OracleFusionHcmListPerformanceDocumentsResponse

export const ORACLE_FUSION_HCM_GET_PERFORMANCE_DOCUMENT_OUTPUTS = {
  performanceDocument: {
    type: 'object',
    description: 'Performance Document',
    properties: ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetPerformanceDocumentParams = Omit<
  Schemas.OracleFusionHcmGetPerformanceDocumentBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetPerformanceDocumentResponse =
  Schemas.OracleFusionHcmGetPerformanceDocumentResponse

export const ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_ROLES_OUTPUTS = {
  performanceDocumentRoles: {
    type: 'array',
    description: 'Performance Document Role records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_ROLE_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPerformanceDocumentRolesParams = Omit<
  Schemas.OracleFusionHcmListPerformanceDocumentRolesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPerformanceDocumentRolesResponse =
  Schemas.OracleFusionHcmListPerformanceDocumentRolesResponse

export const ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_PARTICIPANTS_OUTPUTS = {
  performanceDocumentParticipants: {
    type: 'array',
    description: 'Performance Document Participant records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_PARTICIPANT_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPerformanceDocumentParticipantsParams = Omit<
  Schemas.OracleFusionHcmListPerformanceDocumentParticipantsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPerformanceDocumentParticipantsResponse =
  Schemas.OracleFusionHcmListPerformanceDocumentParticipantsResponse

export const ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_TASKS_OUTPUTS = {
  performanceDocumentTasks: {
    type: 'array',
    description: 'Performance Document Task records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_PERFORMANCE_DOCUMENT_TASK_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListPerformanceDocumentTasksParams = Omit<
  Schemas.OracleFusionHcmListPerformanceDocumentTasksBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListPerformanceDocumentTasksResponse =
  Schemas.OracleFusionHcmListPerformanceDocumentTasksResponse

export const ORACLE_FUSION_HCM_LIST_TALENT_PROFILES_OUTPUTS = {
  talentProfiles: {
    type: 'array',
    description: 'Talent Profile records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_TALENT_PROFILE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTalentProfilesParams = Omit<
  Schemas.OracleFusionHcmListTalentProfilesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTalentProfilesResponse =
  Schemas.OracleFusionHcmListTalentProfilesResponse

export const ORACLE_FUSION_HCM_GET_TALENT_PROFILE_OUTPUTS = {
  talentProfile: {
    type: 'object',
    description: 'Talent Profile',
    properties: ORACLE_FUSION_HCM_TALENT_PROFILE_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetTalentProfileParams = Omit<
  Schemas.OracleFusionHcmGetTalentProfileBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetTalentProfileResponse =
  Schemas.OracleFusionHcmGetTalentProfileResponse

export const ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_SECTIONS_OUTPUTS = {
  talentProfileSections: {
    type: 'array',
    description: 'Talent Profile Section records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_TALENT_PROFILE_SECTION_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTalentProfileSectionsParams = Omit<
  Schemas.OracleFusionHcmListTalentProfileSectionsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTalentProfileSectionsResponse =
  Schemas.OracleFusionHcmListTalentProfileSectionsResponse

export const ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_SKILLS_OUTPUTS = {
  talentProfileSkills: {
    type: 'array',
    description: 'Talent Profile Skill records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_TALENT_PROFILE_SKILL_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTalentProfileSkillsParams = Omit<
  Schemas.OracleFusionHcmListTalentProfileSkillsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTalentProfileSkillsResponse =
  Schemas.OracleFusionHcmListTalentProfileSkillsResponse

export const ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_CERTIFICATIONS_OUTPUTS = {
  talentProfileCertifications: {
    type: 'array',
    description: 'Talent Profile Certification records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_TALENT_PROFILE_CERTIFICATION_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTalentProfileCertificationsParams = Omit<
  Schemas.OracleFusionHcmListTalentProfileCertificationsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTalentProfileCertificationsResponse =
  Schemas.OracleFusionHcmListTalentProfileCertificationsResponse

export const ORACLE_FUSION_HCM_LIST_TIME_RECORDS_OUTPUTS = {
  timeRecords: {
    type: 'array',
    description: 'Time Record records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_TIME_RECORD_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeRecordsParams = Omit<
  Schemas.OracleFusionHcmListTimeRecordsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeRecordsResponse = Schemas.OracleFusionHcmListTimeRecordsResponse

export const ORACLE_FUSION_HCM_GET_TIME_RECORD_OUTPUTS = {
  timeRecord: {
    type: 'object',
    description: 'Time Record',
    properties: ORACLE_FUSION_HCM_TIME_RECORD_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetTimeRecordParams = Omit<
  Schemas.OracleFusionHcmGetTimeRecordBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetTimeRecordResponse = Schemas.OracleFusionHcmGetTimeRecordResponse

export const ORACLE_FUSION_HCM_LIST_TIME_CARDS_OUTPUTS = {
  timeCards: {
    type: 'array',
    description: 'Time Card records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_TIME_CARD_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeCardsParams = Omit<
  Schemas.OracleFusionHcmListTimeCardsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeCardsResponse = Schemas.OracleFusionHcmListTimeCardsResponse

export const ORACLE_FUSION_HCM_GET_TIME_CARD_OUTPUTS = {
  timeCard: {
    type: 'object',
    description: 'Time Card',
    properties: ORACLE_FUSION_HCM_TIME_CARD_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetTimeCardParams = Omit<
  Schemas.OracleFusionHcmGetTimeCardBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetTimeCardResponse = Schemas.OracleFusionHcmGetTimeCardResponse

export const ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTES_OUTPUTS = {
  timeAttributes: {
    type: 'array',
    description: 'Time Attribute records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_TIME_ATTRIBUTE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeAttributesParams = Omit<
  Schemas.OracleFusionHcmListTimeAttributesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeAttributesResponse =
  Schemas.OracleFusionHcmListTimeAttributesResponse

export const ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_DATA_SOURCES_OUTPUTS = {
  timeAttributeDataSources: {
    type: 'array',
    description: 'Time Attribute Data Source records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_TIME_ATTRIBUTE_DATA_SOURCE_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeAttributeDataSourcesParams = Omit<
  Schemas.OracleFusionHcmListTimeAttributeDataSourcesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeAttributeDataSourcesResponse =
  Schemas.OracleFusionHcmListTimeAttributeDataSourcesResponse

export const ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_CRITERIA_BINDS_OUTPUTS = {
  timeAttributeCriteriaBinds: {
    type: 'array',
    description: 'Time Attribute Criteria Bind records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_TIME_ATTRIBUTE_CRITERIA_BIND_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeAttributeCriteriaBindsParams = Omit<
  Schemas.OracleFusionHcmListTimeAttributeCriteriaBindsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeAttributeCriteriaBindsResponse =
  Schemas.OracleFusionHcmListTimeAttributeCriteriaBindsResponse

export const ORACLE_FUSION_HCM_LIST_TIME_ATTRIBUTE_VALUES_OUTPUTS = {
  timeAttributeValues: {
    type: 'array',
    description: 'Time Attribute Value records',
    items: { type: 'object', properties: ORACLE_FUSION_HCM_TIME_ATTRIBUTE_VALUE_OUTPUT_PROPERTIES },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeAttributeValuesParams = Omit<
  Schemas.OracleFusionHcmListTimeAttributeValuesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeAttributeValuesResponse =
  Schemas.OracleFusionHcmListTimeAttributeValuesResponse

export const ORACLE_FUSION_HCM_CREATE_TIME_ENTRY_OUTPUTS = {
  timeRecordRequest: {
    type: 'object',
    description: 'Time Record Request',
    properties: ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmCreateTimeEntryParams = Omit<
  Schemas.OracleFusionHcmCreateTimeEntryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmCreateTimeEntryResponse = Schemas.OracleFusionHcmCreateTimeEntryResponse

export const ORACLE_FUSION_HCM_UPDATE_TIME_ENTRY_OUTPUTS = {
  timeRecordRequest: {
    type: 'object',
    description: 'Time Record Request',
    properties: ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmUpdateTimeEntryParams = Omit<
  Schemas.OracleFusionHcmUpdateTimeEntryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmUpdateTimeEntryResponse = Schemas.OracleFusionHcmUpdateTimeEntryResponse

export const ORACLE_FUSION_HCM_DELETE_TIME_ENTRY_OUTPUTS = {
  timeRecordRequest: {
    type: 'object',
    description: 'Time Record Request',
    properties: ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmDeleteTimeEntryParams = Omit<
  Schemas.OracleFusionHcmDeleteTimeEntryBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmDeleteTimeEntryResponse = Schemas.OracleFusionHcmDeleteTimeEntryResponse

export const ORACLE_FUSION_HCM_GET_TIME_RECORD_REQUEST_OUTPUTS = {
  timeRecordRequest: {
    type: 'object',
    description: 'Time Record Request',
    properties: ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmGetTimeRecordRequestParams = Omit<
  Schemas.OracleFusionHcmGetTimeRecordRequestBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmGetTimeRecordRequestResponse =
  Schemas.OracleFusionHcmGetTimeRecordRequestResponse

export const ORACLE_FUSION_HCM_LIST_TIME_RECORD_REQUEST_EVENTS_OUTPUTS = {
  timeRecordRequestEvents: {
    type: 'array',
    description: 'Time Record Request Event records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_TIME_RECORD_REQUEST_EVENT_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeRecordRequestEventsParams = Omit<
  Schemas.OracleFusionHcmListTimeRecordRequestEventsBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeRecordRequestEventsResponse =
  Schemas.OracleFusionHcmListTimeRecordRequestEventsResponse

export const ORACLE_FUSION_HCM_LIST_TIME_RECORD_EVENT_MESSAGES_OUTPUTS = {
  timeRecordEventMessages: {
    type: 'array',
    description: 'Time Record Event Message records',
    items: {
      type: 'object',
      properties: ORACLE_FUSION_HCM_TIME_RECORD_EVENT_MESSAGE_OUTPUT_PROPERTIES,
    },
  },
  ...ORACLE_FUSION_HCM_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type OracleFusionHcmListTimeRecordEventMessagesParams = Omit<
  Schemas.OracleFusionHcmListTimeRecordEventMessagesBodyInput,
  'accessToken' | 'instanceUrl'
> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type OracleFusionHcmListTimeRecordEventMessagesResponse =
  Schemas.OracleFusionHcmListTimeRecordEventMessagesResponse
