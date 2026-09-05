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
