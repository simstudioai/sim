import {
  type OracleFusionResolvedCredential,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  type OracleFusionCollectionOptions,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import {
  projectAbsence,
  projectAbsenceType,
  projectAssignment,
  projectBusinessUnit,
  projectDepartment,
  projectDirectReport,
  projectGrade,
  projectJob,
  projectJobFamily,
  projectLegalEmployer,
  projectLocation,
  projectManager,
  projectPersonType,
  projectPosition,
  projectWorker,
} from '@/lib/internal/oracle-fusion-hcm/projectors'
import type {
  OracleFusionHcmGetAbsenceBody,
  OracleFusionHcmGetWorkerAssignmentBody,
  OracleFusionHcmGetWorkerBody,
  OracleFusionHcmListAbsencesBody,
  OracleFusionHcmListAbsenceTypesBody,
  OracleFusionHcmListBusinessUnitsBody,
  OracleFusionHcmListDepartmentsBody,
  OracleFusionHcmListGradesBody,
  OracleFusionHcmListJobFamiliesBody,
  OracleFusionHcmListJobsBody,
  OracleFusionHcmListLegalEmployersBody,
  OracleFusionHcmListLocationsBody,
  OracleFusionHcmListPersonTypesBody,
  OracleFusionHcmListPositionsBody,
  OracleFusionHcmListWorkerAssignmentsBody,
  OracleFusionHcmListWorkerDirectReportsBody,
  OracleFusionHcmListWorkerManagersBody,
  OracleFusionHcmListWorkersBody,
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
  signal?: AbortSignal
): Promise<unknown> {
  try {
    const result = await requestOracleFusionJson(
      credentials(input),
      { address: { family: 'hcm', relativePath: path }, query },
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
