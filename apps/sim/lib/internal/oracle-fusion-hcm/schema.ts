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
