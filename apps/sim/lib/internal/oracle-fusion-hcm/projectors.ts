import { isRecordLike } from '@sim/utils/object'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import type {
  OracleFusionHcmAbsence,
  OracleFusionHcmAbsenceType,
  OracleFusionHcmAssignment,
  OracleFusionHcmBusinessUnit,
  OracleFusionHcmDepartment,
  OracleFusionHcmDirectReport,
  OracleFusionHcmGrade,
  OracleFusionHcmJob,
  OracleFusionHcmJobFamily,
  OracleFusionHcmLegalEmployer,
  OracleFusionHcmLocation,
  OracleFusionHcmManager,
  OracleFusionHcmPersonType,
  OracleFusionHcmPosition,
  OracleFusionHcmWorker,
} from '@/lib/internal/oracle-fusion-hcm/schema'

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue {
  if (!isRecordLike(value)) {
    throw new OracleFusionProviderError(
      'Oracle Fusion HCM returned an unexpected resource shape',
      502
    )
  }
  return value
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function idValue(value: unknown, name: string, required = false): string | null {
  const id = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (id !== undefined) return id
  if (required) {
    throw new OracleFusionProviderError(`Oracle Fusion HCM response is missing ${name}`, 502)
  }
  return null
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.toUpperCase() === 'Y' || value.toLowerCase() === 'true') return true
    if (value.toUpperCase() === 'N' || value.toLowerCase() === 'false') return false
  }
  return null
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function projectWorker(value: unknown): OracleFusionHcmWorker {
  const item = record(value)
  return {
    personId: idValue(item.PersonId, 'PersonId', true)!,
    personNumber: stringValue(item.PersonNumber),
    displayName: stringValue(item.DisplayName),
    fullName: stringValue(item.FullName),
    firstName: stringValue(item.FirstName),
    lastName: stringValue(item.LastName),
    knownAs: stringValue(item.KnownAs),
    workEmail: stringValue(item.WorkEmail),
    username: stringValue(item.Username),
  }
}

export function projectAssignment(value: unknown): OracleFusionHcmAssignment {
  const item = record(value)
  return {
    assignmentId: idValue(item.AssignmentId, 'AssignmentId', true)!,
    assignmentNumber: stringValue(item.AssignmentNumber),
    assignmentName: stringValue(item.AssignmentName),
    startDate: stringValue(item.StartDate),
    primaryFlag: booleanValue(item.PrimaryFlag),
    primaryAssignmentFlag: booleanValue(item.PrimaryAssignmentFlag),
    workerType: stringValue(item.WorkerType),
    workerNumber: stringValue(item.WorkerNumber),
    fullPartTime: stringValue(item.FullPartTime),
    legalEmployerName: stringValue(item.LegalEmployerName),
    businessUnitName: stringValue(item.BusinessUnitName),
    departmentName: stringValue(item.DepartmentName),
    jobCode: stringValue(item.JobCode),
    jobName: stringValue(item.JobName),
    positionCode: stringValue(item.PositionCode),
    positionName: stringValue(item.PositionName),
    locationCode: stringValue(item.LocationCode),
    locationName: stringValue(item.LocationName),
    managerName: stringValue(item.ManagerName),
  }
}

export function projectManager(value: unknown): OracleFusionHcmManager {
  const item = record(value)
  return {
    assignmentSupervisorId: idValue(item.AssignmentSupervisorId, 'AssignmentSupervisorId', true)!,
    managerAssignmentId: idValue(item.ManagerAssignmentId, 'ManagerAssignmentId'),
    managerAssignmentNumber: stringValue(item.ManagerAssignmentNumber),
    managerAssignmentName: stringValue(item.ManagerAssignmentName),
    managerPersonId: idValue(item.ManagerPersonId, 'ManagerPersonId'),
    managerPersonNumber: stringValue(item.ManagerPersonNumber),
    displayName: stringValue(item.DisplayName),
    firstName: stringValue(item.FirstName),
    knownAs: stringValue(item.KnownAs),
    lastName: stringValue(item.LastName),
    managerType: stringValue(item.ManagerType),
    managerTypeMeaning: stringValue(item.ManagerTypeMeaning),
    jobCode: stringValue(item.JobCode),
    jobName: stringValue(item.JobName),
    positionCode: stringValue(item.PositionCode),
    positionName: stringValue(item.PositionName),
    workEmail: stringValue(item.WorkEmail),
  }
}

export function projectDirectReport(value: unknown): OracleFusionHcmDirectReport {
  const item = record(value)
  return {
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    assignmentName: stringValue(item.AssignmentName),
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    displayName: stringValue(item.DisplayName),
    firstName: stringValue(item.FirstName),
    knownAs: stringValue(item.KnownAs),
    lastName: stringValue(item.LastName),
    relationshipType: stringValue(item.RelationshipType),
    relationshipTypeMeaning: stringValue(item.RelationshipTypeMeaning),
    workerType: stringValue(item.WorkerType),
    directReportsCount: numberValue(item.DirectReportsCount),
    allReportsCount: numberValue(item.AllReportsCount),
  }
}

export function projectAbsence(value: unknown): OracleFusionHcmAbsence {
  const item = record(value)
  return {
    absenceId: idValue(item.personAbsenceEntryId, 'personAbsenceEntryId', true)!,
    personId: idValue(item.personId, 'personId'),
    personNumber: stringValue(item.personNumber),
    absenceTypeId: idValue(item.absenceTypeId, 'absenceTypeId'),
    absenceType: stringValue(item.absenceType),
    absenceStatusCode: stringValue(item.absenceStatusCd),
    displayStatus: stringValue(item.absenceDispStatus),
    displayStatusMeaning: stringValue(item.absenceDispStatusMeaning),
    approvalStatusCode: stringValue(item.approvalStatusCd),
    assignmentId: idValue(item.assignmentId, 'assignmentId'),
    assignmentName: stringValue(item.assignmentName),
    assignmentNumber: stringValue(item.assignmentNumber),
    startDate: stringValue(item.startDate),
    startTime: stringValue(item.startTime),
    endDate: stringValue(item.endDate),
    endTime: stringValue(item.endTime),
    duration: numberValue(item.duration),
    formattedDuration: stringValue(item.formattedDuration),
    unitOfMeasure: stringValue(item.unitOfMeasure),
    unitOfMeasureMeaning: stringValue(item.unitOfMeasureMeaning),
    openEndedFlag: booleanValue(item.openEndedFlag),
    singleDayFlag: booleanValue(item.singleDayFlag),
    employer: stringValue(item.employer),
    lastUpdateDate: stringValue(item.lastUpdateDate),
  }
}

export function projectAbsenceType(value: unknown): OracleFusionHcmAbsenceType {
  const item = record(value)
  return {
    absenceTypeId: idValue(item.AbsenceTypeId, 'AbsenceTypeId', true)!,
    name: stringValue(item.AbsenceTypeName),
    nameWithEmployer: stringValue(item.AbsTypeWithEmployerName),
    description: stringValue(item.Description),
    employerId: idValue(item.EmployerId, 'EmployerId'),
    employerName: stringValue(item.EmployerName),
    durationCalculationBasis: stringValue(item.DurationCalculationBasis),
    durationUomCode: stringValue(item.DurationUOMCode),
    durationUomMeaning: stringValue(item.DurationUOMCodeMeaning),
    displaySequence: numberValue(item.DisplaySequence),
  }
}

export function projectJob(value: unknown): OracleFusionHcmJob {
  const item = record(value)
  return {
    jobId: idValue(item.JobId, 'JobId', true)!,
    jobCode: stringValue(item.JobCode),
    name: stringValue(item.Name),
    activeStatus: stringValue(item.ActiveStatus),
    jobFamilyId: idValue(item.JobFamilyId, 'JobFamilyId'),
    jobFunctionCode: stringValue(item.JobFunctionCode),
    managerLevel: stringValue(item.ManagerLevel),
    regularTemporary: stringValue(item.RegularTemporary),
    fullPartTime: stringValue(item.FullPartTime),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lastUpdateDate: stringValue(item.LastUpdateDate),
  }
}

export function projectJobFamily(value: unknown): OracleFusionHcmJobFamily {
  const item = record(value)
  return {
    jobFamilyId: idValue(item.JobFamilyId, 'JobFamilyId', true)!,
    jobFamilyCode: stringValue(item.JobFamilyCode),
    name: stringValue(item.JobFamilyName),
    activeStatus: stringValue(item.ActiveStatus),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lastUpdateDate: stringValue(item.LastUpdateDate),
  }
}

export function projectDepartment(value: unknown): OracleFusionHcmDepartment {
  const item = record(value)
  return {
    organizationId: idValue(item.OrganizationId, 'OrganizationId', true)!,
    organizationCode: stringValue(item.OrganizationCode),
    name: stringValue(item.Name),
    classificationCode: stringValue(item.ClassificationCode),
    status: stringValue(item.Status),
    locationId: idValue(item.LocationId, 'LocationId'),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lastUpdateDate: stringValue(item.LastUpdateDate),
  }
}

export function projectLocation(value: unknown): OracleFusionHcmLocation {
  const item = record(value)
  return {
    locationId: idValue(item.LocationId, 'LocationId', true)!,
    locationCode: stringValue(item.LocationCode),
    name: stringValue(item.LocationName),
    description: stringValue(item.Description),
    activeStatus: stringValue(item.ActiveStatus),
    country: stringValue(item.Country),
    townOrCity: stringValue(item.TownOrCity),
    region1: stringValue(item.Region1),
    region2: stringValue(item.Region2),
    region3: stringValue(item.Region3),
    postalCode: stringValue(item.PostalCode),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lastUpdateDate: stringValue(item.LastUpdateDate),
  }
}

export function projectPosition(value: unknown): OracleFusionHcmPosition {
  const item = record(value)
  return {
    positionId: idValue(item.PositionId, 'PositionId', true)!,
    positionCode: stringValue(item.PositionCode),
    name: stringValue(item.Name),
    activeStatus: stringValue(item.ActiveStatus),
    positionType: stringValue(item.PositionType),
    jobId: idValue(item.JobId, 'JobId'),
    departmentId: idValue(item.DepartmentId, 'DepartmentId'),
    locationId: idValue(item.LocationId, 'LocationId'),
    businessUnitId: idValue(item.BusinessUnitId, 'BusinessUnitId'),
    regularTemporary: stringValue(item.RegularTemporary),
    fullPartTime: stringValue(item.FullPartTime),
    hiringStatus: stringValue(item.HiringStatus),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lastUpdateDate: stringValue(item.LastUpdateDate),
  }
}

export function projectBusinessUnit(value: unknown): OracleFusionHcmBusinessUnit {
  const item = record(value)
  return {
    businessUnitId: idValue(item.BusinessUnitId, 'BusinessUnitId', true)!,
    name: stringValue(item.Name),
    status: stringValue(item.Status),
  }
}

export function projectLegalEmployer(value: unknown): OracleFusionHcmLegalEmployer {
  const item = record(value)
  return {
    organizationId: idValue(item.OrganizationId, 'OrganizationId', true)!,
    name: stringValue(item.Name),
    legislationCode: stringValue(item.LegislationCode),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
  }
}

export function projectGrade(value: unknown): OracleFusionHcmGrade {
  const item = record(value)
  return {
    gradeId: idValue(item.GradeId, 'GradeId', true)!,
    gradeCode: stringValue(item.GradeCode),
    name: stringValue(item.GradeName),
    activeStatus: stringValue(item.ActiveStatus),
    categoryCode: stringValue(item.CategoryCode),
    setId: idValue(item.SetId, 'SetId'),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lastUpdateDate: stringValue(item.LastUpdateDate),
  }
}

export function projectPersonType(value: unknown): OracleFusionHcmPersonType {
  const item = record(value)
  return {
    personTypeId: idValue(item.PersonTypeId, 'PersonTypeId', true)!,
    systemPersonType: stringValue(item.SystemPersonType),
    userPersonType: stringValue(item.UserPersonType),
    activeFlag: booleanValue(item.ActiveFlag),
    defaultFlag: booleanValue(item.DefaultFlag),
  }
}
