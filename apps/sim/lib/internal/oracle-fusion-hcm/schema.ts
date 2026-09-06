import { z } from 'zod'

export const oracleFusionHcmDecimalIdSchema = z
  .string()
  .trim()
  .min(1, 'ID is required')
  .max(19, 'ID must be at most 19 digits')
  .regex(/^[1-9]\d*$/, 'ID must be a positive decimal string')
  .refine(
    (value) => !/^[1-9]\d*$/.test(value) || BigInt(value) <= 9_223_372_036_854_775_807n,
    'ID exceeds int64 range'
  )

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Date must be a valid calendar date')

const searchSchema = z.string().trim().min(1).max(200).optional()

const oracleFusionHcmBaseBodySchema = z.object({
  instanceUrl: z.string().trim().min(1).max(2048),
  accessToken: z.string().min(1).max(4096),
})

const paginationBodyShape = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}

const searchableListBodySchema = oracleFusionHcmBaseBodySchema.extend({
  search: searchSchema,
  effectiveDate: dateSchema.optional(),
  ...paginationBodyShape,
})

const nullableStringSchema = z.string().nullable()
const nullableBooleanSchema = z.boolean().nullable()
const nullableNumberSchema = z.number().finite().nullable()

export const oracleFusionHcmWorkerSchema = z.object({
  personId: z.string(),
  personNumber: nullableStringSchema,
  displayName: nullableStringSchema,
  fullName: nullableStringSchema,
  firstName: nullableStringSchema,
  lastName: nullableStringSchema,
  knownAs: nullableStringSchema,
  workEmail: nullableStringSchema,
  username: nullableStringSchema,
})

export const oracleFusionHcmAssignmentSchema = z.object({
  assignmentId: z.string(),
  assignmentNumber: nullableStringSchema,
  assignmentName: nullableStringSchema,
  startDate: nullableStringSchema,
  primaryFlag: nullableBooleanSchema,
  primaryAssignmentFlag: nullableBooleanSchema,
  workerType: nullableStringSchema,
  workerNumber: nullableStringSchema,
  fullPartTime: nullableStringSchema,
  legalEmployerName: nullableStringSchema,
  businessUnitName: nullableStringSchema,
  departmentName: nullableStringSchema,
  jobCode: nullableStringSchema,
  jobName: nullableStringSchema,
  positionCode: nullableStringSchema,
  positionName: nullableStringSchema,
  locationCode: nullableStringSchema,
  locationName: nullableStringSchema,
  managerName: nullableStringSchema,
})

export const oracleFusionHcmManagerSchema = z.object({
  assignmentSupervisorId: z.string(),
  managerAssignmentId: nullableStringSchema,
  managerAssignmentNumber: nullableStringSchema,
  managerAssignmentName: nullableStringSchema,
  managerPersonId: nullableStringSchema,
  managerPersonNumber: nullableStringSchema,
  displayName: nullableStringSchema,
  firstName: nullableStringSchema,
  knownAs: nullableStringSchema,
  lastName: nullableStringSchema,
  managerType: nullableStringSchema,
  managerTypeMeaning: nullableStringSchema,
  jobCode: nullableStringSchema,
  jobName: nullableStringSchema,
  positionCode: nullableStringSchema,
  positionName: nullableStringSchema,
  workEmail: nullableStringSchema,
})

export const oracleFusionHcmDirectReportSchema = z.object({
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  assignmentName: nullableStringSchema,
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  displayName: nullableStringSchema,
  firstName: nullableStringSchema,
  knownAs: nullableStringSchema,
  lastName: nullableStringSchema,
  relationshipType: nullableStringSchema,
  relationshipTypeMeaning: nullableStringSchema,
  workerType: nullableStringSchema,
  directReportsCount: nullableNumberSchema,
  allReportsCount: nullableNumberSchema,
})

export const oracleFusionHcmAbsenceSchema = z.object({
  absenceId: z.string(),
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  absenceTypeId: nullableStringSchema,
  absenceType: nullableStringSchema,
  absenceStatusCode: nullableStringSchema,
  displayStatus: nullableStringSchema,
  displayStatusMeaning: nullableStringSchema,
  approvalStatusCode: nullableStringSchema,
  assignmentId: nullableStringSchema,
  assignmentName: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  startDate: nullableStringSchema,
  startTime: nullableStringSchema,
  endDate: nullableStringSchema,
  endTime: nullableStringSchema,
  duration: nullableNumberSchema,
  formattedDuration: nullableStringSchema,
  unitOfMeasure: nullableStringSchema,
  unitOfMeasureMeaning: nullableStringSchema,
  openEndedFlag: nullableBooleanSchema,
  singleDayFlag: nullableBooleanSchema,
  employer: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmAbsenceTypeSchema = z.object({
  absenceTypeId: z.string(),
  name: nullableStringSchema,
  nameWithEmployer: nullableStringSchema,
  description: nullableStringSchema,
  employerId: nullableStringSchema,
  employerName: nullableStringSchema,
  durationCalculationBasis: nullableStringSchema,
  durationUomCode: nullableStringSchema,
  durationUomMeaning: nullableStringSchema,
  displaySequence: nullableNumberSchema,
})

export const oracleFusionHcmJobSchema = z.object({
  jobId: z.string(),
  jobCode: nullableStringSchema,
  name: nullableStringSchema,
  activeStatus: nullableStringSchema,
  jobFamilyId: nullableStringSchema,
  jobFunctionCode: nullableStringSchema,
  managerLevel: nullableStringSchema,
  regularTemporary: nullableStringSchema,
  fullPartTime: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmJobFamilySchema = z.object({
  jobFamilyId: z.string(),
  jobFamilyCode: nullableStringSchema,
  name: nullableStringSchema,
  activeStatus: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmDepartmentSchema = z.object({
  organizationId: z.string(),
  organizationCode: nullableStringSchema,
  name: nullableStringSchema,
  classificationCode: nullableStringSchema,
  status: nullableStringSchema,
  locationId: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmLocationSchema = z.object({
  locationId: z.string(),
  locationCode: nullableStringSchema,
  name: nullableStringSchema,
  description: nullableStringSchema,
  activeStatus: nullableStringSchema,
  country: nullableStringSchema,
  townOrCity: nullableStringSchema,
  region1: nullableStringSchema,
  region2: nullableStringSchema,
  region3: nullableStringSchema,
  postalCode: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmPositionSchema = z.object({
  positionId: z.string(),
  positionCode: nullableStringSchema,
  name: nullableStringSchema,
  activeStatus: nullableStringSchema,
  positionType: nullableStringSchema,
  jobId: nullableStringSchema,
  departmentId: nullableStringSchema,
  locationId: nullableStringSchema,
  businessUnitId: nullableStringSchema,
  regularTemporary: nullableStringSchema,
  fullPartTime: nullableStringSchema,
  hiringStatus: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmBusinessUnitSchema = z.object({
  businessUnitId: z.string(),
  name: nullableStringSchema,
  status: nullableStringSchema,
})

export const oracleFusionHcmLegalEmployerSchema = z.object({
  organizationId: z.string(),
  name: nullableStringSchema,
  legislationCode: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
})

export const oracleFusionHcmGradeSchema = z.object({
  gradeId: z.string(),
  gradeCode: nullableStringSchema,
  name: nullableStringSchema,
  activeStatus: nullableStringSchema,
  categoryCode: nullableStringSchema,
  setId: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lastUpdateDate: nullableStringSchema,
})

export const oracleFusionHcmPersonTypeSchema = z.object({
  personTypeId: z.string(),
  systemPersonType: nullableStringSchema,
  userPersonType: nullableStringSchema,
  activeFlag: nullableBooleanSchema,
  defaultFlag: nullableBooleanSchema,
})

const paginationResponseShape = {
  count: z.number().int().min(0),
  hasMore: z.boolean(),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
  totalResults: z.number().int().min(0).optional(),
  nextOffset: z.number().int().min(0).optional(),
}

const successResponse = <T extends z.ZodType>(output: T) =>
  z.object({ success: z.literal(true), output })

export const workerResponseSchema = successResponse(
  z.object({ worker: oracleFusionHcmWorkerSchema })
)
export const workersResponseSchema = successResponse(
  z.object({ workers: z.array(oracleFusionHcmWorkerSchema), ...paginationResponseShape })
)
export const assignmentResponseSchema = successResponse(
  z.object({ assignment: oracleFusionHcmAssignmentSchema })
)
export const assignmentsResponseSchema = successResponse(
  z.object({ assignments: z.array(oracleFusionHcmAssignmentSchema), ...paginationResponseShape })
)
export const managersResponseSchema = successResponse(
  z.object({ managers: z.array(oracleFusionHcmManagerSchema), ...paginationResponseShape })
)
export const directReportsResponseSchema = successResponse(
  z.object({
    directReports: z.array(oracleFusionHcmDirectReportSchema),
    ...paginationResponseShape,
  })
)
export const absenceResponseSchema = successResponse(
  z.object({ absence: oracleFusionHcmAbsenceSchema })
)
export const absencesResponseSchema = successResponse(
  z.object({ absences: z.array(oracleFusionHcmAbsenceSchema), ...paginationResponseShape })
)
export const absenceTypesResponseSchema = successResponse(
  z.object({ absenceTypes: z.array(oracleFusionHcmAbsenceTypeSchema), ...paginationResponseShape })
)
export const jobsResponseSchema = successResponse(
  z.object({ jobs: z.array(oracleFusionHcmJobSchema), ...paginationResponseShape })
)
export const jobFamiliesResponseSchema = successResponse(
  z.object({ jobFamilies: z.array(oracleFusionHcmJobFamilySchema), ...paginationResponseShape })
)
export const departmentsResponseSchema = successResponse(
  z.object({ departments: z.array(oracleFusionHcmDepartmentSchema), ...paginationResponseShape })
)
export const locationsResponseSchema = successResponse(
  z.object({ locations: z.array(oracleFusionHcmLocationSchema), ...paginationResponseShape })
)
export const positionsResponseSchema = successResponse(
  z.object({ positions: z.array(oracleFusionHcmPositionSchema), ...paginationResponseShape })
)
export const businessUnitsResponseSchema = successResponse(
  z.object({
    businessUnits: z.array(oracleFusionHcmBusinessUnitSchema),
    ...paginationResponseShape,
  })
)
export const legalEmployersResponseSchema = successResponse(
  z.object({
    legalEmployers: z.array(oracleFusionHcmLegalEmployerSchema),
    ...paginationResponseShape,
  })
)
export const gradesResponseSchema = successResponse(
  z.object({ grades: z.array(oracleFusionHcmGradeSchema), ...paginationResponseShape })
)
export const personTypesResponseSchema = successResponse(
  z.object({ personTypes: z.array(oracleFusionHcmPersonTypeSchema), ...paginationResponseShape })
)

export const oracleFusionHcmListWorkersBodySchema = oracleFusionHcmBaseBodySchema.extend({
  search: searchSchema,
  ...paginationBodyShape,
})
export const oracleFusionHcmGetWorkerBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
})
export const oracleFusionHcmListWorkerAssignmentsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})
export const oracleFusionHcmGetWorkerAssignmentBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
  assignmentId: oracleFusionHcmDecimalIdSchema,
})
export const oracleFusionHcmListWorkerManagersBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
  assignmentId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})
export const oracleFusionHcmListWorkerDirectReportsBodySchema =
  oracleFusionHcmListWorkerManagersBodySchema

export const oracleFusionHcmListAbsencesBodySchema = oracleFusionHcmBaseBodySchema
  .extend({
    personId: oracleFusionHcmDecimalIdSchema,
    absenceTypeId: oracleFusionHcmDecimalIdSchema.optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    ...paginationBodyShape,
  })
  .superRefine((value, context) => {
    const hasStart = value.startDate !== undefined
    const hasEnd = value.endDate !== undefined
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasStart ? ['endDate'] : ['startDate'],
        message: 'startDate and endDate must be provided together',
      })
    }
    if ((hasStart || hasEnd) && !value.absenceTypeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['absenceTypeId'],
        message: 'absenceTypeId is required when filtering by date range',
      })
    }
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must be on or after startDate',
      })
    }
  })

export const oracleFusionHcmGetAbsenceBodySchema = oracleFusionHcmBaseBodySchema.extend({
  absenceId: oracleFusionHcmDecimalIdSchema,
})
export const oracleFusionHcmListAbsenceTypesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
  search: searchSchema,
  effectiveDate: dateSchema.optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListJobsBodySchema = searchableListBodySchema
export const oracleFusionHcmListJobFamiliesBodySchema = searchableListBodySchema
export const oracleFusionHcmListDepartmentsBodySchema = searchableListBodySchema
export const oracleFusionHcmListLocationsBodySchema = searchableListBodySchema
export const oracleFusionHcmListPositionsBodySchema = searchableListBodySchema
export const oracleFusionHcmListBusinessUnitsBodySchema = searchableListBodySchema.omit({
  effectiveDate: true,
})
export const oracleFusionHcmListLegalEmployersBodySchema = searchableListBodySchema
export const oracleFusionHcmListGradesBodySchema = searchableListBodySchema
export const oracleFusionHcmListPersonTypesBodySchema = searchableListBodySchema.omit({
  effectiveDate: true,
})

export type OracleFusionHcmWorker = z.infer<typeof oracleFusionHcmWorkerSchema>
export type OracleFusionHcmAssignment = z.infer<typeof oracleFusionHcmAssignmentSchema>
export type OracleFusionHcmManager = z.infer<typeof oracleFusionHcmManagerSchema>
export type OracleFusionHcmDirectReport = z.infer<typeof oracleFusionHcmDirectReportSchema>
export type OracleFusionHcmAbsence = z.infer<typeof oracleFusionHcmAbsenceSchema>
export type OracleFusionHcmAbsenceType = z.infer<typeof oracleFusionHcmAbsenceTypeSchema>
export type OracleFusionHcmJob = z.infer<typeof oracleFusionHcmJobSchema>
export type OracleFusionHcmJobFamily = z.infer<typeof oracleFusionHcmJobFamilySchema>
export type OracleFusionHcmDepartment = z.infer<typeof oracleFusionHcmDepartmentSchema>
export type OracleFusionHcmLocation = z.infer<typeof oracleFusionHcmLocationSchema>
export type OracleFusionHcmPosition = z.infer<typeof oracleFusionHcmPositionSchema>
export type OracleFusionHcmBusinessUnit = z.infer<typeof oracleFusionHcmBusinessUnitSchema>
export type OracleFusionHcmLegalEmployer = z.infer<typeof oracleFusionHcmLegalEmployerSchema>
export type OracleFusionHcmGrade = z.infer<typeof oracleFusionHcmGradeSchema>
export type OracleFusionHcmPersonType = z.infer<typeof oracleFusionHcmPersonTypeSchema>

export type OracleFusionHcmListWorkersBody = z.output<typeof oracleFusionHcmListWorkersBodySchema>
export type OracleFusionHcmListWorkersBodyInput = z.input<
  typeof oracleFusionHcmListWorkersBodySchema
>
export type OracleFusionHcmListWorkersResponse = z.output<typeof workersResponseSchema>
export type OracleFusionHcmGetWorkerBody = z.output<typeof oracleFusionHcmGetWorkerBodySchema>
export type OracleFusionHcmGetWorkerBodyInput = z.input<typeof oracleFusionHcmGetWorkerBodySchema>
export type OracleFusionHcmGetWorkerResponse = z.output<typeof workerResponseSchema>
export type OracleFusionHcmListWorkerAssignmentsBody = z.output<
  typeof oracleFusionHcmListWorkerAssignmentsBodySchema
>
export type OracleFusionHcmListWorkerAssignmentsBodyInput = z.input<
  typeof oracleFusionHcmListWorkerAssignmentsBodySchema
>
export type OracleFusionHcmListWorkerAssignmentsResponse = z.output<
  typeof assignmentsResponseSchema
>
export type OracleFusionHcmGetWorkerAssignmentBody = z.output<
  typeof oracleFusionHcmGetWorkerAssignmentBodySchema
>
export type OracleFusionHcmGetWorkerAssignmentBodyInput = z.input<
  typeof oracleFusionHcmGetWorkerAssignmentBodySchema
>
export type OracleFusionHcmGetWorkerAssignmentResponse = z.output<typeof assignmentResponseSchema>
export type OracleFusionHcmListWorkerManagersBody = z.output<
  typeof oracleFusionHcmListWorkerManagersBodySchema
>
export type OracleFusionHcmListWorkerManagersBodyInput = z.input<
  typeof oracleFusionHcmListWorkerManagersBodySchema
>
export type OracleFusionHcmListWorkerManagersResponse = z.output<typeof managersResponseSchema>
export type OracleFusionHcmListWorkerDirectReportsBody = z.output<
  typeof oracleFusionHcmListWorkerDirectReportsBodySchema
>
export type OracleFusionHcmListWorkerDirectReportsBodyInput = z.input<
  typeof oracleFusionHcmListWorkerDirectReportsBodySchema
>
export type OracleFusionHcmListWorkerDirectReportsResponse = z.output<
  typeof directReportsResponseSchema
>
export type OracleFusionHcmListAbsencesBody = z.output<typeof oracleFusionHcmListAbsencesBodySchema>
export type OracleFusionHcmListAbsencesBodyInput = z.input<
  typeof oracleFusionHcmListAbsencesBodySchema
>
export type OracleFusionHcmListAbsencesResponse = z.output<typeof absencesResponseSchema>
export type OracleFusionHcmGetAbsenceBody = z.output<typeof oracleFusionHcmGetAbsenceBodySchema>
export type OracleFusionHcmGetAbsenceBodyInput = z.input<typeof oracleFusionHcmGetAbsenceBodySchema>
export type OracleFusionHcmGetAbsenceResponse = z.output<typeof absenceResponseSchema>
export type OracleFusionHcmListAbsenceTypesBody = z.output<
  typeof oracleFusionHcmListAbsenceTypesBodySchema
>
export type OracleFusionHcmListAbsenceTypesBodyInput = z.input<
  typeof oracleFusionHcmListAbsenceTypesBodySchema
>
export type OracleFusionHcmListAbsenceTypesResponse = z.output<typeof absenceTypesResponseSchema>
export type OracleFusionHcmListJobsBody = z.output<typeof oracleFusionHcmListJobsBodySchema>
export type OracleFusionHcmListJobsBodyInput = z.input<typeof oracleFusionHcmListJobsBodySchema>
export type OracleFusionHcmListJobsResponse = z.output<typeof jobsResponseSchema>
export type OracleFusionHcmListJobFamiliesBody = z.output<
  typeof oracleFusionHcmListJobFamiliesBodySchema
>
export type OracleFusionHcmListJobFamiliesBodyInput = z.input<
  typeof oracleFusionHcmListJobFamiliesBodySchema
>
export type OracleFusionHcmListJobFamiliesResponse = z.output<typeof jobFamiliesResponseSchema>
export type OracleFusionHcmListDepartmentsBody = z.output<
  typeof oracleFusionHcmListDepartmentsBodySchema
>
export type OracleFusionHcmListDepartmentsBodyInput = z.input<
  typeof oracleFusionHcmListDepartmentsBodySchema
>
export type OracleFusionHcmListDepartmentsResponse = z.output<typeof departmentsResponseSchema>
export type OracleFusionHcmListLocationsBody = z.output<
  typeof oracleFusionHcmListLocationsBodySchema
>
export type OracleFusionHcmListLocationsBodyInput = z.input<
  typeof oracleFusionHcmListLocationsBodySchema
>
export type OracleFusionHcmListLocationsResponse = z.output<typeof locationsResponseSchema>
export type OracleFusionHcmListPositionsBody = z.output<
  typeof oracleFusionHcmListPositionsBodySchema
>
export type OracleFusionHcmListPositionsBodyInput = z.input<
  typeof oracleFusionHcmListPositionsBodySchema
>
export type OracleFusionHcmListPositionsResponse = z.output<typeof positionsResponseSchema>
export type OracleFusionHcmListBusinessUnitsBody = z.output<
  typeof oracleFusionHcmListBusinessUnitsBodySchema
>
export type OracleFusionHcmListBusinessUnitsBodyInput = z.input<
  typeof oracleFusionHcmListBusinessUnitsBodySchema
>
export type OracleFusionHcmListBusinessUnitsResponse = z.output<typeof businessUnitsResponseSchema>
export type OracleFusionHcmListLegalEmployersBody = z.output<
  typeof oracleFusionHcmListLegalEmployersBodySchema
>
export type OracleFusionHcmListLegalEmployersBodyInput = z.input<
  typeof oracleFusionHcmListLegalEmployersBodySchema
>
export type OracleFusionHcmListLegalEmployersResponse = z.output<
  typeof legalEmployersResponseSchema
>
export type OracleFusionHcmListGradesBody = z.output<typeof oracleFusionHcmListGradesBodySchema>
export type OracleFusionHcmListGradesBodyInput = z.input<typeof oracleFusionHcmListGradesBodySchema>
export type OracleFusionHcmListGradesResponse = z.output<typeof gradesResponseSchema>
export type OracleFusionHcmListPersonTypesBody = z.output<
  typeof oracleFusionHcmListPersonTypesBodySchema
>
export type OracleFusionHcmListPersonTypesBodyInput = z.input<
  typeof oracleFusionHcmListPersonTypesBodySchema
>
export type OracleFusionHcmListPersonTypesResponse = z.output<typeof personTypesResponseSchema>

export const oracleFusionHcmPayrollRelationshipSchema = z.object({
  payrollRelationshipId: z.string(),
  payrollRelationshipNumber: nullableStringSchema,
  personNumber: nullableStringSchema,
  country: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  startDate: nullableStringSchema,
  endDate: nullableStringSchema,
  overridingPeriodId: nullableStringSchema,
})

export type OracleFusionHcmPayrollRelationship = z.output<
  typeof oracleFusionHcmPayrollRelationshipSchema
>

export const oracleFusionHcmPayrollAssignmentSchema = z.object({
  payrollAssignmentId: z.string(),
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  overridingPeriodId: nullableStringSchema,
  timeCardRequired: nullableStringSchema,
})

export type OracleFusionHcmPayrollAssignment = z.output<
  typeof oracleFusionHcmPayrollAssignmentSchema
>

export const oracleFusionHcmAssignedPayrollSchema = z.object({
  assignedPayrollId: z.string(),
  payrollId: nullableStringSchema,
  payrollName: nullableStringSchema,
  startDate: nullableStringSchema,
  endDate: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  lsed: nullableStringSchema,
  overridingPeriodId: nullableStringSchema,
  timeCardRequired: nullableStringSchema,
})

export type OracleFusionHcmAssignedPayroll = z.output<typeof oracleFusionHcmAssignedPayrollSchema>

export const oracleFusionHcmPayrollDefinitionSchema = z.object({
  payrollId: z.string(),
  payrollName: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
  legislativeDataGroupName: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  periodType: nullableStringSchema,
  consolidationSetId: nullableStringSchema,
  consolidationSetName: nullableStringSchema,
  reportingName: nullableStringSchema,
})

export type OracleFusionHcmPayrollDefinition = z.output<
  typeof oracleFusionHcmPayrollDefinitionSchema
>

export const oracleFusionHcmPayrollTimePeriodSchema = z.object({
  timePeriodId: nullableStringSchema,
  payrollId: nullableStringSchema,
  payrollName: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
  periodName: nullableStringSchema,
  periodNumber: nullableNumberSchema,
  periodType: nullableStringSchema,
  periodCategory: nullableStringSchema,
  startDate: nullableStringSchema,
  endDate: nullableStringSchema,
  regularEarnDate: nullableStringSchema,
  regularProcessDate: nullableStringSchema,
  defaultPaydate: nullableStringSchema,
  payslipViewDate: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
})

export type OracleFusionHcmPayrollTimePeriod = z.output<
  typeof oracleFusionHcmPayrollTimePeriodSchema
>

export const oracleFusionHcmPayrollElementDefinitionSchema = z.object({
  elementTypeId: z.string(),
  elementName: nullableStringSchema,
  personId: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
  legislationCode: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  processingType: nullableStringSchema,
  useAtAssignmentLevel: nullableStringSchema,
  useAtRelationshipLevel: nullableStringSchema,
  inputCurrencyCode: nullableStringSchema,
  outputCurrencyCode: nullableStringSchema,
})

export type OracleFusionHcmPayrollElementDefinition = z.output<
  typeof oracleFusionHcmPayrollElementDefinitionSchema
>

export const oracleFusionHcmPayrollInputValueSchema = z.object({
  inputValueId: z.string(),
  inputValueName: nullableStringSchema,
  elementTypeId: nullableStringSchema,
  elementName: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  uom: nullableStringSchema,
  reservedInputValue: nullableStringSchema,
  displaySequence: nullableNumberSchema,
})

export type OracleFusionHcmPayrollInputValue = z.output<
  typeof oracleFusionHcmPayrollInputValueSchema
>

export const oracleFusionHcmElementEntrySchema = z.object({
  elementEntryId: z.string(),
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  elementTypeId: nullableStringSchema,
  elementName: nullableStringSchema,
  entryType: nullableStringSchema,
  creatorType: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  usageLevel: nullableStringSchema,
  processingType: nullableStringSchema,
  inputCurrencyCode: nullableStringSchema,
  legCode: nullableStringSchema,
  legDataGroupId: nullableStringSchema,
  payrollRelationshipNumber: nullableStringSchema,
})

export type OracleFusionHcmElementEntry = z.output<typeof oracleFusionHcmElementEntrySchema>

export const oracleFusionHcmElementEntryValueSchema = z.object({
  elementEntryValueId: z.string(),
  inputValueId: nullableStringSchema,
  inputValueName: nullableStringSchema,
  screenEntryValue: nullableStringSchema,
  uom: nullableStringSchema,
  mandatoryFlag: nullableBooleanSchema,
  userEnterableFlag: nullableBooleanSchema,
  displaySequence: nullableNumberSchema,
})

export type OracleFusionHcmElementEntryValue = z.output<
  typeof oracleFusionHcmElementEntryValueSchema
>

export const oracleFusionHcmPersonProcessResultSchema = z.object({
  objectActionId: nullableStringSchema,
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  payrollRelationshipId: nullableStringSchema,
  payrollId: nullableStringSchema,
  payroll: nullableStringSchema,
  actionTypeCode: nullableStringSchema,
  actionStatusCode: nullableStringSchema,
  status: nullableStringSchema,
  processDate: nullableStringSchema,
  processStartDate: nullableStringSchema,
  processEndDate: nullableStringSchema,
  flowInstanceId: nullableStringSchema,
  flowName: nullableStringSchema,
  payrollPeriodName: nullableStringSchema,
  legislationCode: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
})

export type OracleFusionHcmPersonProcessResult = z.output<
  typeof oracleFusionHcmPersonProcessResultSchema
>

export const oracleFusionHcmPayrollRunResultSchema = z.object({
  runResultId: z.string(),
  inputValueId: nullableStringSchema,
  inputValueName: nullableStringSchema,
  elementEntryId: nullableStringSchema,
  elementTypeId: nullableStringSchema,
  elementName: nullableStringSchema,
  resultValue: nullableStringSchema,
  personId: nullableStringSchema,
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  payrollRelationshipId: nullableStringSchema,
  dateEarned: nullableStringSchema,
  outputCurrencyCode: nullableStringSchema,
  inputCurrencyCode: nullableStringSchema,
  uom: nullableStringSchema,
  prorationStartDate: nullableStringSchema,
  prorationEndDate: nullableStringSchema,
})

export type OracleFusionHcmPayrollRunResult = z.output<typeof oracleFusionHcmPayrollRunResultSchema>

export const oracleFusionHcmPayrollBalanceSchema = z.object({
  balanceTypeId: nullableStringSchema,
  balanceName: nullableStringSchema,
  dimensionName: nullableStringSchema,
  payrollRelActionId: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
  legislationCode: nullableStringSchema,
  uom: nullableStringSchema,
  uomCode: nullableStringSchema,
  ctxString: nullableStringSchema,
  ctxUserString: nullableStringSchema,
  value1: nullableStringSchema,
  defbalId1: nullableStringSchema,
  value2: nullableStringSchema,
  defbalId2: nullableStringSchema,
  value3: nullableStringSchema,
  defbalId3: nullableStringSchema,
  value4: nullableStringSchema,
  defbalId4: nullableStringSchema,
  value5: nullableStringSchema,
  defbalId5: nullableStringSchema,
  value6: nullableStringSchema,
  defbalId6: nullableStringSchema,
  value7: nullableStringSchema,
  defbalId7: nullableStringSchema,
  value8: nullableStringSchema,
  defbalId8: nullableStringSchema,
  value9: nullableStringSchema,
  defbalId9: nullableStringSchema,
  value10: nullableStringSchema,
  defbalId10: nullableStringSchema,
  totalValue1: nullableStringSchema,
  totalValue2: nullableStringSchema,
})

export type OracleFusionHcmPayrollBalance = z.output<typeof oracleFusionHcmPayrollBalanceSchema>

export const oracleFusionHcmSalarySchema = z.object({
  salaryId: z.string(),
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  salaryBasisId: nullableStringSchema,
  salaryBasisName: nullableStringSchema,
  salaryBasisType: nullableStringSchema,
  salaryAmount: nullableNumberSchema,
  currencyCode: nullableStringSchema,
  salaryFrequencyCode: nullableStringSchema,
  dateFrom: nullableStringSchema,
  dateTo: nullableStringSchema,
  annualSalary: nullableNumberSchema,
  annualFullTimeSalary: nullableNumberSchema,
  multipleComponents: nullableStringSchema,
  pendingTransactionExists: nullableStringSchema,
  salaryTransactionStatus: nullableStringSchema,
  salaryAmountScale: nullableNumberSchema,
})

export type OracleFusionHcmSalary = z.output<typeof oracleFusionHcmSalarySchema>

export const oracleFusionHcmSalaryBasisSchema = z.object({
  salaryBasisId: z.string(),
  salaryBasisName: nullableStringSchema,
  salaryBasisType: nullableStringSchema,
  code: nullableStringSchema,
  frequencyCode: nullableStringSchema,
  frequencyName: nullableStringSchema,
  inputCurrencyCode: nullableStringSchema,
  legislativeDataGroupId: nullableStringSchema,
  gradeRateId: nullableStringSchema,
  componentUsage: nullableStringSchema,
  salaryAmountScale: nullableNumberSchema,
  status: nullableStringSchema,
  useAtAssignmentLevel: nullableStringSchema,
  useAtRelationshipLevel: nullableStringSchema,
  useAtTermsLevel: nullableStringSchema,
})

export type OracleFusionHcmSalaryBasis = z.output<typeof oracleFusionHcmSalaryBasisSchema>

export const oracleFusionHcmStandardSalaryComponentSchema = z.object({
  salaryComponentId: z.string(),
  salaryId: nullableStringSchema,
  componentName: nullableStringSchema,
  componentReasonCode: nullableStringSchema,
  adjustmentAmount: nullableNumberSchema,
  adjustmentPercentage: nullableNumberSchema,
  displaySequence: nullableNumberSchema,
  changeAmountScale: nullableNumberSchema,
})

export type OracleFusionHcmStandardSalaryComponent = z.output<
  typeof oracleFusionHcmStandardSalaryComponentSchema
>

export const oracleFusionHcmSimpleSalaryComponentSchema = z.object({
  simpleSalaryCompntId: z.string(),
  salaryId: nullableStringSchema,
  basisSimpleComponentId: nullableStringSchema,
  componentName: nullableStringSchema,
  componentCode: nullableStringSchema,
  componentType: nullableStringSchema,
  currencyCode: nullableStringSchema,
  amount: nullableNumberSchema,
  annualAmount: nullableNumberSchema,
  annualFtAmount: nullableNumberSchema,
  adjustmentAmount: nullableNumberSchema,
  adjustmentPercent: nullableNumberSchema,
  percentage: nullableNumberSchema,
  scale: nullableNumberSchema,
  userSelectedComponent: nullableStringSchema,
  overallSalaryAffect: nullableStringSchema,
})

export type OracleFusionHcmSimpleSalaryComponent = z.output<
  typeof oracleFusionHcmSimpleSalaryComponentSchema
>

export const oracleFusionHcmRateSalaryComponentSchema = z.object({
  salaryPayComponentId: z.string(),
  salaryId: nullableStringSchema,
  payRateDefinitionId: nullableStringSchema,
  name: nullableStringSchema,
  shortName: nullableStringSchema,
  rateAmount: nullableNumberSchema,
  rateAnnualAmount: nullableNumberSchema,
  rateAnnualFtAmount: nullableNumberSchema,
  rateCurrencyCode: nullableStringSchema,
  ratePeriodicityCode: nullableStringSchema,
  rateMinimumAmount: nullableNumberSchema,
  rateMaximumAmount: nullableNumberSchema,
  rateAdjustmentAmount: nullableNumberSchema,
  rateAdjustmentPercent: nullableNumberSchema,
  rateFactor: nullableNumberSchema,
  rateOverallSalaryFlag: nullableBooleanSchema,
})

export type OracleFusionHcmRateSalaryComponent = z.output<
  typeof oracleFusionHcmRateSalaryComponentSchema
>

export const oracleFusionHcmGradeRateValueSchema = z.object({
  rateValueId: z.string(),
  gradeId: nullableStringSchema,
  effectiveStartDate: nullableStringSchema,
  effectiveEndDate: nullableStringSchema,
  minimumAmount: nullableNumberSchema,
  midValueAmount: nullableNumberSchema,
  maximumAmount: nullableNumberSchema,
  valueAmount: nullableNumberSchema,
})

export type OracleFusionHcmGradeRateValue = z.output<typeof oracleFusionHcmGradeRateValueSchema>

export const oracleFusionHcmGoalPlanSchema = z.object({
  goalPlanId: z.string(),
  goalPlanName: nullableStringSchema,
  reviewPeriodId: nullableStringSchema,
  reviewPeriodName: nullableStringSchema,
  startDate: nullableStringSchema,
  endDate: nullableStringSchema,
  goalSettingStartDate: nullableStringSchema,
  goalSettingEndDate: nullableStringSchema,
  goalPlanActiveCode: nullableStringSchema,
  restrictGoalCreationFlag: nullableBooleanSchema,
  restrictGoalUpdateFlag: nullableBooleanSchema,
  enableWeightingFlag: nullableBooleanSchema,
})

export type OracleFusionHcmGoalPlan = z.output<typeof oracleFusionHcmGoalPlanSchema>

export const oracleFusionHcmPerformanceGoalSchema = z.object({
  goalId: z.string(),
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentId: nullableStringSchema,
  goalName: nullableStringSchema,
  description: nullableStringSchema,
  startDate: nullableStringSchema,
  targetCompletionDate: nullableStringSchema,
  status: nullableStringSchema,
  statusMeaning: nullableStringSchema,
  percentComplete: nullableStringSchema,
  reviewPeriodId: nullableStringSchema,
})

export type OracleFusionHcmPerformanceGoal = z.output<typeof oracleFusionHcmPerformanceGoalSchema>

export const oracleFusionHcmDevelopmentGoalSchema = z.object({
  goalId: z.string(),
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentId: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  goalName: nullableStringSchema,
  startDate: nullableStringSchema,
  targetCompletionDate: nullableStringSchema,
  actualCompletionDate: nullableStringSchema,
  status: nullableStringSchema,
  statusMeaning: nullableStringSchema,
  percentComplete: nullableStringSchema,
  privateFlag: nullableBooleanSchema,
  requiresApprovalStatus: nullableStringSchema,
  goalApprovalState: nullableStringSchema,
})

export type OracleFusionHcmDevelopmentGoal = z.output<typeof oracleFusionHcmDevelopmentGoalSchema>

export const oracleFusionHcmPerformanceDocumentSchema = z.object({
  evaluationId: z.string(),
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentId: nullableStringSchema,
  performanceDocumentName: nullableStringSchema,
  evalStatus: nullableStringSchema,
  statusCode: nullableStringSchema,
  reviewPeriodId: nullableStringSchema,
  startDate: nullableStringSchema,
  endDate: nullableStringSchema,
  managerId: nullableStringSchema,
  managerAssignmentId: nullableStringSchema,
})

export type OracleFusionHcmPerformanceDocument = z.output<
  typeof oracleFusionHcmPerformanceDocumentSchema
>

export const oracleFusionHcmPerformanceDocumentRoleSchema = z.object({
  evalRoleId: z.string(),
  roleTypeCode: nullableStringSchema,
  minimumNumberPcpns: nullableNumberSchema,
  matrixParticipantFlag: nullableBooleanSchema,
})

export type OracleFusionHcmPerformanceDocumentRole = z.output<
  typeof oracleFusionHcmPerformanceDocumentRoleSchema
>

export const oracleFusionHcmPerformanceDocumentParticipantSchema = z.object({
  evalParticipantId: z.string(),
  evalRoleId: nullableStringSchema,
  personId: nullableStringSchema,
  participationStatusCode: nullableStringSchema,
  dueDate: nullableStringSchema,
  fdbackCompletionDate: nullableStringSchema,
  matrixParticipantFlag: nullableBooleanSchema,
  roleTypeCode: nullableStringSchema,
})

export type OracleFusionHcmPerformanceDocumentParticipant = z.output<
  typeof oracleFusionHcmPerformanceDocumentParticipantSchema
>

export const oracleFusionHcmPerformanceDocumentTaskSchema = z.object({
  evalStepId: z.string(),
  stepCode: nullableStringSchema,
  stepStatus: nullableStringSchema,
  taskName: nullableStringSchema,
  taskStatus: nullableStringSchema,
  dueDate: nullableStringSchema,
})

export type OracleFusionHcmPerformanceDocumentTask = z.output<
  typeof oracleFusionHcmPerformanceDocumentTaskSchema
>

export const oracleFusionHcmTalentProfileSchema = z.object({
  profileId: z.string(),
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  profileCode: nullableStringSchema,
  displayName: nullableStringSchema,
  statusCode: nullableStringSchema,
})

export type OracleFusionHcmTalentProfile = z.output<typeof oracleFusionHcmTalentProfileSchema>

export const oracleFusionHcmTalentProfileSectionSchema = z.object({
  profileSectionId: z.string(),
  sectionId: nullableStringSchema,
  sectionName: nullableStringSchema,
  sectionContext: nullableStringSchema,
})

export type OracleFusionHcmTalentProfileSection = z.output<
  typeof oracleFusionHcmTalentProfileSectionSchema
>

export const oracleFusionHcmTalentProfileSkillSchema = z.object({
  skillId: z.string(),
  profileId: nullableStringSchema,
  sectionId: nullableStringSchema,
  skill: nullableStringSchema,
  skillType: nullableStringSchema,
  skillTypeMeaning: nullableStringSchema,
  dateAchieved: nullableStringSchema,
  yearsOfExperience: nullableNumberSchema,
  projectOrActivity: nullableStringSchema,
  source: nullableStringSchema,
  sourceType: nullableStringSchema,
})

export type OracleFusionHcmTalentProfileSkill = z.output<
  typeof oracleFusionHcmTalentProfileSkillSchema
>

export const oracleFusionHcmTalentProfileCertificationSchema = z.object({
  certificationId: z.string(),
  profileId: nullableStringSchema,
  sectionId: nullableStringSchema,
  licenseOrCertificate: nullableStringSchema,
  title: nullableStringSchema,
  issueDate: nullableStringSchema,
  expirationDate: nullableStringSchema,
  renewalDate: nullableStringSchema,
  status: nullableStringSchema,
  statusMeaning: nullableStringSchema,
  issuedBy: nullableStringSchema,
  verified: nullableStringSchema,
  verifiedMeaning: nullableStringSchema,
})

export type OracleFusionHcmTalentProfileCertification = z.output<
  typeof oracleFusionHcmTalentProfileCertificationSchema
>

export const oracleFusionHcmTimeRecordSchema = z.object({
  timeRecordId: z.string(),
  timeRecordVersion: nullableNumberSchema,
  timeRecordGroupId: nullableStringSchema,
  timeRecordGroupVersion: nullableNumberSchema,
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  recordType: nullableStringSchema,
  groupType: nullableStringSchema,
  startTime: nullableStringSchema,
  stopTime: nullableStringSchema,
  measure: nullableNumberSchema,
  unitOfMeasure: nullableStringSchema,
  earnedDate: nullableStringSchema,
  overtimeDate: nullableStringSchema,
})

export type OracleFusionHcmTimeRecord = z.output<typeof oracleFusionHcmTimeRecordSchema>

export const oracleFusionHcmTimeCardSchema = z.object({
  timeRecordGroupId: z.string(),
  timeRecordGroupVersion: nullableNumberSchema,
  personId: nullableStringSchema,
  personNumber: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  startTime: nullableStringSchema,
  stopTime: nullableStringSchema,
  totalHours: nullableNumberSchema,
  groupType: nullableStringSchema,
  parentTimeRecordGroupId: nullableStringSchema,
  parentTimeRecordGroupVersion: nullableNumberSchema,
})

export type OracleFusionHcmTimeCard = z.output<typeof oracleFusionHcmTimeCardSchema>

export const oracleFusionHcmTimeAttributeSchema = z.object({
  tmAtrbFldId: z.string(),
  tmAtrbFldUsageId: nullableStringSchema,
  attributeName: nullableStringSchema,
  contextCode: nullableStringSchema,
  displayName: nullableStringSchema,
  description: nullableStringSchema,
  name: nullableStringSchema,
})

export type OracleFusionHcmTimeAttribute = z.output<typeof oracleFusionHcmTimeAttributeSchema>

export const oracleFusionHcmTimeAttributeDataSourceSchema = z.object({
  dataSourceUsageId: z.string(),
  dataSourceUsageCode: nullableStringSchema,
  tmAtrbFldId: nullableStringSchema,
})

export type OracleFusionHcmTimeAttributeDataSource = z.output<
  typeof oracleFusionHcmTimeAttributeDataSourceSchema
>

export const oracleFusionHcmTimeAttributeCriteriaBindSchema = z.object({
  bindName: nullableStringSchema,
  criteriaName: nullableStringSchema,
  dataType: nullableStringSchema,
})

export type OracleFusionHcmTimeAttributeCriteriaBind = z.output<
  typeof oracleFusionHcmTimeAttributeCriteriaBindSchema
>

export const oracleFusionHcmTimeAttributeValueSchema = z.object({
  value: nullableStringSchema,
  displayValue: nullableStringSchema,
})

export type OracleFusionHcmTimeAttributeValue = z.output<
  typeof oracleFusionHcmTimeAttributeValueSchema
>

export const oracleFusionHcmTimeRecordRequestSchema = z.object({
  timeRecordEventRequestId: z.string(),
  processInline: nullableStringSchema,
  processMode: nullableStringSchema,
})

export type OracleFusionHcmTimeRecordRequest = z.output<
  typeof oracleFusionHcmTimeRecordRequestSchema
>

export const oracleFusionHcmTimeRecordRequestEventSchema = z.object({
  timeRecordEventId: nullableStringSchema,
  timeRecordEventRequestId: nullableStringSchema,
  timeRecordId: nullableStringSchema,
  timeRecordVersion: nullableNumberSchema,
  operationType: nullableStringSchema,
  eventStatus: nullableStringSchema,
  eventStatusValue: nullableNumberSchema,
  crudStatusValue: nullableNumberSchema,
  personId: nullableStringSchema,
  reporterId: nullableStringSchema,
  reporterIdType: nullableStringSchema,
  assignmentNumber: nullableStringSchema,
  startTime: nullableStringSchema,
  stopTime: nullableStringSchema,
  measure: nullableNumberSchema,
  referenceDate: nullableStringSchema,
})

export type OracleFusionHcmTimeRecordRequestEvent = z.output<
  typeof oracleFusionHcmTimeRecordRequestEventSchema
>

export const oracleFusionHcmTimeRecordEventMessageSchema = z.object({
  timeRecordEventMessageId: z.string(),
  timeRecordId: nullableStringSchema,
  timeBldgBlkVersion: nullableNumberSchema,
  messageId: nullableStringSchema,
  messageName: nullableStringSchema,
  messageField: nullableStringSchema,
  attributeType: nullableStringSchema,
  allowException: nullableStringSchema,
})

export type OracleFusionHcmTimeRecordEventMessage = z.output<
  typeof oracleFusionHcmTimeRecordEventMessageSchema
>

const finderValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^[^,;=\r\n]+$/, 'Finder values cannot contain separators')

const timeTimestampSchema = z
  .string()
  .trim()
  .datetime({ offset: true })
  .refine(
    (value) => dateSchema.safeParse(value.slice(0, 10)).success,
    'Timestamp must contain a valid calendar date'
  )

export const oracleFusionHcmListPayrollRelationshipsBodySchema =
  oracleFusionHcmBaseBodySchema.extend({
    personNumber: z.string().trim().min(1).max(30).optional(),
    effectiveDate: dateSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
    ...paginationBodyShape,
  })

export const oracleFusionHcmListPayrollRelationshipsResponseSchema = successResponse(
  z.object({
    payrollRelationships: z.array(oracleFusionHcmPayrollRelationshipSchema),
    ...paginationResponseShape,
  })
)

export type OracleFusionHcmListPayrollRelationshipsBody = z.output<
  typeof oracleFusionHcmListPayrollRelationshipsBodySchema
>
export type OracleFusionHcmListPayrollRelationshipsBodyInput = z.input<
  typeof oracleFusionHcmListPayrollRelationshipsBodySchema
>
export type OracleFusionHcmListPayrollRelationshipsResponse = z.output<
  typeof oracleFusionHcmListPayrollRelationshipsResponseSchema
>

export const oracleFusionHcmGetPayrollRelationshipBodySchema = oracleFusionHcmBaseBodySchema.extend(
  {
    payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
    effectiveDate: dateSchema.optional(),
  }
)

export const oracleFusionHcmGetPayrollRelationshipResponseSchema = successResponse(
  z.object({
    payrollRelationship: oracleFusionHcmPayrollRelationshipSchema,
  })
)

export type OracleFusionHcmGetPayrollRelationshipBody = z.output<
  typeof oracleFusionHcmGetPayrollRelationshipBodySchema
>
export type OracleFusionHcmGetPayrollRelationshipBodyInput = z.input<
  typeof oracleFusionHcmGetPayrollRelationshipBodySchema
>
export type OracleFusionHcmGetPayrollRelationshipResponse = z.output<
  typeof oracleFusionHcmGetPayrollRelationshipResponseSchema
>

export const oracleFusionHcmListPayrollAssignmentsBodySchema = oracleFusionHcmBaseBodySchema.extend(
  {
    payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
    effectiveDate: dateSchema.optional(),
    ...paginationBodyShape,
  }
)

export const oracleFusionHcmListPayrollAssignmentsResponseSchema = successResponse(
  z.object({
    payrollAssignments: z.array(oracleFusionHcmPayrollAssignmentSchema),
    ...paginationResponseShape,
  })
)

export type OracleFusionHcmListPayrollAssignmentsBody = z.output<
  typeof oracleFusionHcmListPayrollAssignmentsBodySchema
>
export type OracleFusionHcmListPayrollAssignmentsBodyInput = z.input<
  typeof oracleFusionHcmListPayrollAssignmentsBodySchema
>
export type OracleFusionHcmListPayrollAssignmentsResponse = z.output<
  typeof oracleFusionHcmListPayrollAssignmentsResponseSchema
>

export const oracleFusionHcmGetPayrollAssignmentBodySchema = oracleFusionHcmBaseBodySchema.extend({
  payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
  payrollAssignmentId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
})

export const oracleFusionHcmGetPayrollAssignmentResponseSchema = successResponse(
  z.object({
    payrollAssignment: oracleFusionHcmPayrollAssignmentSchema,
  })
)

export type OracleFusionHcmGetPayrollAssignmentBody = z.output<
  typeof oracleFusionHcmGetPayrollAssignmentBodySchema
>
export type OracleFusionHcmGetPayrollAssignmentBodyInput = z.input<
  typeof oracleFusionHcmGetPayrollAssignmentBodySchema
>
export type OracleFusionHcmGetPayrollAssignmentResponse = z.output<
  typeof oracleFusionHcmGetPayrollAssignmentResponseSchema
>

export const oracleFusionHcmListAssignedPayrollsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
  payrollAssignmentId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListAssignedPayrollsResponseSchema = successResponse(
  z.object({
    assignedPayrolls: z.array(oracleFusionHcmAssignedPayrollSchema),
    ...paginationResponseShape,
  })
)

export type OracleFusionHcmListAssignedPayrollsBody = z.output<
  typeof oracleFusionHcmListAssignedPayrollsBodySchema
>
export type OracleFusionHcmListAssignedPayrollsBodyInput = z.input<
  typeof oracleFusionHcmListAssignedPayrollsBodySchema
>
export type OracleFusionHcmListAssignedPayrollsResponse = z.output<
  typeof oracleFusionHcmListAssignedPayrollsResponseSchema
>

export const oracleFusionHcmGetAssignedPayrollBodySchema = oracleFusionHcmBaseBodySchema.extend({
  payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
  payrollAssignmentId: oracleFusionHcmDecimalIdSchema,
  assignedPayrollId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
})

export const oracleFusionHcmGetAssignedPayrollResponseSchema = successResponse(
  z.object({
    assignedPayroll: oracleFusionHcmAssignedPayrollSchema,
  })
)

export type OracleFusionHcmGetAssignedPayrollBody = z.output<
  typeof oracleFusionHcmGetAssignedPayrollBodySchema
>
export type OracleFusionHcmGetAssignedPayrollBodyInput = z.input<
  typeof oracleFusionHcmGetAssignedPayrollBodySchema
>
export type OracleFusionHcmGetAssignedPayrollResponse = z.output<
  typeof oracleFusionHcmGetAssignedPayrollResponseSchema
>

export const oracleFusionHcmCreateAssignedPayrollBodySchema = oracleFusionHcmBaseBodySchema
  .extend({
    payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
    payrollAssignmentId: oracleFusionHcmDecimalIdSchema,
    payrollId: oracleFusionHcmDecimalIdSchema,
    effectiveStartDate: dateSchema,
    effectiveEndDate: dateSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    lsed: dateSchema.optional(),
    overridingPeriodId: oracleFusionHcmDecimalIdSchema.optional(),
    timeCardRequired: z.string().trim().min(1).max(30).optional(),
  })
  .refine(
    (input) =>
      !input.effectiveStartDate ||
      !input.effectiveEndDate ||
      input.effectiveStartDate <= input.effectiveEndDate,
    'effectiveEndDate must be on or after effectiveStartDate'
  )
  .refine(
    (input) => !input.startDate || !input.endDate || input.startDate <= input.endDate,
    'endDate must be on or after startDate'
  )

export const oracleFusionHcmCreateAssignedPayrollResponseSchema = successResponse(
  z.object({
    assignedPayroll: oracleFusionHcmAssignedPayrollSchema,
  })
)

export type OracleFusionHcmCreateAssignedPayrollBody = z.output<
  typeof oracleFusionHcmCreateAssignedPayrollBodySchema
>
export type OracleFusionHcmCreateAssignedPayrollBodyInput = z.input<
  typeof oracleFusionHcmCreateAssignedPayrollBodySchema
>
export type OracleFusionHcmCreateAssignedPayrollResponse = z.output<
  typeof oracleFusionHcmCreateAssignedPayrollResponseSchema
>

export const oracleFusionHcmUpdateAssignedPayrollBodySchema = oracleFusionHcmBaseBodySchema
  .extend({
    payrollRelationshipId: oracleFusionHcmDecimalIdSchema,
    payrollAssignmentId: oracleFusionHcmDecimalIdSchema,
    assignedPayrollId: oracleFusionHcmDecimalIdSchema,
    effectiveDate: dateSchema,
    rangeMode: z.enum(['CORRECTION', 'UPDATE']),
    effectiveEndDate: dateSchema.optional(),
    lsed: dateSchema.optional(),
    overridingPeriodId: oracleFusionHcmDecimalIdSchema.optional(),
    timeCardRequired: z.string().trim().min(1).max(30).optional(),
  })
  .refine(
    (input) =>
      input.effectiveEndDate !== undefined ||
      input.lsed !== undefined ||
      input.overridingPeriodId !== undefined ||
      input.timeCardRequired !== undefined,
    'At least one assigned-payroll field must be supplied'
  )

export const oracleFusionHcmUpdateAssignedPayrollResponseSchema = successResponse(
  z.object({
    assignedPayroll: oracleFusionHcmAssignedPayrollSchema,
  })
)

export type OracleFusionHcmUpdateAssignedPayrollBody = z.output<
  typeof oracleFusionHcmUpdateAssignedPayrollBodySchema
>
export type OracleFusionHcmUpdateAssignedPayrollBodyInput = z.input<
  typeof oracleFusionHcmUpdateAssignedPayrollBodySchema
>
export type OracleFusionHcmUpdateAssignedPayrollResponse = z.output<
  typeof oracleFusionHcmUpdateAssignedPayrollResponseSchema
>

export const oracleFusionHcmListPayrollDefinitionsBodySchema = oracleFusionHcmBaseBodySchema.extend(
  {
    legislativeDataGroupId: oracleFusionHcmDecimalIdSchema.optional(),
    effectiveDate: dateSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
    ...paginationBodyShape,
  }
)

export const oracleFusionHcmListPayrollDefinitionsResponseSchema = successResponse(
  z.object({
    payrollDefinitions: z.array(oracleFusionHcmPayrollDefinitionSchema),
    ...paginationResponseShape,
  })
)

export type OracleFusionHcmListPayrollDefinitionsBody = z.output<typeof oracleFusionHcmListPayrollDefinitionsBodySchema>
export type OracleFusionHcmListPayrollDefinitionsBodyInput = z.input<typeof oracleFusionHcmListPayrollDefinitionsBodySchema>
export type OracleFusionHcmListPayrollDefinitionsResponse = z.output<typeof oracleFusionHcmListPayrollDefinitionsResponseSchema>

export const oracleFusionHcmListPayrollTimePeriodsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  payrollId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListPayrollTimePeriodsResponseSchema = successResponse(z.object({
  payrollTimePeriods: z.array(oracleFusionHcmPayrollTimePeriodSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPayrollTimePeriodsBody = z.output<typeof oracleFusionHcmListPayrollTimePeriodsBodySchema>
export type OracleFusionHcmListPayrollTimePeriodsBodyInput = z.input<typeof oracleFusionHcmListPayrollTimePeriodsBodySchema>
export type OracleFusionHcmListPayrollTimePeriodsResponse = z.output<typeof oracleFusionHcmListPayrollTimePeriodsResponseSchema>

export const oracleFusionHcmListPayrollElementDefinitionsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema.optional(),
  legislativeDataGroupId: oracleFusionHcmDecimalIdSchema.optional(),
  effectiveDate: dateSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListPayrollElementDefinitionsResponseSchema = successResponse(z.object({
  payrollElementDefinitions: z.array(oracleFusionHcmPayrollElementDefinitionSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPayrollElementDefinitionsBody = z.output<typeof oracleFusionHcmListPayrollElementDefinitionsBodySchema>
export type OracleFusionHcmListPayrollElementDefinitionsBodyInput = z.input<typeof oracleFusionHcmListPayrollElementDefinitionsBodySchema>
export type OracleFusionHcmListPayrollElementDefinitionsResponse = z.output<typeof oracleFusionHcmListPayrollElementDefinitionsResponseSchema>

export const oracleFusionHcmListPayrollInputValuesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  elementTypeId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListPayrollInputValuesResponseSchema = successResponse(z.object({
  payrollInputValues: z.array(oracleFusionHcmPayrollInputValueSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPayrollInputValuesBody = z.output<typeof oracleFusionHcmListPayrollInputValuesBodySchema>
export type OracleFusionHcmListPayrollInputValuesBodyInput = z.input<typeof oracleFusionHcmListPayrollInputValuesBodySchema>
export type OracleFusionHcmListPayrollInputValuesResponse = z.output<typeof oracleFusionHcmListPayrollInputValuesResponseSchema>

export const oracleFusionHcmListElementEntriesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30).optional(),
  personId: oracleFusionHcmDecimalIdSchema.optional(),
  assignmentNumber: z.string().trim().min(1).max(255).optional(),
  elementTypeId: oracleFusionHcmDecimalIdSchema.optional(),
  effectiveDate: dateSchema.optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListElementEntriesResponseSchema = successResponse(z.object({
  elementEntries: z.array(oracleFusionHcmElementEntrySchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListElementEntriesBody = z.output<typeof oracleFusionHcmListElementEntriesBodySchema>
export type OracleFusionHcmListElementEntriesBodyInput = z.input<typeof oracleFusionHcmListElementEntriesBodySchema>
export type OracleFusionHcmListElementEntriesResponse = z.output<typeof oracleFusionHcmListElementEntriesResponseSchema>

export const oracleFusionHcmGetElementEntryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  elementEntryId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
})

export const oracleFusionHcmGetElementEntryResponseSchema = successResponse(z.object({
  elementEntry: oracleFusionHcmElementEntrySchema,
}))

export type OracleFusionHcmGetElementEntryBody = z.output<typeof oracleFusionHcmGetElementEntryBodySchema>
export type OracleFusionHcmGetElementEntryBodyInput = z.input<typeof oracleFusionHcmGetElementEntryBodySchema>
export type OracleFusionHcmGetElementEntryResponse = z.output<typeof oracleFusionHcmGetElementEntryResponseSchema>

export const oracleFusionHcmListElementEntryValuesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  elementEntryId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListElementEntryValuesResponseSchema = successResponse(z.object({
  elementEntryValues: z.array(oracleFusionHcmElementEntryValueSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListElementEntryValuesBody = z.output<typeof oracleFusionHcmListElementEntryValuesBodySchema>
export type OracleFusionHcmListElementEntryValuesBodyInput = z.input<typeof oracleFusionHcmListElementEntryValuesBodySchema>
export type OracleFusionHcmListElementEntryValuesResponse = z.output<typeof oracleFusionHcmListElementEntryValuesResponseSchema>

export const oracleFusionHcmCreateElementEntryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
  assignmentId: oracleFusionHcmDecimalIdSchema.optional(),
  elementTypeId: oracleFusionHcmDecimalIdSchema,
  elementName: z.string().trim().min(1).max(80),
  creatorType: z.string().trim().min(1).max(30),
  entryType: z.string().trim().min(1).max(30),
  effectiveStartDate: dateSchema,
  effectiveEndDate: dateSchema,
  entryValues: z.array(z.object({ inputValueId: oracleFusionHcmDecimalIdSchema, screenEntryValue: z.string().max(60).nullable() }).strict()).min(1).max(100),
}).refine((input) => !input.effectiveStartDate || !input.effectiveEndDate || input.effectiveStartDate <= input.effectiveEndDate, 'effectiveEndDate must be on or after effectiveStartDate')

export const oracleFusionHcmCreateElementEntryResponseSchema = successResponse(z.object({
  elementEntry: oracleFusionHcmElementEntrySchema,
}))

export type OracleFusionHcmCreateElementEntryBody = z.output<typeof oracleFusionHcmCreateElementEntryBodySchema>
export type OracleFusionHcmCreateElementEntryBodyInput = z.input<typeof oracleFusionHcmCreateElementEntryBodySchema>
export type OracleFusionHcmCreateElementEntryResponse = z.output<typeof oracleFusionHcmCreateElementEntryResponseSchema>

export const oracleFusionHcmUpdateElementEntryValueBodySchema = oracleFusionHcmBaseBodySchema.extend({
  elementEntryId: oracleFusionHcmDecimalIdSchema,
  elementEntryValueId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema,
  rangeMode: z.enum(['CORRECTION', 'UPDATE']),
  screenEntryValue: z.string().max(60).nullable(),
})

export const oracleFusionHcmUpdateElementEntryValueResponseSchema = successResponse(z.object({
  elementEntryValue: oracleFusionHcmElementEntryValueSchema,
}))

export type OracleFusionHcmUpdateElementEntryValueBody = z.output<typeof oracleFusionHcmUpdateElementEntryValueBodySchema>
export type OracleFusionHcmUpdateElementEntryValueBodyInput = z.input<typeof oracleFusionHcmUpdateElementEntryValueBodySchema>
export type OracleFusionHcmUpdateElementEntryValueResponse = z.output<typeof oracleFusionHcmUpdateElementEntryValueResponseSchema>

export const oracleFusionHcmListPersonProcessResultsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30).optional(),
  personId: oracleFusionHcmDecimalIdSchema.optional(),
  payrollRelationshipId: oracleFusionHcmDecimalIdSchema.optional(),
  payrollId: oracleFusionHcmDecimalIdSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  ...paginationBodyShape,
}).refine((input) => !input.startDate || !input.endDate || input.startDate <= input.endDate, 'endDate must be on or after startDate')

export const oracleFusionHcmListPersonProcessResultsResponseSchema = successResponse(z.object({
  personProcessResults: z.array(oracleFusionHcmPersonProcessResultSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPersonProcessResultsBody = z.output<typeof oracleFusionHcmListPersonProcessResultsBodySchema>
export type OracleFusionHcmListPersonProcessResultsBodyInput = z.input<typeof oracleFusionHcmListPersonProcessResultsBodySchema>
export type OracleFusionHcmListPersonProcessResultsResponse = z.output<typeof oracleFusionHcmListPersonProcessResultsResponseSchema>

export const oracleFusionHcmGetPersonProcessResultBodySchema = oracleFusionHcmBaseBodySchema.extend({
  objectActionId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetPersonProcessResultResponseSchema = successResponse(z.object({
  personProcessResult: oracleFusionHcmPersonProcessResultSchema,
}))

export type OracleFusionHcmGetPersonProcessResultBody = z.output<typeof oracleFusionHcmGetPersonProcessResultBodySchema>
export type OracleFusionHcmGetPersonProcessResultBodyInput = z.input<typeof oracleFusionHcmGetPersonProcessResultBodySchema>
export type OracleFusionHcmGetPersonProcessResultResponse = z.output<typeof oracleFusionHcmGetPersonProcessResultResponseSchema>

export const oracleFusionHcmListPayrollRunResultsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  objectActionId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListPayrollRunResultsResponseSchema = successResponse(z.object({
  payrollRunResults: z.array(oracleFusionHcmPayrollRunResultSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPayrollRunResultsBody = z.output<typeof oracleFusionHcmListPayrollRunResultsBodySchema>
export type OracleFusionHcmListPayrollRunResultsBodyInput = z.input<typeof oracleFusionHcmListPayrollRunResultsBodySchema>
export type OracleFusionHcmListPayrollRunResultsResponse = z.output<typeof oracleFusionHcmListPayrollRunResultsResponseSchema>

export const oracleFusionHcmListPayrollBalancesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  objectActionId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListPayrollBalancesResponseSchema = successResponse(z.object({
  payrollBalances: z.array(oracleFusionHcmPayrollBalanceSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPayrollBalancesBody = z.output<typeof oracleFusionHcmListPayrollBalancesBodySchema>
export type OracleFusionHcmListPayrollBalancesBodyInput = z.input<typeof oracleFusionHcmListPayrollBalancesBodySchema>
export type OracleFusionHcmListPayrollBalancesResponse = z.output<typeof oracleFusionHcmListPayrollBalancesResponseSchema>

export const oracleFusionHcmListSalariesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  assignmentId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListSalariesResponseSchema = successResponse(z.object({
  salaries: z.array(oracleFusionHcmSalarySchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListSalariesBody = z.output<typeof oracleFusionHcmListSalariesBodySchema>
export type OracleFusionHcmListSalariesBodyInput = z.input<typeof oracleFusionHcmListSalariesBodySchema>
export type OracleFusionHcmListSalariesResponse = z.output<typeof oracleFusionHcmListSalariesResponseSchema>

export const oracleFusionHcmGetSalaryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  salaryId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetSalaryResponseSchema = successResponse(z.object({
  salary: oracleFusionHcmSalarySchema,
}))

export type OracleFusionHcmGetSalaryBody = z.output<typeof oracleFusionHcmGetSalaryBodySchema>
export type OracleFusionHcmGetSalaryBodyInput = z.input<typeof oracleFusionHcmGetSalaryBodySchema>
export type OracleFusionHcmGetSalaryResponse = z.output<typeof oracleFusionHcmGetSalaryResponseSchema>

export const oracleFusionHcmCreateSalaryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  assignmentId: oracleFusionHcmDecimalIdSchema,
  salaryBasisId: oracleFusionHcmDecimalIdSchema,
  salaryAmount: z.number().finite().nonnegative(),
  dateFrom: dateSchema,
  dateTo: dateSchema,
}).refine((input) => !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, 'dateTo must be on or after dateFrom')

export const oracleFusionHcmCreateSalaryResponseSchema = successResponse(z.object({
  salary: oracleFusionHcmSalarySchema,
}))

export type OracleFusionHcmCreateSalaryBody = z.output<typeof oracleFusionHcmCreateSalaryBodySchema>
export type OracleFusionHcmCreateSalaryBodyInput = z.input<typeof oracleFusionHcmCreateSalaryBodySchema>
export type OracleFusionHcmCreateSalaryResponse = z.output<typeof oracleFusionHcmCreateSalaryResponseSchema>

export const oracleFusionHcmCorrectSalaryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  salaryId: oracleFusionHcmDecimalIdSchema,
  salaryAmount: z.number().finite().nonnegative(),
})

export const oracleFusionHcmCorrectSalaryResponseSchema = successResponse(z.object({
  salary: oracleFusionHcmSalarySchema,
}))

export type OracleFusionHcmCorrectSalaryBody = z.output<typeof oracleFusionHcmCorrectSalaryBodySchema>
export type OracleFusionHcmCorrectSalaryBodyInput = z.input<typeof oracleFusionHcmCorrectSalaryBodySchema>
export type OracleFusionHcmCorrectSalaryResponse = z.output<typeof oracleFusionHcmCorrectSalaryResponseSchema>

export const oracleFusionHcmListSalaryBasesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  legislativeDataGroupId: oracleFusionHcmDecimalIdSchema.optional(),
  effectiveDate: dateSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListSalaryBasesResponseSchema = successResponse(z.object({
  salaryBases: z.array(oracleFusionHcmSalaryBasisSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListSalaryBasesBody = z.output<typeof oracleFusionHcmListSalaryBasesBodySchema>
export type OracleFusionHcmListSalaryBasesBodyInput = z.input<typeof oracleFusionHcmListSalaryBasesBodySchema>
export type OracleFusionHcmListSalaryBasesResponse = z.output<typeof oracleFusionHcmListSalaryBasesResponseSchema>

export const oracleFusionHcmListSalaryComponentsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  salaryId: oracleFusionHcmDecimalIdSchema,
  componentKind: z.enum(['standard', 'simple', 'rate']).default('standard'),
  ...paginationBodyShape,
})

export const oracleFusionHcmListSalaryComponentsResponseSchema = successResponse(z.object({
  componentKind: z.enum(['standard', 'simple', 'rate']),
  standardComponents: z.array(oracleFusionHcmStandardSalaryComponentSchema),
  simpleComponents: z.array(oracleFusionHcmSimpleSalaryComponentSchema),
  rateComponents: z.array(oracleFusionHcmRateSalaryComponentSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListSalaryComponentsBody = z.output<typeof oracleFusionHcmListSalaryComponentsBodySchema>
export type OracleFusionHcmListSalaryComponentsBodyInput = z.input<typeof oracleFusionHcmListSalaryComponentsBodySchema>
export type OracleFusionHcmListSalaryComponentsResponse = z.output<typeof oracleFusionHcmListSalaryComponentsResponseSchema>

export const oracleFusionHcmListGradeRateValuesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  gradeRateId: oracleFusionHcmDecimalIdSchema,
  effectiveDate: dateSchema.optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListGradeRateValuesResponseSchema = successResponse(z.object({
  gradeRateValues: z.array(oracleFusionHcmGradeRateValueSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListGradeRateValuesBody = z.output<typeof oracleFusionHcmListGradeRateValuesBodySchema>
export type OracleFusionHcmListGradeRateValuesBodyInput = z.input<typeof oracleFusionHcmListGradeRateValuesBodySchema>
export type OracleFusionHcmListGradeRateValuesResponse = z.output<typeof oracleFusionHcmListGradeRateValuesResponseSchema>

export const oracleFusionHcmListGoalPlansBodySchema = oracleFusionHcmBaseBodySchema.extend({
  reviewPeriodId: oracleFusionHcmDecimalIdSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListGoalPlansResponseSchema = successResponse(z.object({
  goalPlans: z.array(oracleFusionHcmGoalPlanSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListGoalPlansBody = z.output<typeof oracleFusionHcmListGoalPlansBodySchema>
export type OracleFusionHcmListGoalPlansBodyInput = z.input<typeof oracleFusionHcmListGoalPlansBodySchema>
export type OracleFusionHcmListGoalPlansResponse = z.output<typeof oracleFusionHcmListGoalPlansResponseSchema>

export const oracleFusionHcmGetGoalPlanBodySchema = oracleFusionHcmBaseBodySchema.extend({
  goalPlanId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetGoalPlanResponseSchema = successResponse(z.object({
  goalPlan: oracleFusionHcmGoalPlanSchema,
}))

export type OracleFusionHcmGetGoalPlanBody = z.output<typeof oracleFusionHcmGetGoalPlanBodySchema>
export type OracleFusionHcmGetGoalPlanBodyInput = z.input<typeof oracleFusionHcmGetGoalPlanBodySchema>
export type OracleFusionHcmGetGoalPlanResponse = z.output<typeof oracleFusionHcmGetGoalPlanResponseSchema>

export const oracleFusionHcmListPerformanceGoalsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema.optional(),
  reviewPeriodId: oracleFusionHcmDecimalIdSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListPerformanceGoalsResponseSchema = successResponse(z.object({
  performanceGoals: z.array(oracleFusionHcmPerformanceGoalSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPerformanceGoalsBody = z.output<typeof oracleFusionHcmListPerformanceGoalsBodySchema>
export type OracleFusionHcmListPerformanceGoalsBodyInput = z.input<typeof oracleFusionHcmListPerformanceGoalsBodySchema>
export type OracleFusionHcmListPerformanceGoalsResponse = z.output<typeof oracleFusionHcmListPerformanceGoalsResponseSchema>

export const oracleFusionHcmGetPerformanceGoalBodySchema = oracleFusionHcmBaseBodySchema.extend({
  goalId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetPerformanceGoalResponseSchema = successResponse(z.object({
  performanceGoal: oracleFusionHcmPerformanceGoalSchema,
}))

export type OracleFusionHcmGetPerformanceGoalBody = z.output<typeof oracleFusionHcmGetPerformanceGoalBodySchema>
export type OracleFusionHcmGetPerformanceGoalBodyInput = z.input<typeof oracleFusionHcmGetPerformanceGoalBodySchema>
export type OracleFusionHcmGetPerformanceGoalResponse = z.output<typeof oracleFusionHcmGetPerformanceGoalResponseSchema>

export const oracleFusionHcmListDevelopmentGoalsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListDevelopmentGoalsResponseSchema = successResponse(z.object({
  developmentGoals: z.array(oracleFusionHcmDevelopmentGoalSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListDevelopmentGoalsBody = z.output<typeof oracleFusionHcmListDevelopmentGoalsBodySchema>
export type OracleFusionHcmListDevelopmentGoalsBodyInput = z.input<typeof oracleFusionHcmListDevelopmentGoalsBodySchema>
export type OracleFusionHcmListDevelopmentGoalsResponse = z.output<typeof oracleFusionHcmListDevelopmentGoalsResponseSchema>

export const oracleFusionHcmGetDevelopmentGoalBodySchema = oracleFusionHcmBaseBodySchema.extend({
  goalId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetDevelopmentGoalResponseSchema = successResponse(z.object({
  developmentGoal: oracleFusionHcmDevelopmentGoalSchema,
}))

export type OracleFusionHcmGetDevelopmentGoalBody = z.output<typeof oracleFusionHcmGetDevelopmentGoalBodySchema>
export type OracleFusionHcmGetDevelopmentGoalBodyInput = z.input<typeof oracleFusionHcmGetDevelopmentGoalBodySchema>
export type OracleFusionHcmGetDevelopmentGoalResponse = z.output<typeof oracleFusionHcmGetDevelopmentGoalResponseSchema>

export const oracleFusionHcmListPerformanceDocumentsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema.optional(),
  reviewPeriodId: oracleFusionHcmDecimalIdSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListPerformanceDocumentsResponseSchema = successResponse(z.object({
  performanceDocuments: z.array(oracleFusionHcmPerformanceDocumentSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPerformanceDocumentsBody = z.output<typeof oracleFusionHcmListPerformanceDocumentsBodySchema>
export type OracleFusionHcmListPerformanceDocumentsBodyInput = z.input<typeof oracleFusionHcmListPerformanceDocumentsBodySchema>
export type OracleFusionHcmListPerformanceDocumentsResponse = z.output<typeof oracleFusionHcmListPerformanceDocumentsResponseSchema>

export const oracleFusionHcmGetPerformanceDocumentBodySchema = oracleFusionHcmBaseBodySchema.extend({
  evaluationId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetPerformanceDocumentResponseSchema = successResponse(z.object({
  performanceDocument: oracleFusionHcmPerformanceDocumentSchema,
}))

export type OracleFusionHcmGetPerformanceDocumentBody = z.output<typeof oracleFusionHcmGetPerformanceDocumentBodySchema>
export type OracleFusionHcmGetPerformanceDocumentBodyInput = z.input<typeof oracleFusionHcmGetPerformanceDocumentBodySchema>
export type OracleFusionHcmGetPerformanceDocumentResponse = z.output<typeof oracleFusionHcmGetPerformanceDocumentResponseSchema>

export const oracleFusionHcmListPerformanceDocumentRolesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  evaluationId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListPerformanceDocumentRolesResponseSchema = successResponse(z.object({
  performanceDocumentRoles: z.array(oracleFusionHcmPerformanceDocumentRoleSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPerformanceDocumentRolesBody = z.output<typeof oracleFusionHcmListPerformanceDocumentRolesBodySchema>
export type OracleFusionHcmListPerformanceDocumentRolesBodyInput = z.input<typeof oracleFusionHcmListPerformanceDocumentRolesBodySchema>
export type OracleFusionHcmListPerformanceDocumentRolesResponse = z.output<typeof oracleFusionHcmListPerformanceDocumentRolesResponseSchema>

export const oracleFusionHcmListPerformanceDocumentParticipantsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  evaluationId: oracleFusionHcmDecimalIdSchema,
  evalRoleId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListPerformanceDocumentParticipantsResponseSchema = successResponse(z.object({
  performanceDocumentParticipants: z.array(oracleFusionHcmPerformanceDocumentParticipantSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPerformanceDocumentParticipantsBody = z.output<typeof oracleFusionHcmListPerformanceDocumentParticipantsBodySchema>
export type OracleFusionHcmListPerformanceDocumentParticipantsBodyInput = z.input<typeof oracleFusionHcmListPerformanceDocumentParticipantsBodySchema>
export type OracleFusionHcmListPerformanceDocumentParticipantsResponse = z.output<typeof oracleFusionHcmListPerformanceDocumentParticipantsResponseSchema>

export const oracleFusionHcmListPerformanceDocumentTasksBodySchema = oracleFusionHcmBaseBodySchema.extend({
  evaluationId: oracleFusionHcmDecimalIdSchema,
  evalRoleId: oracleFusionHcmDecimalIdSchema,
  evalParticipantId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListPerformanceDocumentTasksResponseSchema = successResponse(z.object({
  performanceDocumentTasks: z.array(oracleFusionHcmPerformanceDocumentTaskSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListPerformanceDocumentTasksBody = z.output<typeof oracleFusionHcmListPerformanceDocumentTasksBodySchema>
export type OracleFusionHcmListPerformanceDocumentTasksBodyInput = z.input<typeof oracleFusionHcmListPerformanceDocumentTasksBodySchema>
export type OracleFusionHcmListPerformanceDocumentTasksResponse = z.output<typeof oracleFusionHcmListPerformanceDocumentTasksResponseSchema>

export const oracleFusionHcmListTalentProfilesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personId: oracleFusionHcmDecimalIdSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListTalentProfilesResponseSchema = successResponse(z.object({
  talentProfiles: z.array(oracleFusionHcmTalentProfileSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTalentProfilesBody = z.output<typeof oracleFusionHcmListTalentProfilesBodySchema>
export type OracleFusionHcmListTalentProfilesBodyInput = z.input<typeof oracleFusionHcmListTalentProfilesBodySchema>
export type OracleFusionHcmListTalentProfilesResponse = z.output<typeof oracleFusionHcmListTalentProfilesResponseSchema>

export const oracleFusionHcmGetTalentProfileBodySchema = oracleFusionHcmBaseBodySchema.extend({
  profileId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetTalentProfileResponseSchema = successResponse(z.object({
  talentProfile: oracleFusionHcmTalentProfileSchema,
}))

export type OracleFusionHcmGetTalentProfileBody = z.output<typeof oracleFusionHcmGetTalentProfileBodySchema>
export type OracleFusionHcmGetTalentProfileBodyInput = z.input<typeof oracleFusionHcmGetTalentProfileBodySchema>
export type OracleFusionHcmGetTalentProfileResponse = z.output<typeof oracleFusionHcmGetTalentProfileResponseSchema>

export const oracleFusionHcmListTalentProfileSectionsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  profileId: oracleFusionHcmDecimalIdSchema,
  sectionKind: z.enum(['skill', 'certification']).default('skill'),
  ...paginationBodyShape,
})

export const oracleFusionHcmListTalentProfileSectionsResponseSchema = successResponse(z.object({
  talentProfileSections: z.array(oracleFusionHcmTalentProfileSectionSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTalentProfileSectionsBody = z.output<typeof oracleFusionHcmListTalentProfileSectionsBodySchema>
export type OracleFusionHcmListTalentProfileSectionsBodyInput = z.input<typeof oracleFusionHcmListTalentProfileSectionsBodySchema>
export type OracleFusionHcmListTalentProfileSectionsResponse = z.output<typeof oracleFusionHcmListTalentProfileSectionsResponseSchema>

export const oracleFusionHcmListTalentProfileSkillsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  profileId: oracleFusionHcmDecimalIdSchema,
  profileSectionId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListTalentProfileSkillsResponseSchema = successResponse(z.object({
  talentProfileSkills: z.array(oracleFusionHcmTalentProfileSkillSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTalentProfileSkillsBody = z.output<typeof oracleFusionHcmListTalentProfileSkillsBodySchema>
export type OracleFusionHcmListTalentProfileSkillsBodyInput = z.input<typeof oracleFusionHcmListTalentProfileSkillsBodySchema>
export type OracleFusionHcmListTalentProfileSkillsResponse = z.output<typeof oracleFusionHcmListTalentProfileSkillsResponseSchema>

export const oracleFusionHcmListTalentProfileCertificationsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  profileId: oracleFusionHcmDecimalIdSchema,
  profileSectionId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListTalentProfileCertificationsResponseSchema = successResponse(z.object({
  talentProfileCertifications: z.array(oracleFusionHcmTalentProfileCertificationSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTalentProfileCertificationsBody = z.output<typeof oracleFusionHcmListTalentProfileCertificationsBodySchema>
export type OracleFusionHcmListTalentProfileCertificationsBodyInput = z.input<typeof oracleFusionHcmListTalentProfileCertificationsBodySchema>
export type OracleFusionHcmListTalentProfileCertificationsResponse = z.output<typeof oracleFusionHcmListTalentProfileCertificationsResponseSchema>

export const oracleFusionHcmListTimeRecordsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30),
  startTime: timeTimestampSchema,
  stopTime: timeTimestampSchema,
  ...paginationBodyShape,
}).refine((input) => finderValueSchema.safeParse(input.personNumber).success, 'Person number cannot contain finder separators').refine((input) => Date.parse(input.startTime) < Date.parse(input.stopTime), 'stopTime must be after startTime')

export const oracleFusionHcmListTimeRecordsResponseSchema = successResponse(z.object({
  timeRecords: z.array(oracleFusionHcmTimeRecordSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeRecordsBody = z.output<typeof oracleFusionHcmListTimeRecordsBodySchema>
export type OracleFusionHcmListTimeRecordsBodyInput = z.input<typeof oracleFusionHcmListTimeRecordsBodySchema>
export type OracleFusionHcmListTimeRecordsResponse = z.output<typeof oracleFusionHcmListTimeRecordsResponseSchema>

export const oracleFusionHcmGetTimeRecordBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeRecordId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetTimeRecordResponseSchema = successResponse(z.object({
  timeRecord: oracleFusionHcmTimeRecordSchema,
}))

export type OracleFusionHcmGetTimeRecordBody = z.output<typeof oracleFusionHcmGetTimeRecordBodySchema>
export type OracleFusionHcmGetTimeRecordBodyInput = z.input<typeof oracleFusionHcmGetTimeRecordBodySchema>
export type OracleFusionHcmGetTimeRecordResponse = z.output<typeof oracleFusionHcmGetTimeRecordResponseSchema>

export const oracleFusionHcmListTimeCardsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30),
  startTime: timeTimestampSchema,
  stopTime: timeTimestampSchema,
  ...paginationBodyShape,
}).refine((input) => finderValueSchema.safeParse(input.personNumber).success, 'Person number cannot contain finder separators').refine((input) => Date.parse(input.startTime) < Date.parse(input.stopTime), 'stopTime must be after startTime')

export const oracleFusionHcmListTimeCardsResponseSchema = successResponse(z.object({
  timeCards: z.array(oracleFusionHcmTimeCardSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeCardsBody = z.output<typeof oracleFusionHcmListTimeCardsBodySchema>
export type OracleFusionHcmListTimeCardsBodyInput = z.input<typeof oracleFusionHcmListTimeCardsBodySchema>
export type OracleFusionHcmListTimeCardsResponse = z.output<typeof oracleFusionHcmListTimeCardsResponseSchema>

export const oracleFusionHcmGetTimeCardBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeRecordGroupId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetTimeCardResponseSchema = successResponse(z.object({
  timeCard: oracleFusionHcmTimeCardSchema,
}))

export type OracleFusionHcmGetTimeCardBody = z.output<typeof oracleFusionHcmGetTimeCardBodySchema>
export type OracleFusionHcmGetTimeCardBodyInput = z.input<typeof oracleFusionHcmGetTimeCardBodySchema>
export type OracleFusionHcmGetTimeCardResponse = z.output<typeof oracleFusionHcmGetTimeCardResponseSchema>

export const oracleFusionHcmListTimeAttributesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  search: z.string().trim().min(1).max(200).optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListTimeAttributesResponseSchema = successResponse(z.object({
  timeAttributes: z.array(oracleFusionHcmTimeAttributeSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeAttributesBody = z.output<typeof oracleFusionHcmListTimeAttributesBodySchema>
export type OracleFusionHcmListTimeAttributesBodyInput = z.input<typeof oracleFusionHcmListTimeAttributesBodySchema>
export type OracleFusionHcmListTimeAttributesResponse = z.output<typeof oracleFusionHcmListTimeAttributesResponseSchema>

export const oracleFusionHcmListTimeAttributeDataSourcesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeAttributeId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListTimeAttributeDataSourcesResponseSchema = successResponse(z.object({
  timeAttributeDataSources: z.array(oracleFusionHcmTimeAttributeDataSourceSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeAttributeDataSourcesBody = z.output<typeof oracleFusionHcmListTimeAttributeDataSourcesBodySchema>
export type OracleFusionHcmListTimeAttributeDataSourcesBodyInput = z.input<typeof oracleFusionHcmListTimeAttributeDataSourcesBodySchema>
export type OracleFusionHcmListTimeAttributeDataSourcesResponse = z.output<typeof oracleFusionHcmListTimeAttributeDataSourcesResponseSchema>

export const oracleFusionHcmListTimeAttributeCriteriaBindsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeAttributeId: oracleFusionHcmDecimalIdSchema,
  dataSourceUsageId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListTimeAttributeCriteriaBindsResponseSchema = successResponse(z.object({
  timeAttributeCriteriaBinds: z.array(oracleFusionHcmTimeAttributeCriteriaBindSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeAttributeCriteriaBindsBody = z.output<typeof oracleFusionHcmListTimeAttributeCriteriaBindsBodySchema>
export type OracleFusionHcmListTimeAttributeCriteriaBindsBodyInput = z.input<typeof oracleFusionHcmListTimeAttributeCriteriaBindsBodySchema>
export type OracleFusionHcmListTimeAttributeCriteriaBindsResponse = z.output<typeof oracleFusionHcmListTimeAttributeCriteriaBindsResponseSchema>

export const oracleFusionHcmListTimeAttributeValuesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  dataSourceUsageId: oracleFusionHcmDecimalIdSchema,
  timeAttributeUsageId: oracleFusionHcmDecimalIdSchema,
  bindings: z.array(z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(80), value: finderValueSchema }).strict()).max(5).refine((values) => new Set(values.map((value) => value.name)).size === values.length, 'Binding names must be unique').optional(),
  ...paginationBodyShape,
})

export const oracleFusionHcmListTimeAttributeValuesResponseSchema = successResponse(z.object({
  timeAttributeValues: z.array(oracleFusionHcmTimeAttributeValueSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeAttributeValuesBody = z.output<typeof oracleFusionHcmListTimeAttributeValuesBodySchema>
export type OracleFusionHcmListTimeAttributeValuesBodyInput = z.input<typeof oracleFusionHcmListTimeAttributeValuesBodySchema>
export type OracleFusionHcmListTimeAttributeValuesResponse = z.output<typeof oracleFusionHcmListTimeAttributeValuesResponseSchema>

export const oracleFusionHcmCreateTimeEntryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30),
  assignmentNumber: z.string().trim().min(1).max(255).optional(),
  startTime: timeTimestampSchema.optional(),
  stopTime: timeTimestampSchema.optional(),
  measure: z.number().finite().positive().optional(),
  referenceDate: dateSchema.optional(),
  payrollTimeType: z.string().trim().min(1).max(150).optional(),
  timeAttributes: z.array(z.object({ attributeName: z.string().trim().min(1).max(240), attributeValue: z.string().max(150) }).strict()).max(30).refine((values) => new Set(values.map((value) => value.attributeName)).size === values.length && values.every((value) => value.attributeName !== 'PayrollTimeType'), 'Attribute names must be unique; use payrollTimeType for PayrollTimeType').optional(),
  processMode: z.enum(['TIME_ENTER', 'TIME_SAVE', 'TIME_SUBMIT']).default('TIME_ENTER'),
  changeReason: z.string().trim().min(1).max(64).optional(),
}).superRefine((input, context) => {
  // Oracle permits measure alongside a range; referenceDate controls multi-day processing.
  if (input.measure === undefined && (!input.startTime || !input.stopTime)) {
    context.addIssue({ code: 'custom', message: 'Supply a complete time range or measure' })
  }
  if (input.startTime && input.stopTime && Date.parse(input.startTime) >= Date.parse(input.stopTime)) {
    context.addIssue({ code: 'custom', message: 'stopTime must be after startTime' })
  }
})

export const oracleFusionHcmCreateTimeEntryResponseSchema = successResponse(z.object({
  timeRecordRequest: oracleFusionHcmTimeRecordRequestSchema,
}))

export type OracleFusionHcmCreateTimeEntryBody = z.output<typeof oracleFusionHcmCreateTimeEntryBodySchema>
export type OracleFusionHcmCreateTimeEntryBodyInput = z.input<typeof oracleFusionHcmCreateTimeEntryBodySchema>
export type OracleFusionHcmCreateTimeEntryResponse = z.output<typeof oracleFusionHcmCreateTimeEntryResponseSchema>

export const oracleFusionHcmUpdateTimeEntryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30),
  assignmentNumber: z.string().trim().min(1).max(255).optional(),
  timeRecordId: oracleFusionHcmDecimalIdSchema,
  timeRecordVersion: z.number().int().positive().max(2_147_483_647),
  startTime: timeTimestampSchema.optional(),
  stopTime: timeTimestampSchema.optional(),
  measure: z.number().finite().positive().optional(),
  referenceDate: dateSchema.optional(),
  payrollTimeType: z.string().trim().min(1).max(150).optional(),
  timeAttributes: z.array(z.object({ attributeName: z.string().trim().min(1).max(240), attributeValue: z.string().max(150) }).strict()).max(30).refine((values) => new Set(values.map((value) => value.attributeName)).size === values.length && values.every((value) => value.attributeName !== 'PayrollTimeType'), 'Attribute names must be unique; use payrollTimeType for PayrollTimeType').optional(),
  processMode: z.enum(['TIME_ENTER', 'TIME_SAVE', 'TIME_SUBMIT']).default('TIME_ENTER'),
  changeReason: z.string().trim().min(1).max(64).optional(),
}).superRefine((input, context) => {
  // UPDATE may change only stopTime, as shown in Oracle's Update Time Entries example.
  if (
    input.startTime === undefined &&
    input.stopTime === undefined &&
    input.measure === undefined &&
    input.referenceDate === undefined &&
    input.payrollTimeType === undefined &&
    !input.timeAttributes?.length
  ) {
    context.addIssue({ code: 'custom', message: 'Supply at least one time or attribute change' })
  }
  if (input.startTime && input.stopTime && Date.parse(input.startTime) >= Date.parse(input.stopTime)) {
    context.addIssue({ code: 'custom', message: 'stopTime must be after startTime' })
  }
})

export const oracleFusionHcmUpdateTimeEntryResponseSchema = successResponse(z.object({
  timeRecordRequest: oracleFusionHcmTimeRecordRequestSchema,
}))

export type OracleFusionHcmUpdateTimeEntryBody = z.output<typeof oracleFusionHcmUpdateTimeEntryBodySchema>
export type OracleFusionHcmUpdateTimeEntryBodyInput = z.input<typeof oracleFusionHcmUpdateTimeEntryBodySchema>
export type OracleFusionHcmUpdateTimeEntryResponse = z.output<typeof oracleFusionHcmUpdateTimeEntryResponseSchema>

export const oracleFusionHcmDeleteTimeEntryBodySchema = oracleFusionHcmBaseBodySchema.extend({
  personNumber: z.string().trim().min(1).max(30),
  assignmentNumber: z.string().trim().min(1).max(255).optional(),
  timeRecordId: oracleFusionHcmDecimalIdSchema,
  timeRecordVersion: z.number().int().positive().max(2_147_483_647),
  processMode: z.enum(['TIME_ENTER', 'TIME_SAVE', 'TIME_SUBMIT']).default('TIME_ENTER'),
  changeReason: z.string().trim().min(1).max(64).optional(),
})

export const oracleFusionHcmDeleteTimeEntryResponseSchema = successResponse(z.object({
  timeRecordRequest: oracleFusionHcmTimeRecordRequestSchema,
}))

export type OracleFusionHcmDeleteTimeEntryBody = z.output<typeof oracleFusionHcmDeleteTimeEntryBodySchema>
export type OracleFusionHcmDeleteTimeEntryBodyInput = z.input<typeof oracleFusionHcmDeleteTimeEntryBodySchema>
export type OracleFusionHcmDeleteTimeEntryResponse = z.output<typeof oracleFusionHcmDeleteTimeEntryResponseSchema>

export const oracleFusionHcmGetTimeRecordRequestBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeRecordEventRequestId: oracleFusionHcmDecimalIdSchema,
})

export const oracleFusionHcmGetTimeRecordRequestResponseSchema = successResponse(z.object({
  timeRecordRequest: oracleFusionHcmTimeRecordRequestSchema,
}))

export type OracleFusionHcmGetTimeRecordRequestBody = z.output<typeof oracleFusionHcmGetTimeRecordRequestBodySchema>
export type OracleFusionHcmGetTimeRecordRequestBodyInput = z.input<typeof oracleFusionHcmGetTimeRecordRequestBodySchema>
export type OracleFusionHcmGetTimeRecordRequestResponse = z.output<typeof oracleFusionHcmGetTimeRecordRequestResponseSchema>

export const oracleFusionHcmListTimeRecordRequestEventsBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeRecordEventRequestId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListTimeRecordRequestEventsResponseSchema = successResponse(z.object({
  timeRecordRequestEvents: z.array(oracleFusionHcmTimeRecordRequestEventSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeRecordRequestEventsBody = z.output<typeof oracleFusionHcmListTimeRecordRequestEventsBodySchema>
export type OracleFusionHcmListTimeRecordRequestEventsBodyInput = z.input<typeof oracleFusionHcmListTimeRecordRequestEventsBodySchema>
export type OracleFusionHcmListTimeRecordRequestEventsResponse = z.output<typeof oracleFusionHcmListTimeRecordRequestEventsResponseSchema>

export const oracleFusionHcmListTimeRecordEventMessagesBodySchema = oracleFusionHcmBaseBodySchema.extend({
  timeRecordEventRequestId: oracleFusionHcmDecimalIdSchema,
  timeRecordEventId: oracleFusionHcmDecimalIdSchema,
  ...paginationBodyShape,
})

export const oracleFusionHcmListTimeRecordEventMessagesResponseSchema = successResponse(z.object({
  timeRecordEventMessages: z.array(oracleFusionHcmTimeRecordEventMessageSchema),
  ...paginationResponseShape,
}))

export type OracleFusionHcmListTimeRecordEventMessagesBody = z.output<typeof oracleFusionHcmListTimeRecordEventMessagesBodySchema>
export type OracleFusionHcmListTimeRecordEventMessagesBodyInput = z.input<typeof oracleFusionHcmListTimeRecordEventMessagesBodySchema>
export type OracleFusionHcmListTimeRecordEventMessagesResponse = z.output<typeof oracleFusionHcmListTimeRecordEventMessagesResponseSchema>
