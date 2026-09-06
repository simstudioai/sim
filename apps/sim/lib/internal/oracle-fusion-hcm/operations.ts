import { filterUndefined, isRecordLike } from '@sim/utils/object'
import {
  type OracleFusionRequest,
  type OracleFusionResolvedCredential,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  type OracleFusionCollectionOptions,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import {
  projectAbsence,
  projectAbsenceType,
  projectAssignedPayroll,
  projectAssignment,
  projectBusinessUnit,
  projectDepartment,
  projectDevelopmentGoal,
  projectDirectReport,
  projectElementEntry,
  projectElementEntryValue,
  projectGoalPlan,
  projectGrade,
  projectGradeRateValue,
  projectJob,
  projectJobFamily,
  projectLegalEmployer,
  projectLocation,
  projectManager,
  projectPayrollAssignment,
  projectPayrollBalance,
  projectPayrollDefinition,
  projectPayrollElementDefinition,
  projectPayrollInputValue,
  projectPayrollRelationship,
  projectPayrollRunResult,
  projectPayrollTimePeriod,
  projectPerformanceDocument,
  projectPerformanceDocumentParticipant,
  projectPerformanceDocumentRole,
  projectPerformanceDocumentTask,
  projectPerformanceGoal,
  projectPersonProcessResult,
  projectPersonType,
  projectPosition,
  projectRateSalaryComponent,
  projectSalary,
  projectSalaryBasis,
  projectSimpleSalaryComponent,
  projectStandardSalaryComponent,
  projectTalentProfile,
  projectTalentProfileCertification,
  projectTalentProfileSection,
  projectTalentProfileSkill,
  projectTimeAttribute,
  projectTimeAttributeCriteriaBind,
  projectTimeAttributeDataSource,
  projectTimeAttributeValue,
  projectTimeCard,
  projectTimeRecord,
  projectTimeRecordEventMessage,
  projectTimeRecordRequest,
  projectTimeRecordRequestEvent,
  projectWorker,
} from '@/lib/internal/oracle-fusion-hcm/projectors'
import type {
  OracleFusionHcmCorrectSalaryBody,
  OracleFusionHcmCreateAssignedPayrollBody,
  OracleFusionHcmCreateElementEntryBody,
  OracleFusionHcmCreateSalaryBody,
  OracleFusionHcmCreateTimeEntryBody,
  OracleFusionHcmDeleteTimeEntryBody,
  OracleFusionHcmGetAbsenceBody,
  OracleFusionHcmGetAssignedPayrollBody,
  OracleFusionHcmGetDevelopmentGoalBody,
  OracleFusionHcmGetElementEntryBody,
  OracleFusionHcmGetGoalPlanBody,
  OracleFusionHcmGetPayrollAssignmentBody,
  OracleFusionHcmGetPayrollRelationshipBody,
  OracleFusionHcmGetPerformanceDocumentBody,
  OracleFusionHcmGetPerformanceGoalBody,
  OracleFusionHcmGetPersonProcessResultBody,
  OracleFusionHcmGetSalaryBody,
  OracleFusionHcmGetTalentProfileBody,
  OracleFusionHcmGetTimeCardBody,
  OracleFusionHcmGetTimeRecordBody,
  OracleFusionHcmGetTimeRecordRequestBody,
  OracleFusionHcmGetWorkerAssignmentBody,
  OracleFusionHcmGetWorkerBody,
  OracleFusionHcmListAbsenceTypesBody,
  OracleFusionHcmListAbsencesBody,
  OracleFusionHcmListAssignedPayrollsBody,
  OracleFusionHcmListBusinessUnitsBody,
  OracleFusionHcmListDepartmentsBody,
  OracleFusionHcmListDevelopmentGoalsBody,
  OracleFusionHcmListElementEntriesBody,
  OracleFusionHcmListElementEntryValuesBody,
  OracleFusionHcmListGoalPlansBody,
  OracleFusionHcmListGradeRateValuesBody,
  OracleFusionHcmListGradesBody,
  OracleFusionHcmListJobFamiliesBody,
  OracleFusionHcmListJobsBody,
  OracleFusionHcmListLegalEmployersBody,
  OracleFusionHcmListLocationsBody,
  OracleFusionHcmListPayrollAssignmentsBody,
  OracleFusionHcmListPayrollBalancesBody,
  OracleFusionHcmListPayrollDefinitionsBody,
  OracleFusionHcmListPayrollElementDefinitionsBody,
  OracleFusionHcmListPayrollInputValuesBody,
  OracleFusionHcmListPayrollRelationshipsBody,
  OracleFusionHcmListPayrollRunResultsBody,
  OracleFusionHcmListPayrollTimePeriodsBody,
  OracleFusionHcmListPerformanceDocumentParticipantsBody,
  OracleFusionHcmListPerformanceDocumentRolesBody,
  OracleFusionHcmListPerformanceDocumentTasksBody,
  OracleFusionHcmListPerformanceDocumentsBody,
  OracleFusionHcmListPerformanceGoalsBody,
  OracleFusionHcmListPersonProcessResultsBody,
  OracleFusionHcmListPersonTypesBody,
  OracleFusionHcmListPositionsBody,
  OracleFusionHcmListSalariesBody,
  OracleFusionHcmListSalaryBasesBody,
  OracleFusionHcmListSalaryComponentsBody,
  OracleFusionHcmListTalentProfileCertificationsBody,
  OracleFusionHcmListTalentProfileSectionsBody,
  OracleFusionHcmListTalentProfileSkillsBody,
  OracleFusionHcmListTalentProfilesBody,
  OracleFusionHcmListTimeAttributeCriteriaBindsBody,
  OracleFusionHcmListTimeAttributeDataSourcesBody,
  OracleFusionHcmListTimeAttributeValuesBody,
  OracleFusionHcmListTimeAttributesBody,
  OracleFusionHcmListTimeCardsBody,
  OracleFusionHcmListTimeRecordEventMessagesBody,
  OracleFusionHcmListTimeRecordRequestEventsBody,
  OracleFusionHcmListTimeRecordsBody,
  OracleFusionHcmListWorkerAssignmentsBody,
  OracleFusionHcmListWorkerDirectReportsBody,
  OracleFusionHcmListWorkerManagersBody,
  OracleFusionHcmListWorkersBody,
  OracleFusionHcmUpdateAssignedPayrollBody,
  OracleFusionHcmUpdateElementEntryValueBody,
  OracleFusionHcmUpdateTimeEntryBody,
} from '@/lib/internal/oracle-fusion-hcm/schema'

type Credentials = OracleFusionResolvedCredential
type PageInput = Credentials & { limit?: number; offset?: number }
type SearchInput = PageInput & { search?: string; effectiveDate?: string }
type Query = Record<string, string | number | boolean | undefined>

interface PageResult<T> {
  items: T[]
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
  nextOffset?: number
}

const WORKER_COLLECTION_PATH = 'publicWorkers'
const WORKER_FIELDS =
  'PersonId,PersonNumber,DisplayName,FullName,FirstName,LastName,KnownAs,WorkEmail,Username'
const ASSIGNMENT_FIELDS =
  'AssignmentId,AssignmentNumber,AssignmentName,StartDate,PrimaryFlag,PrimaryAssignmentFlag,WorkerType,WorkerNumber,FullPartTime,LegalEmployerName,BusinessUnitName,DepartmentName,JobCode,JobName,PositionCode,PositionName,LocationCode,LocationName,ManagerName'
const MANAGER_FIELDS =
  'AssignmentSupervisorId,ManagerAssignmentId,ManagerAssignmentNumber,ManagerAssignmentName,ManagerPersonId,ManagerPersonNumber,DisplayName,FirstName,KnownAs,LastName,ManagerType,ManagerTypeMeaning,JobCode,JobName,PositionCode,PositionName,WorkEmail'
const DIRECT_REPORT_FIELDS =
  'AssignmentId,AssignmentNumber,AssignmentName,PersonId,PersonNumber,DisplayName,FirstName,KnownAs,LastName,RelationshipType,RelationshipTypeMeaning,WorkerType,DirectReportsCount,AllReportsCount'
const ABSENCE_FIELDS =
  'personAbsenceEntryId,personId,personNumber,absenceTypeId,absenceType,absenceStatusCd,absenceDispStatus,absenceDispStatusMeaning,approvalStatusCd,assignmentId,assignmentName,assignmentNumber,startDate,startTime,endDate,endTime,duration,formattedDuration,unitOfMeasure,unitOfMeasureMeaning,openEndedFlag,singleDayFlag,employer,lastUpdateDate'
const ABSENCE_TYPE_FIELDS =
  'AbsenceTypeId,AbsenceTypeName,AbsTypeWithEmployerName,Description,EmployerId,EmployerName,DurationCalculationBasis,DurationUOMCode,DurationUOMCodeMeaning,DisplaySequence'
const JOB_FIELDS =
  'JobId,JobCode,Name,ActiveStatus,JobFamilyId,JobFunctionCode,ManagerLevel,RegularTemporary,FullPartTime,EffectiveStartDate,EffectiveEndDate,LastUpdateDate'
const JOB_FAMILY_FIELDS =
  'JobFamilyId,JobFamilyCode,JobFamilyName,ActiveStatus,EffectiveStartDate,EffectiveEndDate,LastUpdateDate'
const DEPARTMENT_FIELDS =
  'OrganizationId,OrganizationCode,Name,ClassificationCode,Status,LocationId,EffectiveStartDate,EffectiveEndDate,LastUpdateDate'
const LOCATION_FIELDS =
  'LocationId,LocationCode,LocationName,Description,ActiveStatus,Country,TownOrCity,Region1,Region2,Region3,PostalCode,EffectiveStartDate,EffectiveEndDate,LastUpdateDate'
const POSITION_FIELDS =
  'PositionId,PositionCode,Name,ActiveStatus,PositionType,JobId,DepartmentId,LocationId,BusinessUnitId,RegularTemporary,FullPartTime,HiringStatus,EffectiveStartDate,EffectiveEndDate,LastUpdateDate'
const BUSINESS_UNIT_FIELDS = 'BusinessUnitId,Name,Status'
const LEGAL_EMPLOYER_FIELDS =
  'OrganizationId,Name,LegislationCode,EffectiveStartDate,EffectiveEndDate'
const GRADE_FIELDS =
  'GradeId,GradeCode,GradeName,ActiveStatus,CategoryCode,SetId,EffectiveStartDate,EffectiveEndDate,LastUpdateDate'
const PERSON_TYPE_FIELDS = 'PersonTypeId,SystemPersonType,UserPersonType,ActiveFlag,DefaultFlag'

function credentials(input: Credentials): Credentials {
  return { instanceUrl: input.instanceUrl, accessToken: input.accessToken }
}

function pageQuery(input: PageInput, fields: string): Query {
  return {
    fields,
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
    onlyData: true,
  }
}

function quoteOracle(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[%_*?]/g, '\\$&')
    .replace(/'/g, "''")
}

function addSearch(query: Query, search: string | undefined, fields: string[]): void {
  if (!search) return
  const needle = quoteOracle(search)
  query.q = fields.map((field) => `${field} LIKE '%${needle}%'`).join(' OR ')
}

function addEffectiveDate(query: Query, effectiveDate?: string): void {
  if (effectiveDate) query.effectiveDate = effectiveDate
}

async function request(
  input: Credentials,
  path: string,
  query: Query,
  signal?: AbortSignal,
  mutation?: Omit<
    Extract<OracleFusionRequest, { method: 'POST' | 'PATCH' | 'PUT' }>,
    'address' | 'query'
  >
): Promise<unknown> {
  try {
    const result = await requestOracleFusionJson(
      credentials(input),
      mutation
        ? { ...mutation, address: { family: 'hcm', relativePath: path }, query }
        : { address: { family: 'hcm', relativePath: path }, query },
      signal
    )
    signal?.throwIfAborted()
    return result
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      const message =
        error.status === 401
          ? 'Oracle Fusion HCM authentication failed'
          : error.status === 403
            ? 'Oracle Fusion HCM denied this request'
            : error.status === 404
              ? 'Oracle Fusion HCM resource was not found'
              : error.status === 429
                ? 'Oracle Fusion HCM rate limit exceeded'
                : error.status === 504
                  ? 'Oracle Fusion HCM request timed out'
                  : 'Oracle Fusion HCM request failed'
      throw new OracleFusionProviderError(message, error.status)
    }
    throw error
  }
}

function parseCollection<T>(
  value: unknown,
  project: (item: unknown, index: number) => T,
  options: OracleFusionCollectionOptions
): PageResult<T> {
  try {
    return parseOracleFusionCollection(value, project, options)
  } catch (error) {
    if (error instanceof OracleFusionProviderError) throw error
    throw new OracleFusionProviderError('Oracle Fusion HCM returned an invalid collection', 502)
  }
}

function validateSelfLink(value: unknown, input: Credentials, expectedPath: string): void {
  try {
    validateOracleFusionSelfLink(value, input.instanceUrl, {
      family: 'hcm',
      relativePath: expectedPath,
    })
  } catch {
    throw new OracleFusionProviderError('Oracle Fusion HCM returned an invalid self link', 502)
  }
}

function extractOpaqueKey(value: unknown, input: Credentials, collectionPath: string): string {
  try {
    return encodeOracleFusionPathSegment(
      extractOracleFusionOpaqueKey(value, input.instanceUrl, {
        family: 'hcm',
        relativePath: collectionPath,
      })
    )
  } catch {
    throw new OracleFusionProviderError('Oracle Fusion HCM returned an invalid self link', 502)
  }
}

async function list<T>(
  input: PageInput,
  path: string,
  fields: string,
  project: (value: unknown) => T,
  configure?: (query: Query) => void,
  signal?: AbortSignal
): Promise<PageResult<T>> {
  const query = pageQuery(input, fields)
  configure?.(query)
  return parseCollection(await request(input, path, query, signal), project, {
    expectedOffset: input.offset ?? 0,
    maxItems: input.limit ?? 20,
  })
}

async function getItem<T>(
  input: Credentials,
  path: string,
  expectedPath: string,
  fields: string,
  project: (value: unknown) => T,
  signal?: AbortSignal
): Promise<T> {
  const raw = await request(input, path, { fields, links: 'self' }, signal)
  validateSelfLink(raw, input, expectedPath)
  return project(raw)
}

async function resolveWorkerKey(
  input: Credentials & { personId: string },
  signal?: AbortSignal
): Promise<string> {
  const raw = await request(
    input,
    'publicWorkers',
    {
      fields: WORKER_FIELDS,
      q: `PersonId=${input.personId}`,
      limit: 2,
      offset: 0,
      links: 'self',
    },
    signal
  )
  const result = parseCollection(raw, (item) => ({ raw: item, worker: projectWorker(item) }), {
    expectedOffset: 0,
    maxItems: 2,
  })
  if (result.items.length === 0 && !result.hasMore) {
    throw new OracleFusionProviderError('Oracle Fusion HCM worker was not found', 404)
  }
  if (result.items.length !== 1 || result.hasMore) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned multiple workers for one person ID',
      502
    )
  }
  const [match] = result.items
  if (match.worker.personId !== input.personId) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned a different worker than requested',
      502
    )
  }
  return extractOpaqueKey(match.raw, input, WORKER_COLLECTION_PATH)
}

async function resolveAssignmentKey(
  input: Credentials & { personId: string; assignmentId: string },
  workerKey: string,
  signal?: AbortSignal
): Promise<string> {
  const collectionResourcePath = `publicWorkers/${workerKey}/child/assignments`
  const collectionPath = collectionResourcePath
  const raw = await request(
    input,
    collectionResourcePath,
    {
      fields: ASSIGNMENT_FIELDS,
      q: `AssignmentId=${input.assignmentId}`,
      limit: 2,
      offset: 0,
      links: 'self',
    },
    signal
  )
  const result = parseCollection(
    raw,
    (item) => ({
      raw: item,
      assignment: projectAssignment(item),
    }),
    { expectedOffset: 0, maxItems: 2 }
  )
  if (result.items.length === 0 && !result.hasMore) {
    throw new OracleFusionProviderError('Oracle Fusion HCM assignment was not found', 404)
  }
  if (result.items.length !== 1 || result.hasMore) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned multiple assignments for one assignment ID',
      502
    )
  }
  const [match] = result.items
  if (match.assignment.assignmentId !== input.assignmentId) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned a different assignment than requested',
      502
    )
  }
  return extractOpaqueKey(match.raw, input, collectionPath)
}

export async function executeOracleFusionHcmListWorkers(
  input: OracleFusionHcmListWorkersBody,
  signal?: AbortSignal
) {
  const result = await list(
    input,
    'publicWorkers',
    WORKER_FIELDS,
    projectWorker,
    (query) => addSearch(query, input.search, ['PersonNumber', 'DisplayName', 'WorkEmail']),
    signal
  )
  return { success: true as const, output: { workers: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmGetWorker(
  input: OracleFusionHcmGetWorkerBody,
  signal?: AbortSignal
) {
  const workerKey = await resolveWorkerKey(input, signal)
  const resourcePath = `publicWorkers/${workerKey}`
  const worker = await getItem(
    input,
    resourcePath,
    resourcePath,
    WORKER_FIELDS,
    projectWorker,
    signal
  )
  if (worker.personId !== input.personId) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned a different worker than requested',
      502
    )
  }
  return { success: true as const, output: { worker } }
}

export async function executeOracleFusionHcmListWorkerAssignments(
  input: OracleFusionHcmListWorkerAssignmentsBody,
  signal?: AbortSignal
) {
  const workerKey = await resolveWorkerKey(input, signal)
  const result = await list(
    input,
    `publicWorkers/${workerKey}/child/assignments`,
    ASSIGNMENT_FIELDS,
    projectAssignment,
    undefined,
    signal
  )
  return { success: true as const, output: { assignments: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmGetWorkerAssignment(
  input: OracleFusionHcmGetWorkerAssignmentBody,
  signal?: AbortSignal
) {
  const workerKey = await resolveWorkerKey(input, signal)
  const assignmentKey = await resolveAssignmentKey(input, workerKey, signal)
  const resourcePath = `publicWorkers/${workerKey}/child/assignments/${assignmentKey}`
  const assignment = await getItem(
    input,
    resourcePath,
    resourcePath,
    ASSIGNMENT_FIELDS,
    projectAssignment,
    signal
  )
  if (assignment.assignmentId !== input.assignmentId) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned a different assignment than requested',
      502
    )
  }
  return { success: true as const, output: { assignment } }
}

export async function executeOracleFusionHcmListWorkerManagers(
  input: OracleFusionHcmListWorkerManagersBody,
  signal?: AbortSignal
) {
  const workerKey = await resolveWorkerKey(input, signal)
  const assignmentKey = await resolveAssignmentKey(input, workerKey, signal)
  const result = await list(
    input,
    `publicWorkers/${workerKey}/child/assignments/${assignmentKey}/child/managers`,
    MANAGER_FIELDS,
    projectManager,
    undefined,
    signal
  )
  return { success: true as const, output: { managers: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListWorkerDirectReports(
  input: OracleFusionHcmListWorkerDirectReportsBody,
  signal?: AbortSignal
) {
  const workerKey = await resolveWorkerKey(input, signal)
  const assignmentKey = await resolveAssignmentKey(input, workerKey, signal)
  const result = await list(
    input,
    `publicWorkers/${workerKey}/child/assignments/${assignmentKey}/child/directReports`,
    DIRECT_REPORT_FIELDS,
    projectDirectReport,
    undefined,
    signal
  )
  return {
    success: true as const,
    output: { directReports: result.items, ...withoutItems(result) },
  }
}

export async function executeOracleFusionHcmListAbsences(
  input: OracleFusionHcmListAbsencesBody,
  signal?: AbortSignal
) {
  const result = await list(
    input,
    'absences',
    ABSENCE_FIELDS,
    projectAbsence,
    (query) => {
      if (input.startDate && input.endDate && input.absenceTypeId) {
        query.finder = `findByPersonAbsenceTypeIdAndAbsDate;absenceTypeId=${input.absenceTypeId},endDate=${input.endDate},personId=${input.personId},startDate=${input.startDate}`
      } else if (input.absenceTypeId) {
        query.finder = `findByPersonAndAbsenceTypeId;absenceTypeId=${input.absenceTypeId},personId=${input.personId}`
      } else {
        query.finder = `findByPersonId;personId=${input.personId}`
      }
    },
    signal
  )
  return { success: true as const, output: { absences: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmGetAbsence(
  input: OracleFusionHcmGetAbsenceBody,
  signal?: AbortSignal
) {
  const result = await list(
    { ...input, limit: 2, offset: 0 },
    'absences',
    ABSENCE_FIELDS,
    projectAbsence,
    (query) => {
      query.finder = `findByAbsenceEntryId;personAbsenceEntryId=${input.absenceId}`
    },
    signal
  )
  if (result.items.length === 0 && !result.hasMore) {
    throw new OracleFusionProviderError('Oracle Fusion HCM absence was not found', 404)
  }
  if (result.items.length !== 1 || result.hasMore) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned multiple absences for one absence ID',
      502
    )
  }
  const [absence] = result.items
  if (absence.absenceId !== input.absenceId) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned a different absence than requested',
      502
    )
  }
  return { success: true as const, output: { absence } }
}

export async function executeOracleFusionHcmListAbsenceTypes(
  input: OracleFusionHcmListAbsenceTypesBody,
  signal?: AbortSignal
) {
  const result = await list(
    input,
    'absenceTypesLOV',
    ABSENCE_TYPE_FIELDS,
    projectAbsenceType,
    (query) => {
      const args = [`PersonId=${input.personId}`]
      if (input.search) args.push(`SearchTerms=${input.search.replace(/[,;]/g, ' ')}`)
      if (input.effectiveDate) args.push(`AbsenceTypeEffectiveDate=${input.effectiveDate}`)
      query.finder = `findByWord;${args.join(',')}`
    },
    signal
  )
  return { success: true as const, output: { absenceTypes: result.items, ...withoutItems(result) } }
}

async function structureList<T>(
  input: SearchInput,
  path: string,
  fields: string,
  searchFields: string[],
  project: (value: unknown) => T,
  signal?: AbortSignal
) {
  return list(
    input,
    path,
    fields,
    project,
    (query) => {
      addSearch(query, input.search, searchFields)
      addEffectiveDate(query, input.effectiveDate)
    },
    signal
  )
}

function withoutItems<T>(value: PageResult<T>) {
  return {
    count: value.count,
    hasMore: value.hasMore,
    limit: value.limit,
    offset: value.offset,
    ...(value.totalResults === undefined ? {} : { totalResults: value.totalResults }),
    ...(!value.hasMore || value.nextOffset === undefined ? {} : { nextOffset: value.nextOffset }),
  }
}

export async function executeOracleFusionHcmListJobs(
  input: OracleFusionHcmListJobsBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'jobs',
    JOB_FIELDS,
    ['JobCode', 'Name'],
    projectJob,
    signal
  )
  return { success: true as const, output: { jobs: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListJobFamilies(
  input: OracleFusionHcmListJobFamiliesBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'jobFamilies',
    JOB_FAMILY_FIELDS,
    ['JobFamilyCode', 'JobFamilyName'],
    projectJobFamily,
    signal
  )
  return { success: true as const, output: { jobFamilies: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListDepartments(
  input: OracleFusionHcmListDepartmentsBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'organizations',
    DEPARTMENT_FIELDS,
    ['OrganizationCode', 'Name'],
    projectDepartment,
    signal
  )
  return { success: true as const, output: { departments: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListLocations(
  input: OracleFusionHcmListLocationsBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'locations',
    LOCATION_FIELDS,
    ['LocationCode', 'LocationName'],
    projectLocation,
    signal
  )
  return { success: true as const, output: { locations: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListPositions(
  input: OracleFusionHcmListPositionsBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'positions',
    POSITION_FIELDS,
    ['PositionCode', 'Name'],
    projectPosition,
    signal
  )
  return { success: true as const, output: { positions: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListBusinessUnits(
  input: OracleFusionHcmListBusinessUnitsBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'hcmBusinessUnitsLOV',
    BUSINESS_UNIT_FIELDS,
    ['Name'],
    projectBusinessUnit,
    signal
  )
  return {
    success: true as const,
    output: { businessUnits: result.items, ...withoutItems(result) },
  }
}

export async function executeOracleFusionHcmListLegalEmployers(
  input: OracleFusionHcmListLegalEmployersBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'legalEmployersLov',
    LEGAL_EMPLOYER_FIELDS,
    ['Name'],
    projectLegalEmployer,
    signal
  )
  return {
    success: true as const,
    output: { legalEmployers: result.items, ...withoutItems(result) },
  }
}

export async function executeOracleFusionHcmListGrades(
  input: OracleFusionHcmListGradesBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'grades',
    GRADE_FIELDS,
    ['GradeCode', 'GradeName'],
    projectGrade,
    signal
  )
  return { success: true as const, output: { grades: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListPersonTypes(
  input: OracleFusionHcmListPersonTypesBody,
  signal?: AbortSignal
) {
  const result = await structureList(
    input,
    'personTypesLOV',
    PERSON_TYPE_FIELDS,
    ['SystemPersonType', 'UserPersonType'],
    projectPersonType,
    signal
  )
  return { success: true as const, output: { personTypes: result.items, ...withoutItems(result) } }
}

const PAYROLL_RELATIONSHIP_FIELDS =
  'PayrollRelationshipId,PayrollRelationshipNumber,PersonNumber,Country,EffectiveStartDate,EffectiveEndDate,StartDate,EndDate,OverridingPeriodId'
const PAYROLL_ASSIGNMENT_FIELDS =
  'RelationshipGroupId,AssignmentId,AssignmentNumber,EffectiveStartDate,EffectiveEndDate,OverridingPeriodId,TimeCardRequired'
const ASSIGNED_PAYROLL_FIELDS =
  'AssignedPayrollId,PayrollId,PayrollName,StartDate,EndDate,EffectiveStartDate,EffectiveEndDate,Lsed,OverridingPeriodId,TimeCardRequired'
const PAYROLL_DEFINITION_FIELDS =
  'PayrollId,PayrollName,LegislativeDataGroupId,LegislativeDataGroupName,EffectiveStartDate,EffectiveEndDate,PeriodType,ConsolidationSetId,ConsolidationSetName,ReportingName'
const PAYROLL_TIME_PERIOD_FIELDS =
  'TimePeriodId,PayrollId,PayrollName,LegislativeDataGroupId,PeriodName,PeriodNumber,PeriodType,PeriodCategory,StartDate,EndDate,RegularEarnDate,RegularProcessDate,DefaultPaydate,PayslipViewDate,EffectiveStartDate,EffectiveEndDate'
const PAYROLL_ELEMENT_DEFINITION_FIELDS =
  'ElementTypeId,ElementName,PersonId,LegislativeDataGroupId,LegislationCode,EffectiveStartDate,EffectiveEndDate,ProcessingType,UseAtAssignmentLevel,UseAtRelationshipLevel,InputCurrencyCode,OutputCurrencyCode'
const PAYROLL_INPUT_VALUE_FIELDS =
  'InputValueId,InputValueName,ElementTypeId,ElementName,LegislativeDataGroupId,EffectiveStartDate,EffectiveEndDate,UOM,ReservedInputValue,DisplaySequence'
const ELEMENT_ENTRY_FIELDS =
  'ElementEntryId,PersonId,PersonNumber,AssignmentId,AssignmentNumber,ElementTypeId,ElementName,EntryType,CreatorType,EffectiveStartDate,EffectiveEndDate,UsageLevel,ProcessingType,InputCurrencyCode,LegCode,LegDataGroupId,PayrollRelationshipNumber'
const ELEMENT_ENTRY_VALUE_FIELDS =
  'ElementEntryValueId,InputValueId,InputValueName,ScreenEntryValue,UOM,MandatoryFlag,UserEnterableFlag,DisplaySequence'
const PERSON_PROCESS_RESULT_FIELDS =
  'ObjectActionId,PersonId,PersonNumber,AssignmentId,AssignmentNumber,PayrollRelationshipId,PayrollId,Payroll,ActionTypeCode,ActionStatusCode,Status,ProcessDate,ProcessStartDate,ProcessEndDate,FlowInstanceId,FlowName,PayrollPeriodName,LegislationCode,LegislativeDataGroupId'
const PAYROLL_RUN_RESULT_FIELDS =
  'RunResultId,InputValueId,InputValueName,ElementEntryId,ElementTypeId,ElementName,ResultValue,PersonId,AssignmentId,AssignmentNumber,PayrollRelationshipId,DateEarned,OutputCurrencyCode,Inputcurrencycode,Uom,ProrationStartDate,ProrationEndDate'
const PAYROLL_BALANCE_FIELDS =
  'BalanceTypeId,BalanceName,DimensionName,PayrollRelActionId,LegislativeDataGroupId,LegislationCode,Uom,UomCode,CtxString,CtxUserString,Value1,DefbalId1,Value2,DefbalId2,Value3,DefbalId3,Value4,DefbalId4,Value5,DefbalId5,Value6,DefbalId6,Value7,DefbalId7,Value8,DefbalId8,Value9,DefbalId9,Value10,DefbalId10,TotalValue1,TotalValue2'
const SALARY_FIELDS =
  'SalaryId,AssignmentId,AssignmentNumber,PersonId,PersonNumber,SalaryBasisId,SalaryBasisName,SalaryBasisType,SalaryAmount,CurrencyCode,SalaryFrequencyCode,DateFrom,DateTo,AnnualSalary,AnnualFullTimeSalary,MultipleComponents,PendingTransactionExists,SalaryTransactionStatus,SalaryAmountScale'
const SALARY_BASIS_FIELDS =
  'SalaryBasisId,SalaryBasisName,SalaryBasisType,Code,FrequencyCode,FrequencyName,InputCurrencyCode,LegislativeDataGroupId,GradeRateId,ComponentUsage,SalaryAmountScale,Status,UseAtAssignmentLevel,UseAtRelationshipLevel,UseAtTermsLevel'
const STANDARD_SALARY_COMPONENT_FIELDS =
  'SalaryComponentId,SalaryId,ComponentName,ComponentReasonCode,AdjustmentAmount,AdjustmentPercentage,DisplaySequence,ChangeAmountScale'
const SIMPLE_SALARY_COMPONENT_FIELDS =
  'SimpleSalaryCompntId,SalaryId,BasisSimpleComponentId,ComponentName,ComponentCode,ComponentType,CurrencyCode,Amount,AnnualAmount,AnnualFtAmount,AdjustmentAmount,AdjustmentPercent,Percentage,Scale,UserSelectedComponent,OverallSalaryAffect'
const RATE_SALARY_COMPONENT_FIELDS =
  'SalaryPayComponentId,SalaryId,PayRateDefinitionId,Name,ShortName,RateAmount,RateAnnualAmount,RateAnnualFtAmount,RateCurrencyCode,RatePeriodicityCode,RateMinimumAmount,RateMaximumAmount,RateAdjustmentAmount,RateAdjustmentPercent,RateFactor,RateOverallSalaryFlag'
const GRADE_RATE_VALUE_FIELDS =
  'RateValueId,GradeId,EffectiveStartDate,EffectiveEndDate,MinimumAmount,MidValueAmount,MaximumAmount,ValueAmount'
const GOAL_PLAN_FIELDS =
  'GoalPlanId,GoalPlanName,ReviewPeriodId,ReviewPeriodName,StartDate,EndDate,GoalSettingStartDate,GoalSettingEndDate,GoalPlanActiveCode,RestrictGoalCreationFlag,RestrictGoalUpdateFlag,EnableWeightingFlag'
const PERFORMANCE_GOAL_FIELDS =
  'GoalId,PersonId,PersonNumber,AssignmentId,GoalName,Description,StartDate,TargetCompletionDate,Status,StatusMeaning,PercentComplete,ReviewPeriodId'
const DEVELOPMENT_GOAL_FIELDS =
  'GoalId,PersonId,PersonNumber,AssignmentId,AssignmentNumber,GoalName,StartDate,TargetCompletionDate,ActualCompletionDate,Status,StatusMeaning,PercentComplete,PrivateFlag,RequiresApprovalStatus,GoalApprovalState'
const PERFORMANCE_DOCUMENT_FIELDS =
  'EvaluationId,PersonId,PersonNumber,AssignmentId,PerformanceDocumentName,EvalStatus,StatusCode,ReviewPeriodId,StartDate,EndDate,ManagerId,ManagerAssignmentId'
const PERFORMANCE_DOCUMENT_ROLE_FIELDS =
  'EvalRoleId,RoleTypeCode,MinimumNumberPcpns,MatrixParticipantFlag'
const PERFORMANCE_DOCUMENT_PARTICIPANT_FIELDS =
  'EvalParticipantId,EvalRoleId,PersonId,ParticipationStatusCode,DueDate,FdbackCompletionDate,MatrixParticipantFlag,RoleTypeCode'
const PERFORMANCE_DOCUMENT_TASK_FIELDS =
  'EvalStepId,StepCode,StepStatus,TaskName,TaskStatus,DueDate'
const TALENT_PROFILE_FIELDS = 'ProfileId,PersonId,PersonNumber,ProfileCode,DisplayName,StatusCode'
const TALENT_PROFILE_SECTION_FIELDS = 'ProfileSectionId,SectionId,SectionName,SectionContext'
const TALENT_PROFILE_SKILL_FIELDS =
  'SkillId,ProfileId,SectionId,Skill,SkillType,SkillTypeMeaning,DateAchieved,YearsOfExperience,ProjectOrActivity,Source,SourceType'
const TALENT_PROFILE_CERTIFICATION_FIELDS =
  'CertificationId,ProfileId,SectionId,LicenseOrCertificate,Title,IssueDate,ExpirationDate,RenewalDate,Status,StatusMeaning,IssuedBy,Verified,VerifiedMeaning'
const TIME_RECORD_FIELDS =
  'timeRecordId,timeRecordVersion,timeRecordGroupId,timeRecordGroupVersion,personId,personNumber,assignmentNumber,recordType,groupType,startTime,stopTime,measure,unitOfMeasure,earnedDate,overtimeDate'
const TIME_CARD_FIELDS =
  'timeRecordGroupId,timeRecordGroupVersion,personId,personNumber,assignmentNumber,startTime,stopTime,totalHours,groupType,parentTimeRecordGroupId,parentTimeRecordGroupVersion'
const TIME_ATTRIBUTE_FIELDS =
  'tmAtrbFldId,tmAtrbFldUsageId,attributeName,contextCode,displayName,description,name'
const TIME_ATTRIBUTE_DATA_SOURCE_FIELDS = 'dataSourceUsageId,dataSourceUsageCode,tmAtrbFldId'
const TIME_ATTRIBUTE_CRITERIA_BIND_FIELDS = 'bindName,criteriaName,dataType'
const TIME_ATTRIBUTE_VALUE_FIELDS = 'value,displayValue'
const TIME_RECORD_REQUEST_FIELDS = 'timeRecordEventRequestId,processInline,processMode'
const TIME_RECORD_REQUEST_EVENT_FIELDS =
  'timeRecordEventId,timeRecordEventRequestId,timeRecordId,timeRecordVersion,operationType,eventStatus,eventStatusValue,crudStatusValue,personId,reporterId,reporterIdType,assignmentNumber,startTime,stopTime,measure,referenceDate'
const TIME_RECORD_EVENT_MESSAGE_FIELDS =
  'timeRecordEventMessageId,timeRecordId,timeBldgBlkVersion,messageId,messageName,messageField,attributeType,allowException'

/** Only operation-owned finder names/variables reach this formatter; callers cannot supply a finder. */
function finder(name: string, variables: Record<string, string | undefined>): string | undefined {
  const entries = Object.entries(variables).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
  if (entries.length === 0) return undefined
  if (entries.some(([, value]) => /[,;=\r\n]/.test(value))) {
    throw new OracleFusionProviderError('Oracle Fusion HCM finder input contains separators', 400)
  }
  return `${name};${entries.map(([key, value]) => `${key}=${value}`).join(',')}`
}

/** Resolves date-effective/opaque keys within their actual parent, without a public-worker lookup. */
async function resolveResourcePath(
  input: Credentials & { effectiveDate?: string },
  collectionPath: string,
  idField: string,
  id: string,
  signal?: AbortSignal
): Promise<string> {
  const raw = await request(
    input,
    collectionPath,
    {
      fields: idField,
      q: `${idField}=${id}`,
      limit: 2,
      offset: 0,
      links: 'self',
      effectiveDate: input.effectiveDate,
    },
    signal
  )
  const result = parseCollection(raw, (item) => item, { expectedOffset: 0, maxItems: 2 })
  if (result.items.length === 0 && !result.hasMore) {
    throw new OracleFusionProviderError('Oracle Fusion HCM resource was not found', 404)
  }
  if (result.items.length !== 1 || result.hasMore) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned an ambiguous resource identity',
      502
    )
  }
  const [item] = result.items
  if (
    !isRecordLike(item) ||
    normalizeOracleFusionDecimalIdentifier(item[idField], { maxDigits: 19 }) !== id
  ) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned a different resource than requested',
      502
    )
  }
  return `${collectionPath}/${extractOpaqueKey(item, input, collectionPath)}`
}

async function payrollRelationshipPath(
  input: Credentials & { payrollRelationshipId: string; effectiveDate?: string },
  signal?: AbortSignal
) {
  return resolveResourcePath(
    input,
    'payrollRelationships',
    'PayrollRelationshipId',
    input.payrollRelationshipId,
    signal
  )
}

async function payrollAssignmentPath(
  input: Credentials & {
    payrollRelationshipId: string
    payrollAssignmentId: string
    effectiveDate?: string
  },
  signal?: AbortSignal
) {
  const parent = await payrollRelationshipPath(input, signal)
  return resolveResourcePath(
    input,
    `${parent}/child/payrollAssignments`,
    'RelationshipGroupId',
    input.payrollAssignmentId,
    signal
  )
}

async function assignedPayrollPath(
  input: Credentials & {
    payrollRelationshipId: string
    payrollAssignmentId: string
    assignedPayrollId: string
    effectiveDate?: string
  },
  signal?: AbortSignal
) {
  const parent = await payrollAssignmentPath(input, signal)
  return resolveResourcePath(
    input,
    `${parent}/child/assignedPayrolls`,
    'AssignedPayrollId',
    input.assignedPayrollId,
    signal
  )
}

async function elementEntryPath(input: Credentials & { elementEntryId: string; effectiveDate?: string }, signal?: AbortSignal) {
  return resolveResourcePath(input, 'elementEntries', 'ElementEntryId', input.elementEntryId, signal)
}

async function performanceDocumentPath(input: Credentials & { evaluationId: string }, signal?: AbortSignal) {
  return resolveResourcePath(input, 'performanceEvaluations', 'EvaluationId', input.evaluationId, signal)
}

async function talentProfilePath(input: Credentials & { profileId: string }, signal?: AbortSignal) {
  return resolveResourcePath(input, 'talentPersonProfiles', 'ProfileId', input.profileId, signal)
}

async function timeAttributePath(input: Credentials & { timeAttributeId: string }, signal?: AbortSignal) {
  return resolveResourcePath(input, 'timeAttributes', 'tmAtrbFldId', input.timeAttributeId, signal)
}

async function readResource<T>(
  input: Credentials & { effectiveDate?: string },
  path: string,
  fields: string,
  idField: string,
  id: string,
  project: (value: unknown) => T,
  signal?: AbortSignal
): Promise<T> {
  const raw = await request(input, path, { fields, links: 'self', effectiveDate: input.effectiveDate }, signal)
  validateSelfLink(raw, input, path)
  if (!isRecordLike(raw) || normalizeOracleFusionDecimalIdentifier(raw[idField], { maxDigits: 19 }) !== id) {
    throw new OracleFusionProviderError('Oracle Fusion HCM returned a different resource than requested', 502)
  }
  return project(raw)
}

/** Mutations are sent once. A receipt is not evidence of downstream processing completion. */
async function writeResource<T>(
  input: Credentials,
  path: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  project: (value: unknown) => T,
  signal?: AbortSignal,
  effectiveOf?: string
): Promise<T> {
  const raw = await request(input, path, {}, signal, {
    method,
    body: filterUndefined(body),
    mediaType: 'application/json',
    operationHeaders: { effectiveOf },
  })
  if (method === 'PATCH') validateSelfLink(raw, input, path)
  else extractOpaqueKey(raw, input, path)
  return project(raw)
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollrelationships-get.html */
export async function executeOracleFusionHcmListPayrollRelationships(
  input: OracleFusionHcmListPayrollRelationshipsBody,
  signal?: AbortSignal
) {
  const path = 'payrollRelationships'
  const result = await list(input, path, PAYROLL_RELATIONSHIP_FIELDS, projectPayrollRelationship, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['PersonNumber','PayrollRelationshipNumber'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.personNumber) clauses.push(`PersonNumber='${quoteOracle(input.personNumber)}'`)
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { payrollRelationships: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollrelationships-get.html */
export async function executeOracleFusionHcmGetPayrollRelationship(
  input: OracleFusionHcmGetPayrollRelationshipBody,
  signal?: AbortSignal
) {
  const path = await payrollRelationshipPath(input, signal)
  const result = await readResource(input, path, PAYROLL_RELATIONSHIP_FIELDS, 'PayrollRelationshipId', input.payrollRelationshipId, projectPayrollRelationship, signal)
  return { success: true as const, output: { payrollRelationship: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollrelationships-payrollrelationshipsuniqid-child-payrollassignments-get.html */
export async function executeOracleFusionHcmListPayrollAssignments(
  input: OracleFusionHcmListPayrollAssignmentsBody,
  signal?: AbortSignal
) {
  const path = `${await payrollRelationshipPath(input, signal)}/child/payrollAssignments`
  const result = await list(input, path, PAYROLL_ASSIGNMENT_FIELDS, projectPayrollAssignment, (query) => {
    const clauses: string[] = []
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { payrollAssignments: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollrelationships-payrollrelationshipsuniqid-child-payrollassignments-get.html */
export async function executeOracleFusionHcmGetPayrollAssignment(
  input: OracleFusionHcmGetPayrollAssignmentBody,
  signal?: AbortSignal
) {
  const path = await payrollAssignmentPath(input, signal)
  const result = await readResource(input, path, PAYROLL_ASSIGNMENT_FIELDS, 'RelationshipGroupId', input.payrollAssignmentId, projectPayrollAssignment, signal)
  return { success: true as const, output: { payrollAssignment: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollrelationships-payrollrelationshipsuniqid-child-payrollassignments-payrollassignmentsuniqid-child-assignedpayrolls-get.html */
export async function executeOracleFusionHcmListAssignedPayrolls(
  input: OracleFusionHcmListAssignedPayrollsBody,
  signal?: AbortSignal
) {
  const path = `${await payrollAssignmentPath(input, signal)}/child/assignedPayrolls`
  const result = await list(input, path, ASSIGNED_PAYROLL_FIELDS, projectAssignedPayroll, (query) => {
    const clauses: string[] = []
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { assignedPayrolls: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollrelationships-payrollrelationshipsuniqid-child-payrollassignments-payrollassignmentsuniqid-child-assignedpayrolls-get.html */
export async function executeOracleFusionHcmGetAssignedPayroll(
  input: OracleFusionHcmGetAssignedPayrollBody,
  signal?: AbortSignal
) {
  const path = await assignedPayrollPath(input, signal)
  const result = await readResource(input, path, ASSIGNED_PAYROLL_FIELDS, 'AssignedPayrollId', input.assignedPayrollId, projectAssignedPayroll, signal)
  return { success: true as const, output: { assignedPayroll: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrolldefinitionslov-get.html */
export async function executeOracleFusionHcmListPayrollDefinitions(
  input: OracleFusionHcmListPayrollDefinitionsBody,
  signal?: AbortSignal
) {
  const path = 'payrollDefinitionsLOV'
  const result = await list(input, path, PAYROLL_DEFINITION_FIELDS, projectPayrollDefinition, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['PayrollName'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.legislativeDataGroupId) clauses.push(`LegislativeDataGroupId=${input.legislativeDataGroupId}`)
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { payrollDefinitions: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrolltimeperiodslov-get.html */
export async function executeOracleFusionHcmListPayrollTimePeriods(
  input: OracleFusionHcmListPayrollTimePeriodsBody,
  signal?: AbortSignal
) {
  const path = 'payrollTimePeriodsLOV'
  const result = await list(input, path, PAYROLL_TIME_PERIOD_FIELDS, projectPayrollTimePeriod, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['PeriodName'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.payrollId) clauses.push(`PayrollId=${input.payrollId}`)
    if (input.effectiveDate) {
            clauses.push(`EffectiveStartDate <= '${input.effectiveDate}'`, `EffectiveEndDate >= '${input.effectiveDate}'`)
          }
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { payrollTimePeriods: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollelementdefinitionslov-get.html */
export async function executeOracleFusionHcmListPayrollElementDefinitions(
  input: OracleFusionHcmListPayrollElementDefinitionsBody,
  signal?: AbortSignal
) {
  const path = 'payrollElementDefinitionsLOV'
  const result = await list(input, path, PAYROLL_ELEMENT_DEFINITION_FIELDS, projectPayrollElementDefinition, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['ElementName'])
    if (query.q) clauses.push(`(${query.q})`)
    query.finder = finder('findByWord', { PersonId: input.personId, LegislativeDataGroupId: input.legislativeDataGroupId, EffectiveDate: input.effectiveDate })
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { payrollElementDefinitions: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-payrollinputvalueslov-get.html */
export async function executeOracleFusionHcmListPayrollInputValues(
  input: OracleFusionHcmListPayrollInputValuesBody,
  signal?: AbortSignal
) {
  const path = 'payrollInputValuesLOV'
  const result = await list(input, path, PAYROLL_INPUT_VALUE_FIELDS, projectPayrollInputValue, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['InputValueName'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.elementTypeId) clauses.push(`ElementTypeId=${input.elementTypeId}`)
    if (input.effectiveDate) {
            clauses.push(`EffectiveStartDate <= '${input.effectiveDate}'`, `EffectiveEndDate >= '${input.effectiveDate}'`)
          }
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { payrollInputValues: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-elemententries-get.html */
export async function executeOracleFusionHcmListElementEntries(
  input: OracleFusionHcmListElementEntriesBody,
  signal?: AbortSignal
) {
  const path = 'elementEntries'
  const result = await list(input, path, ELEMENT_ENTRY_FIELDS, projectElementEntry, (query) => {
    const clauses: string[] = []
    if (input.personNumber) clauses.push(`PersonNumber='${quoteOracle(input.personNumber)}'`)
    if (input.personId) clauses.push(`PersonId=${input.personId}`)
    if (input.assignmentNumber) clauses.push(`AssignmentNumber='${quoteOracle(input.assignmentNumber)}'`)
    if (input.elementTypeId) clauses.push(`ElementTypeId=${input.elementTypeId}`)
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { elementEntries: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-elemententries-get.html */
export async function executeOracleFusionHcmGetElementEntry(
  input: OracleFusionHcmGetElementEntryBody,
  signal?: AbortSignal
) {
  const path = await elementEntryPath(input, signal)
  const result = await readResource(input, path, ELEMENT_ENTRY_FIELDS, 'ElementEntryId', input.elementEntryId, projectElementEntry, signal)
  return { success: true as const, output: { elementEntry: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-elemententries-elemententriesuniqid-child-elemententryvalues-get.html */
export async function executeOracleFusionHcmListElementEntryValues(
  input: OracleFusionHcmListElementEntryValuesBody,
  signal?: AbortSignal
) {
  const path = `${await elementEntryPath(input, signal)}/child/elementEntryValues`
  const result = await list(input, path, ELEMENT_ENTRY_VALUE_FIELDS, projectElementEntryValue, (query) => {
    const clauses: string[] = []
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { elementEntryValues: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-personprocessresults-get.html */
export async function executeOracleFusionHcmListPersonProcessResults(
  input: OracleFusionHcmListPersonProcessResultsBody,
  signal?: AbortSignal
) {
  const path = 'personProcessResults'
  const result = await list(input, path, PERSON_PROCESS_RESULT_FIELDS, projectPersonProcessResult, (query) => {
    const clauses: string[] = []
    if (input.personNumber) clauses.push(`PersonNumber='${quoteOracle(input.personNumber)}'`)
    if (input.personId) clauses.push(`PersonId=${input.personId}`)
    if (input.payrollRelationshipId) clauses.push(`PayrollRelationshipId=${input.payrollRelationshipId}`)
    if (input.payrollId) clauses.push(`PayrollId=${input.payrollId}`)
    if (input.startDate) clauses.push(`ProcessDate >= '${input.startDate}'`)
          if (input.endDate) clauses.push(`ProcessDate <= '${input.endDate}'`)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { personProcessResults: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-personprocessresults-get.html */
export async function executeOracleFusionHcmGetPersonProcessResult(
  input: OracleFusionHcmGetPersonProcessResultBody,
  signal?: AbortSignal
) {
  const path = `personProcessResults/${input.objectActionId}`
  const result = await readResource(input, path, PERSON_PROCESS_RESULT_FIELDS, 'ObjectActionId', input.objectActionId, projectPersonProcessResult, signal)
  return { success: true as const, output: { personProcessResult: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-personprocessresults-objectactionid-child-runresult-get.html */
export async function executeOracleFusionHcmListPayrollRunResults(
  input: OracleFusionHcmListPayrollRunResultsBody,
  signal?: AbortSignal
) {
  const path = `personProcessResults/${input.objectActionId}/child/RunResult`
  const result = await list(input, path, PAYROLL_RUN_RESULT_FIELDS, projectPayrollRunResult, undefined,
  signal)
  return { success: true as const, output: { payrollRunResults: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-personprocessresults-objectactionid-child-balanceview-get.html */
export async function executeOracleFusionHcmListPayrollBalances(
  input: OracleFusionHcmListPayrollBalancesBody,
  signal?: AbortSignal
) {
  const path = `personProcessResults/${input.objectActionId}/child/BalanceView`
  const result = await list(input, path, PAYROLL_BALANCE_FIELDS, projectPayrollBalance, undefined,
  signal)
  return { success: true as const, output: { payrollBalances: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-salaries-get.html */
export async function executeOracleFusionHcmListSalaries(
  input: OracleFusionHcmListSalariesBody,
  signal?: AbortSignal
) {
  const path = 'salaries'
  const result = await list(input, path, SALARY_FIELDS, projectSalary, (query) => {
    const clauses: string[] = []
    if (input.assignmentId) clauses.push(`AssignmentId=${input.assignmentId}`)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { salaries: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-salaries-get.html */
export async function executeOracleFusionHcmGetSalary(
  input: OracleFusionHcmGetSalaryBody,
  signal?: AbortSignal
) {
  const path = `salaries/${input.salaryId}`
  const result = await readResource(input, path, SALARY_FIELDS, 'SalaryId', input.salaryId, projectSalary, signal)
  return { success: true as const, output: { salary: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-salarybasislov-get.html */
export async function executeOracleFusionHcmListSalaryBases(
  input: OracleFusionHcmListSalaryBasesBody,
  signal?: AbortSignal
) {
  const path = 'salaryBasisLov'
  const result = await list(input, path, SALARY_BASIS_FIELDS, projectSalaryBasis, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['SalaryBasisName'])
    if (query.q) clauses.push(`(${query.q})`)
    query.finder = finder('findByWord', { LegislativeDataGroupId: input.legislativeDataGroupId, EffectiveDate: input.effectiveDate })
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { salaryBases: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-graderates-graderatesuniqid-child-ratevalues-get.html */
export async function executeOracleFusionHcmListGradeRateValues(
  input: OracleFusionHcmListGradeRateValuesBody,
  signal?: AbortSignal
) {
  const path = `${await resolveResourcePath(input, 'gradeRates', 'RateId', input.gradeRateId, signal)}/child/rateValues`
  const result = await list(input, path, GRADE_RATE_VALUE_FIELDS, projectGradeRateValue, (query) => {
    const clauses: string[] = []
    addEffectiveDate(query, input.effectiveDate)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { gradeRateValues: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-goalplans-get.html */
export async function executeOracleFusionHcmListGoalPlans(
  input: OracleFusionHcmListGoalPlansBody,
  signal?: AbortSignal
) {
  const path = 'goalPlans'
  const result = await list(input, path, GOAL_PLAN_FIELDS, projectGoalPlan, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['GoalPlanName'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.reviewPeriodId) clauses.push(`ReviewPeriodId=${input.reviewPeriodId}`)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { goalPlans: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-goalplans-get.html */
export async function executeOracleFusionHcmGetGoalPlan(
  input: OracleFusionHcmGetGoalPlanBody,
  signal?: AbortSignal
) {
  const path = `goalPlans/${input.goalPlanId}`
  const result = await readResource(input, path, GOAL_PLAN_FIELDS, 'GoalPlanId', input.goalPlanId, projectGoalPlan, signal)
  return { success: true as const, output: { goalPlan: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performancegoals-get.html */
export async function executeOracleFusionHcmListPerformanceGoals(
  input: OracleFusionHcmListPerformanceGoalsBody,
  signal?: AbortSignal
) {
  const path = 'performanceGoals'
  const result = await list(input, path, PERFORMANCE_GOAL_FIELDS, projectPerformanceGoal, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['GoalName'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.personId) clauses.push(`PersonId=${input.personId}`)
    if (input.reviewPeriodId) clauses.push(`ReviewPeriodId=${input.reviewPeriodId}`)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { performanceGoals: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performancegoals-get.html */
export async function executeOracleFusionHcmGetPerformanceGoal(
  input: OracleFusionHcmGetPerformanceGoalBody,
  signal?: AbortSignal
) {
  const path = await resolveResourcePath(input, 'performanceGoals', 'GoalId', input.goalId, signal)
  const result = await readResource(input, path, PERFORMANCE_GOAL_FIELDS, 'GoalId', input.goalId, projectPerformanceGoal, signal)
  return { success: true as const, output: { performanceGoal: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-searchdevgoals-get.html */
export async function executeOracleFusionHcmListDevelopmentGoals(
  input: OracleFusionHcmListDevelopmentGoalsBody,
  signal?: AbortSignal
) {
  const path = 'searchDevGoals'
  const result = await list(input, path, DEVELOPMENT_GOAL_FIELDS, projectDevelopmentGoal, (query) => {
    const clauses: string[] = []
    query.finder = finder('findByPersonId', { PersonId: input.personId })
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { developmentGoals: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-searchdevgoals-get.html */
export async function executeOracleFusionHcmGetDevelopmentGoal(
  input: OracleFusionHcmGetDevelopmentGoalBody,
  signal?: AbortSignal
) {
  const path = `searchDevGoals/${input.goalId}`
  const result = await readResource(input, path, DEVELOPMENT_GOAL_FIELDS, 'GoalId', input.goalId, projectDevelopmentGoal, signal)
  return { success: true as const, output: { developmentGoal: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performanceevaluations-get.html */
export async function executeOracleFusionHcmListPerformanceDocuments(
  input: OracleFusionHcmListPerformanceDocumentsBody,
  signal?: AbortSignal
) {
  const path = 'performanceEvaluations'
  const result = await list(input, path, PERFORMANCE_DOCUMENT_FIELDS, projectPerformanceDocument, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['PerformanceDocumentName'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.personId) clauses.push(`PersonId=${input.personId}`)
    if (input.reviewPeriodId) clauses.push(`ReviewPeriodId=${input.reviewPeriodId}`)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { performanceDocuments: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performanceevaluations-get.html */
export async function executeOracleFusionHcmGetPerformanceDocument(
  input: OracleFusionHcmGetPerformanceDocumentBody,
  signal?: AbortSignal
) {
  const path = await performanceDocumentPath(input, signal)
  const result = await readResource(input, path, PERFORMANCE_DOCUMENT_FIELDS, 'EvaluationId', input.evaluationId, projectPerformanceDocument, signal)
  return { success: true as const, output: { performanceDocument: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performanceevaluations-performanceevaluationsuniqid-child-roles-get.html */
export async function executeOracleFusionHcmListPerformanceDocumentRoles(
  input: OracleFusionHcmListPerformanceDocumentRolesBody,
  signal?: AbortSignal
) {
  const path = `${await performanceDocumentPath(input, signal)}/child/Roles`
  const result = await list(input, path, PERFORMANCE_DOCUMENT_ROLE_FIELDS, projectPerformanceDocumentRole, undefined,
  signal)
  return { success: true as const, output: { performanceDocumentRoles: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performanceevaluations-performanceevaluationsuniqid-child-roles-evalroleid-child-participants-get.html */
export async function executeOracleFusionHcmListPerformanceDocumentParticipants(
  input: OracleFusionHcmListPerformanceDocumentParticipantsBody,
  signal?: AbortSignal
) {
  const path = `${await performanceDocumentPath(input, signal)}/child/Roles/${input.evalRoleId}/child/Participants`
  const result = await list(input, path, PERFORMANCE_DOCUMENT_PARTICIPANT_FIELDS, projectPerformanceDocumentParticipant, undefined,
  signal)
  return { success: true as const, output: { performanceDocumentParticipants: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-performanceevaluations-performanceevaluationsuniqid-child-roles-evalroleid-child-participants-evalparticipantid-child-tasks-get.html */
export async function executeOracleFusionHcmListPerformanceDocumentTasks(
  input: OracleFusionHcmListPerformanceDocumentTasksBody,
  signal?: AbortSignal
) {
  const path = `${await performanceDocumentPath(input, signal)}/child/Roles/${input.evalRoleId}/child/Participants/${input.evalParticipantId}/child/Tasks`
  const result = await list(input, path, PERFORMANCE_DOCUMENT_TASK_FIELDS, projectPerformanceDocumentTask, undefined,
  signal)
  return { success: true as const, output: { performanceDocumentTasks: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-talentpersonprofiles-get.html */
export async function executeOracleFusionHcmListTalentProfiles(
  input: OracleFusionHcmListTalentProfilesBody,
  signal?: AbortSignal
) {
  const path = 'talentPersonProfiles'
  const result = await list(input, path, TALENT_PROFILE_FIELDS, projectTalentProfile, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['DisplayName','ProfileCode'])
    if (query.q) clauses.push(`(${query.q})`)
    if (input.personId) clauses.push(`PersonId=${input.personId}`)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { talentProfiles: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-talentpersonprofiles-get.html */
export async function executeOracleFusionHcmGetTalentProfile(
  input: OracleFusionHcmGetTalentProfileBody,
  signal?: AbortSignal
) {
  const path = await talentProfilePath(input, signal)
  const result = await readResource(input, path, TALENT_PROFILE_FIELDS, 'ProfileId', input.profileId, projectTalentProfile, signal)
  return { success: true as const, output: { talentProfile: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-talentpersonprofiles-talentpersonprofilesuniqid-child-skillsections-get.html */
export async function executeOracleFusionHcmListTalentProfileSections(
  input: OracleFusionHcmListTalentProfileSectionsBody,
  signal?: AbortSignal
) {
  const path = `${await talentProfilePath(input, signal)}/child/${input.sectionKind === 'skill' ? 'skillSections' : 'certificationSections'}`
  const result = await list(input, path, TALENT_PROFILE_SECTION_FIELDS, projectTalentProfileSection, undefined,
  signal)
  return { success: true as const, output: { talentProfileSections: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-talentpersonprofiles-talentpersonprofilesuniqid-child-skillsections-profilesectionid1-child-skillitems-get.html */
export async function executeOracleFusionHcmListTalentProfileSkills(
  input: OracleFusionHcmListTalentProfileSkillsBody,
  signal?: AbortSignal
) {
  const path = `${await talentProfilePath(input, signal)}/child/skillSections/${input.profileSectionId}/child/skillItems`
  const result = await list(input, path, TALENT_PROFILE_SKILL_FIELDS, projectTalentProfileSkill, undefined,
  signal)
  return { success: true as const, output: { talentProfileSkills: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-talentpersonprofiles-talentpersonprofilesuniqid-child-certificationsections-profilesectionid-child-certificationitems-get.html */
export async function executeOracleFusionHcmListTalentProfileCertifications(
  input: OracleFusionHcmListTalentProfileCertificationsBody,
  signal?: AbortSignal
) {
  const path = `${await talentProfilePath(input, signal)}/child/certificationSections/${input.profileSectionId}/child/certificationItems`
  const result = await list(input, path, TALENT_PROFILE_CERTIFICATION_FIELDS, projectTalentProfileCertification, undefined,
  signal)
  return { success: true as const, output: { talentProfileCertifications: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecords-get.html */
export async function executeOracleFusionHcmListTimeRecords(
  input: OracleFusionHcmListTimeRecordsBody,
  signal?: AbortSignal
) {
  const path = 'timeRecords'
  const result = await list(input, path, TIME_RECORD_FIELDS, projectTimeRecord, (query) => {
    const clauses: string[] = []
    query.finder = finder('filterByPerNumTimeGrp', { personNumber: input.personNumber, startTime: input.startTime, stopTime: input.stopTime, groupType: 'TimeCardEntry' })
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { timeRecords: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecords-get.html */
export async function executeOracleFusionHcmGetTimeRecord(
  input: OracleFusionHcmGetTimeRecordBody,
  signal?: AbortSignal
) {
  const path = `timeRecords/${input.timeRecordId}`
  const result = await readResource(input, path, TIME_RECORD_FIELDS, 'timeRecordId', input.timeRecordId, projectTimeRecord, signal)
  return { success: true as const, output: { timeRecord: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecordgroups-get.html */
export async function executeOracleFusionHcmListTimeCards(
  input: OracleFusionHcmListTimeCardsBody,
  signal?: AbortSignal
) {
  const path = 'timeRecordGroups'
  const result = await list(input, path, TIME_CARD_FIELDS, projectTimeCard, (query) => {
    const clauses: string[] = []
    query.finder = finder('filterByPerNumTimeGrp', { personNumber: input.personNumber, startTime: input.startTime, stopTime: input.stopTime, groupType: 'ProcessedTimecard' })
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { timeCards: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecordgroups-get.html */
export async function executeOracleFusionHcmGetTimeCard(
  input: OracleFusionHcmGetTimeCardBody,
  signal?: AbortSignal
) {
  const path = `timeRecordGroups/${input.timeRecordGroupId}`
  const result = await readResource(input, path, TIME_CARD_FIELDS, 'timeRecordGroupId', input.timeRecordGroupId, projectTimeCard, signal)
  return { success: true as const, output: { timeCard: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timeattributes-get.html */
export async function executeOracleFusionHcmListTimeAttributes(
  input: OracleFusionHcmListTimeAttributesBody,
  signal?: AbortSignal
) {
  const path = 'timeAttributes'
  const result = await list(input, path, TIME_ATTRIBUTE_FIELDS, projectTimeAttribute, (query) => {
    const clauses: string[] = []
    addSearch(query, input.search, ['attributeName','displayName'])
    if (query.q) clauses.push(`(${query.q})`)
    query.finder = 'filterByAttrContext;contextCode=ORA_HWM_TIME_RECORDS_REST'
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { timeAttributes: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timeattributes-timeattributesuniqid-child-datasourceusages-get.html */
export async function executeOracleFusionHcmListTimeAttributeDataSources(
  input: OracleFusionHcmListTimeAttributeDataSourcesBody,
  signal?: AbortSignal
) {
  const path = `${await timeAttributePath(input, signal)}/child/dataSourceUsages`
  const result = await list(input, path, TIME_ATTRIBUTE_DATA_SOURCE_FIELDS, projectTimeAttributeDataSource, undefined,
  signal)
  return { success: true as const, output: { timeAttributeDataSources: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timeattributes-timeattributesuniqid-child-datasourceusages-datasourceusageid-child-datasourcecriteriabinds-get.html */
export async function executeOracleFusionHcmListTimeAttributeCriteriaBinds(
  input: OracleFusionHcmListTimeAttributeCriteriaBindsBody,
  signal?: AbortSignal
) {
  const path = `${await timeAttributePath(input, signal)}/child/dataSourceUsages/${input.dataSourceUsageId}/child/dataSourceCriteriaBinds`
  const result = await list(input, path, TIME_ATTRIBUTE_CRITERIA_BIND_FIELDS, projectTimeAttributeCriteriaBind, undefined,
  signal)
  return { success: true as const, output: { timeAttributeCriteriaBinds: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timeattributevalues-get.html */
export async function executeOracleFusionHcmListTimeAttributeValues(
  input: OracleFusionHcmListTimeAttributeValuesBody,
  signal?: AbortSignal
) {
  const path = 'timeAttributeValues'
  const result = await list(input, path, TIME_ATTRIBUTE_VALUE_FIELDS, projectTimeAttributeValue, (query) => {
    const clauses: string[] = []
    const variables: Record<string, string> = { dataSourceUsageId: input.dataSourceUsageId, timeAttributeUsageId: input.timeAttributeUsageId }
          for (const [index, binding] of (input.bindings ?? []).entries()) {
            variables[`bindVarName${index + 1}`] = binding.name
            variables[`bindVarValue${index + 1}`] = binding.value
          }
          query.finder = finder('filterByDataSourceUsage', variables)
    if (clauses.length > 0) query.q = clauses.join(' AND ')
  },
  signal)
  return { success: true as const, output: { timeAttributeValues: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecordeventrequests-get.html */
export async function executeOracleFusionHcmGetTimeRecordRequest(
  input: OracleFusionHcmGetTimeRecordRequestBody,
  signal?: AbortSignal
) {
  const path = `timeRecordEventRequests/${input.timeRecordEventRequestId}`
  const result = await readResource(input, path, TIME_RECORD_REQUEST_FIELDS, 'timeRecordEventRequestId', input.timeRecordEventRequestId, projectTimeRecordRequest, signal)
  return { success: true as const, output: { timeRecordRequest: result } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecordeventrequests-timerecordeventrequestid-child-timerecordevent-get.html */
export async function executeOracleFusionHcmListTimeRecordRequestEvents(
  input: OracleFusionHcmListTimeRecordRequestEventsBody,
  signal?: AbortSignal
) {
  const path = `timeRecordEventRequests/${input.timeRecordEventRequestId}/child/timeRecordEvent`
  const result = await list(input, path, TIME_RECORD_REQUEST_EVENT_FIELDS, projectTimeRecordRequestEvent, undefined,
  signal)
  return { success: true as const, output: { timeRecordRequestEvents: result.items, ...withoutItems(result) } }
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/human-resources/farws/op-timerecordeventrequests-timerecordeventrequestid-child-timerecordevent-timerecordeventid-child-timerecordeventmessage-get.html */
export async function executeOracleFusionHcmListTimeRecordEventMessages(
  input: OracleFusionHcmListTimeRecordEventMessagesBody,
  signal?: AbortSignal
) {
  const path = `timeRecordEventRequests/${input.timeRecordEventRequestId}/child/timeRecordEvent/${input.timeRecordEventId}/child/timeRecordEventMessage`
  const result = await list(input, path, TIME_RECORD_EVENT_MESSAGE_FIELDS, projectTimeRecordEventMessage, undefined,
  signal)
  return { success: true as const, output: { timeRecordEventMessages: result.items, ...withoutItems(result) } }
}

export async function executeOracleFusionHcmListSalaryComponents(
  input: OracleFusionHcmListSalaryComponentsBody,
  signal?: AbortSignal
) {
  if (input.componentKind === 'simple') {
    const result = await list(input, `salaries/${input.salaryId}/child/salarySimpleComponents`, SIMPLE_SALARY_COMPONENT_FIELDS, projectSimpleSalaryComponent, undefined, signal)
    return { success: true as const, output: { componentKind: input.componentKind, standardComponents: [], simpleComponents: result.items, rateComponents: [], ...withoutItems(result) } }
  }
  if (input.componentKind === 'rate') {
    const result = await list(input, `salaries/${input.salaryId}/child/salaryPayRateComponents`, RATE_SALARY_COMPONENT_FIELDS, projectRateSalaryComponent, undefined, signal)
    return { success: true as const, output: { componentKind: input.componentKind, standardComponents: [], simpleComponents: [], rateComponents: result.items, ...withoutItems(result) } }
  }
  const result = await list(input, `salaries/${input.salaryId}/child/salaryComponents`, STANDARD_SALARY_COMPONENT_FIELDS, projectStandardSalaryComponent, undefined, signal)
  return { success: true as const, output: { componentKind: input.componentKind, standardComponents: result.items, simpleComponents: [], rateComponents: [], ...withoutItems(result) } }
}

export async function executeOracleFusionHcmCreateAssignedPayroll(input: OracleFusionHcmCreateAssignedPayrollBody, signal?: AbortSignal) {
  const parent = await payrollAssignmentPath({ ...input, effectiveDate: input.effectiveStartDate }, signal)
  const assignedPayroll = await writeResource(input, `${parent}/child/assignedPayrolls`, 'POST', {
    PayrollId: oracleFusionExactInteger(input.payrollId),
    EffectiveStartDate: input.effectiveStartDate,
    EffectiveEndDate: input.effectiveEndDate,
    StartDate: input.startDate,
    EndDate: input.endDate,
    Lsed: input.lsed,
    OverridingPeriodId: input.overridingPeriodId ? oracleFusionExactInteger(input.overridingPeriodId) : undefined,
    TimeCardRequired: input.timeCardRequired,
  }, projectAssignedPayroll, signal)
  return { success: true as const, output: { assignedPayroll } }
}

export async function executeOracleFusionHcmUpdateAssignedPayroll(input: OracleFusionHcmUpdateAssignedPayrollBody, signal?: AbortSignal) {
  const path = await assignedPayrollPath(input, signal)
  const assignedPayroll = await writeResource(input, path, 'PATCH', {
    EffectiveEndDate: input.effectiveEndDate,
    Lsed: input.lsed,
    OverridingPeriodId: input.overridingPeriodId ? oracleFusionExactInteger(input.overridingPeriodId) : undefined,
    TimeCardRequired: input.timeCardRequired,
  }, projectAssignedPayroll, signal, `RangeMode=${input.rangeMode};RangeStartDate=${input.effectiveDate}`)
  return { success: true as const, output: { assignedPayroll } }
}

/** Nested input values are typed individually; Oracle establishes their generated parent identifiers. */
export async function executeOracleFusionHcmCreateElementEntry(input: OracleFusionHcmCreateElementEntryBody, signal?: AbortSignal) {
  const elementEntry = await writeResource(input, 'elementEntries', 'POST', {
    PersonId: oracleFusionExactInteger(input.personId),
    AssignmentId: input.assignmentId ? oracleFusionExactInteger(input.assignmentId) : undefined,
    ElementTypeId: oracleFusionExactInteger(input.elementTypeId),
    ElementName: input.elementName,
    CreatorType: input.creatorType,
    EntryType: input.entryType,
    EffectiveStartDate: input.effectiveStartDate,
    EffectiveEndDate: input.effectiveEndDate,
    elementEntryValues: input.entryValues.map((entry) => ({
      InputValueId: oracleFusionExactInteger(entry.inputValueId),
      ScreenEntryValue: entry.screenEntryValue,
    })),
  }, projectElementEntry, signal)
  return { success: true as const, output: { elementEntry } }
}

export async function executeOracleFusionHcmUpdateElementEntryValue(input: OracleFusionHcmUpdateElementEntryValueBody, signal?: AbortSignal) {
  const parent = await elementEntryPath(input, signal)
  const path = await resolveResourcePath(input, `${parent}/child/elementEntryValues`, 'ElementEntryValueId', input.elementEntryValueId, signal)
  const elementEntryValue = await writeResource(input, path, 'PATCH', {
    ScreenEntryValue: input.screenEntryValue,
  }, projectElementEntryValue, signal, `RangeMode=${input.rangeMode};RangeStartDate=${input.effectiveDate}`)
  return { success: true as const, output: { elementEntryValue } }
}

async function requireUserEnteredSalaryBasis(input: Credentials, salaryBasisId: string, effectiveDate: string, signal?: AbortSignal): Promise<void> {
  const result = await list({ ...input, limit: 2 }, 'salaryBasisLov', SALARY_BASIS_FIELDS, projectSalaryBasis, (query) => {
    query.finder = finder('findBySalaryBasisId', { SalaryBasisId: salaryBasisId, EffectiveDate: effectiveDate })
  }, signal)
  if (result.items.length !== 1 || result.hasMore || result.items[0].salaryBasisId !== salaryBasisId) {
    throw new OracleFusionProviderError('Oracle Fusion HCM salary basis could not be uniquely resolved', 422)
  }
  if (result.items[0].salaryBasisType !== 'U') {
    throw new OracleFusionProviderError('Oracle Fusion HCM salary writes require a user-entered salary basis', 422)
  }
}

export async function executeOracleFusionHcmCreateSalary(input: OracleFusionHcmCreateSalaryBody, signal?: AbortSignal) {
  await requireUserEnteredSalaryBasis(input, input.salaryBasisId, input.dateFrom, signal)
  const salary = await writeResource(input, 'salaries', 'POST', {
    AssignmentId: oracleFusionExactInteger(input.assignmentId),
    SalaryBasisId: oracleFusionExactInteger(input.salaryBasisId),
    SalaryAmount: input.salaryAmount,
    DateFrom: input.dateFrom,
    DateTo: input.dateTo,
    MultipleComponents: 'N',
  }, projectSalary, signal)
  return { success: true as const, output: { salary } }
}

export async function executeOracleFusionHcmCorrectSalary(input: OracleFusionHcmCorrectSalaryBody, signal?: AbortSignal) {
  const current = await executeOracleFusionHcmGetSalary(input, signal)
  const { salaryBasisId, dateFrom } = current.output.salary
  if (!salaryBasisId || !dateFrom) {
    throw new OracleFusionProviderError('Oracle Fusion HCM salary is missing basis or effective-date information', 502)
  }
  await requireUserEnteredSalaryBasis(input, salaryBasisId, dateFrom, signal)
  const salary = await writeResource(input, `salaries/${input.salaryId}`, 'PATCH', {
    SalaryAmount: input.salaryAmount,
  }, projectSalary, signal)
  return { success: true as const, output: { salary } }
}

/** POST intake only; the separate event/message tools expose subsequent processing results. */
async function submitTimeEntry(
  input: OracleFusionHcmCreateTimeEntryBody | OracleFusionHcmUpdateTimeEntryBody | OracleFusionHcmDeleteTimeEntryBody,
  operationType: 'ADD' | 'UPDATE' | 'DELETE',
  signal?: AbortSignal
) {
  const attributes = operationType !== 'DELETE' && 'timeAttributes' in input ? [...(input.timeAttributes ?? [])] : []
  if (operationType !== 'DELETE' && 'payrollTimeType' in input && input.payrollTimeType) {
    attributes.push({ attributeName: 'PayrollTimeType', attributeValue: input.payrollTimeType })
  }
  const timeRecordRequest = await writeResource(input, 'timeRecordEventRequests', 'POST', {
    processInline: 'N',
    processMode: input.processMode,
    timeRecordEvent: [filterUndefined({
      operationType,
      reporterIdType: 'PERSON',
      reporterId: input.personNumber,
      assignmentNumber: input.assignmentNumber,
      changeReason: input.changeReason,
      timeRecordId: operationType !== 'ADD' && 'timeRecordId' in input ? oracleFusionExactInteger(input.timeRecordId) : undefined,
      timeRecordVersion: operationType !== 'ADD' && 'timeRecordVersion' in input ? input.timeRecordVersion : undefined,
      startTime: operationType !== 'DELETE' && 'startTime' in input ? input.startTime : undefined,
      stopTime: operationType !== 'DELETE' && 'stopTime' in input ? input.stopTime : undefined,
      measure: operationType !== 'DELETE' && 'measure' in input ? input.measure : undefined,
      referenceDate: operationType !== 'DELETE' && 'referenceDate' in input ? input.referenceDate : undefined,
      timeRecordEventAttribute: attributes.length ? attributes : undefined,
    })],
  }, projectTimeRecordRequest, signal)
  return { success: true as const, output: { timeRecordRequest } }
}

export async function executeOracleFusionHcmCreateTimeEntry(input: OracleFusionHcmCreateTimeEntryBody, signal?: AbortSignal) {
  return submitTimeEntry(input, 'ADD', signal)
}

export async function executeOracleFusionHcmUpdateTimeEntry(input: OracleFusionHcmUpdateTimeEntryBody, signal?: AbortSignal) {
  return submitTimeEntry(input, 'UPDATE', signal)
}

export async function executeOracleFusionHcmDeleteTimeEntry(input: OracleFusionHcmDeleteTimeEntryBody, signal?: AbortSignal) {
  return submitTimeEntry(input, 'DELETE', signal)
}
