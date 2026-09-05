import { isRecordLike } from '@sim/utils/object'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import type {
  OracleFusionHcmPayrollRelationship,
  OracleFusionHcmPayrollAssignment,
  OracleFusionHcmAssignedPayroll,
  OracleFusionHcmPayrollDefinition,
  OracleFusionHcmPayrollTimePeriod,
  OracleFusionHcmPayrollElementDefinition,
  OracleFusionHcmPayrollInputValue,
  OracleFusionHcmElementEntry,
  OracleFusionHcmElementEntryValue,
  OracleFusionHcmPersonProcessResult,
  OracleFusionHcmPayrollRunResult,
  OracleFusionHcmPayrollBalance,
  OracleFusionHcmSalary,
  OracleFusionHcmSalaryBasis,
  OracleFusionHcmStandardSalaryComponent,
  OracleFusionHcmSimpleSalaryComponent,
  OracleFusionHcmRateSalaryComponent,
  OracleFusionHcmGradeRateValue,
  OracleFusionHcmGoalPlan,
  OracleFusionHcmPerformanceGoal,
  OracleFusionHcmDevelopmentGoal,
  OracleFusionHcmPerformanceDocument,
  OracleFusionHcmPerformanceDocumentRole,
  OracleFusionHcmPerformanceDocumentParticipant,
  OracleFusionHcmPerformanceDocumentTask,
  OracleFusionHcmTalentProfile,
  OracleFusionHcmTalentProfileSection,
  OracleFusionHcmTalentProfileSkill,
  OracleFusionHcmTalentProfileCertification,
  OracleFusionHcmTimeRecord,
  OracleFusionHcmTimeCard,
  OracleFusionHcmTimeAttribute,
  OracleFusionHcmTimeAttributeDataSource,
  OracleFusionHcmTimeAttributeCriteriaBind,
  OracleFusionHcmTimeAttributeValue,
  OracleFusionHcmTimeRecordRequest,
  OracleFusionHcmTimeRecordRequestEvent,
  OracleFusionHcmTimeRecordEventMessage,
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

/** Projects the allowlisted payroll relationship fields; excludes unrelated secured children. */
export function projectPayrollRelationship(value: unknown): OracleFusionHcmPayrollRelationship {
  const item = record(value)
  return {
    payrollRelationshipId: idValue(item.PayrollRelationshipId, 'PayrollRelationshipId', true)!,
    payrollRelationshipNumber: stringValue(item.PayrollRelationshipNumber),
    personNumber: stringValue(item.PersonNumber),
    country: stringValue(item.Country),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    startDate: stringValue(item.StartDate),
    endDate: stringValue(item.EndDate),
    overridingPeriodId: idValue(item.OverridingPeriodId, 'OverridingPeriodId'),
  }
}

/** Projects the allowlisted payroll assignment fields; excludes unrelated secured children. */
export function projectPayrollAssignment(value: unknown): OracleFusionHcmPayrollAssignment {
  const item = record(value)
  return {
    payrollAssignmentId: idValue(item.RelationshipGroupId, 'RelationshipGroupId', true)!,
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    overridingPeriodId: idValue(item.OverridingPeriodId, 'OverridingPeriodId'),
    timeCardRequired: stringValue(item.TimeCardRequired),
  }
}

/** Projects the allowlisted assigned payroll fields; excludes unrelated secured children. */
export function projectAssignedPayroll(value: unknown): OracleFusionHcmAssignedPayroll {
  const item = record(value)
  return {
    assignedPayrollId: idValue(item.AssignedPayrollId, 'AssignedPayrollId', true)!,
    payrollId: idValue(item.PayrollId, 'PayrollId'),
    payrollName: stringValue(item.PayrollName),
    startDate: stringValue(item.StartDate),
    endDate: stringValue(item.EndDate),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    lsed: stringValue(item.Lsed),
    overridingPeriodId: idValue(item.OverridingPeriodId, 'OverridingPeriodId'),
    timeCardRequired: stringValue(item.TimeCardRequired),
  }
}

/** Projects the allowlisted payroll definition fields; excludes unrelated secured children. */
export function projectPayrollDefinition(value: unknown): OracleFusionHcmPayrollDefinition {
  const item = record(value)
  return {
    payrollId: idValue(item.PayrollId, 'PayrollId', true)!,
    payrollName: stringValue(item.PayrollName),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
    legislativeDataGroupName: stringValue(item.LegislativeDataGroupName),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    periodType: stringValue(item.PeriodType),
    consolidationSetId: idValue(item.ConsolidationSetId, 'ConsolidationSetId'),
    consolidationSetName: stringValue(item.ConsolidationSetName),
    reportingName: stringValue(item.ReportingName),
  }
}

/** Projects the allowlisted payroll time period fields; excludes unrelated secured children. */
export function projectPayrollTimePeriod(value: unknown): OracleFusionHcmPayrollTimePeriod {
  const item = record(value)
  return {
    timePeriodId: idValue(item.TimePeriodId, 'TimePeriodId'),
    payrollId: idValue(item.PayrollId, 'PayrollId'),
    payrollName: stringValue(item.PayrollName),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
    periodName: stringValue(item.PeriodName),
    periodNumber: numberValue(item.PeriodNumber),
    periodType: stringValue(item.PeriodType),
    periodCategory: stringValue(item.PeriodCategory),
    startDate: stringValue(item.StartDate),
    endDate: stringValue(item.EndDate),
    regularEarnDate: stringValue(item.RegularEarnDate),
    regularProcessDate: stringValue(item.RegularProcessDate),
    defaultPaydate: stringValue(item.DefaultPaydate),
    payslipViewDate: stringValue(item.PayslipViewDate),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
  }
}

/** Projects the allowlisted payroll element definition fields; excludes unrelated secured children. */
export function projectPayrollElementDefinition(value: unknown): OracleFusionHcmPayrollElementDefinition {
  const item = record(value)
  return {
    elementTypeId: idValue(item.ElementTypeId, 'ElementTypeId', true)!,
    elementName: stringValue(item.ElementName),
    personId: idValue(item.PersonId, 'PersonId'),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
    legislationCode: stringValue(item.LegislationCode),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    processingType: stringValue(item.ProcessingType),
    useAtAssignmentLevel: stringValue(item.UseAtAssignmentLevel),
    useAtRelationshipLevel: stringValue(item.UseAtRelationshipLevel),
    inputCurrencyCode: stringValue(item.InputCurrencyCode),
    outputCurrencyCode: stringValue(item.OutputCurrencyCode),
  }
}

/** Projects the allowlisted payroll input value fields; excludes unrelated secured children. */
export function projectPayrollInputValue(value: unknown): OracleFusionHcmPayrollInputValue {
  const item = record(value)
  return {
    inputValueId: idValue(item.InputValueId, 'InputValueId', true)!,
    inputValueName: stringValue(item.InputValueName),
    elementTypeId: idValue(item.ElementTypeId, 'ElementTypeId'),
    elementName: stringValue(item.ElementName),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    uom: stringValue(item.UOM),
    reservedInputValue: stringValue(item.ReservedInputValue),
    displaySequence: numberValue(item.DisplaySequence),
  }
}

/** Projects the allowlisted element entry fields; excludes unrelated secured children. */
export function projectElementEntry(value: unknown): OracleFusionHcmElementEntry {
  const item = record(value)
  return {
    elementEntryId: idValue(item.ElementEntryId, 'ElementEntryId', true)!,
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    elementTypeId: idValue(item.ElementTypeId, 'ElementTypeId'),
    elementName: stringValue(item.ElementName),
    entryType: stringValue(item.EntryType),
    creatorType: stringValue(item.CreatorType),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    usageLevel: stringValue(item.UsageLevel),
    processingType: stringValue(item.ProcessingType),
    inputCurrencyCode: stringValue(item.InputCurrencyCode),
    legCode: stringValue(item.LegCode),
    legDataGroupId: idValue(item.LegDataGroupId, 'LegDataGroupId'),
    payrollRelationshipNumber: stringValue(item.PayrollRelationshipNumber),
  }
}

/** Projects the allowlisted element entry value fields; excludes unrelated secured children. */
export function projectElementEntryValue(value: unknown): OracleFusionHcmElementEntryValue {
  const item = record(value)
  return {
    elementEntryValueId: idValue(item.ElementEntryValueId, 'ElementEntryValueId', true)!,
    inputValueId: idValue(item.InputValueId, 'InputValueId'),
    inputValueName: stringValue(item.InputValueName),
    screenEntryValue: stringValue(item.ScreenEntryValue),
    uom: stringValue(item.UOM),
    mandatoryFlag: booleanValue(item.MandatoryFlag),
    userEnterableFlag: booleanValue(item.UserEnterableFlag),
    displaySequence: numberValue(item.DisplaySequence),
  }
}

/** Projects the allowlisted person process result fields; excludes unrelated secured children. */
export function projectPersonProcessResult(value: unknown): OracleFusionHcmPersonProcessResult {
  const item = record(value)
  return {
    objectActionId: idValue(item.ObjectActionId, 'ObjectActionId'),
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    payrollRelationshipId: idValue(item.PayrollRelationshipId, 'PayrollRelationshipId'),
    payrollId: idValue(item.PayrollId, 'PayrollId'),
    payroll: stringValue(item.Payroll),
    actionTypeCode: stringValue(item.ActionTypeCode),
    actionStatusCode: stringValue(item.ActionStatusCode),
    status: stringValue(item.Status),
    processDate: stringValue(item.ProcessDate),
    processStartDate: stringValue(item.ProcessStartDate),
    processEndDate: stringValue(item.ProcessEndDate),
    flowInstanceId: idValue(item.FlowInstanceId, 'FlowInstanceId'),
    flowName: stringValue(item.FlowName),
    payrollPeriodName: stringValue(item.PayrollPeriodName),
    legislationCode: stringValue(item.LegislationCode),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
  }
}

/** Projects the allowlisted payroll run result fields; excludes unrelated secured children. */
export function projectPayrollRunResult(value: unknown): OracleFusionHcmPayrollRunResult {
  const item = record(value)
  return {
    runResultId: idValue(item.RunResultId, 'RunResultId', true)!,
    inputValueId: idValue(item.InputValueId, 'InputValueId'),
    inputValueName: stringValue(item.InputValueName),
    elementEntryId: idValue(item.ElementEntryId, 'ElementEntryId'),
    elementTypeId: idValue(item.ElementTypeId, 'ElementTypeId'),
    elementName: stringValue(item.ElementName),
    resultValue: stringValue(item.ResultValue),
    personId: idValue(item.PersonId, 'PersonId'),
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    payrollRelationshipId: idValue(item.PayrollRelationshipId, 'PayrollRelationshipId'),
    dateEarned: stringValue(item.DateEarned),
    outputCurrencyCode: stringValue(item.OutputCurrencyCode),
    inputCurrencyCode: stringValue(item.Inputcurrencycode),
    uom: stringValue(item.Uom),
    prorationStartDate: stringValue(item.ProrationStartDate),
    prorationEndDate: stringValue(item.ProrationEndDate),
  }
}

/** Projects the allowlisted payroll balance fields; excludes unrelated secured children. */
export function projectPayrollBalance(value: unknown): OracleFusionHcmPayrollBalance {
  const item = record(value)
  return {
    balanceTypeId: idValue(item.BalanceTypeId, 'BalanceTypeId'),
    balanceName: stringValue(item.BalanceName),
    dimensionName: stringValue(item.DimensionName),
    payrollRelActionId: idValue(item.PayrollRelActionId, 'PayrollRelActionId'),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
    legislationCode: stringValue(item.LegislationCode),
    uom: stringValue(item.Uom),
    uomCode: stringValue(item.UomCode),
    ctxString: stringValue(item.CtxString),
    ctxUserString: stringValue(item.CtxUserString),
    value1: stringValue(item.Value1),
    defbalId1: idValue(item.DefbalId1, 'DefbalId1'),
    value2: stringValue(item.Value2),
    defbalId2: idValue(item.DefbalId2, 'DefbalId2'),
    value3: stringValue(item.Value3),
    defbalId3: idValue(item.DefbalId3, 'DefbalId3'),
    value4: stringValue(item.Value4),
    defbalId4: idValue(item.DefbalId4, 'DefbalId4'),
    value5: stringValue(item.Value5),
    defbalId5: idValue(item.DefbalId5, 'DefbalId5'),
    value6: stringValue(item.Value6),
    defbalId6: idValue(item.DefbalId6, 'DefbalId6'),
    value7: stringValue(item.Value7),
    defbalId7: idValue(item.DefbalId7, 'DefbalId7'),
    value8: stringValue(item.Value8),
    defbalId8: idValue(item.DefbalId8, 'DefbalId8'),
    value9: stringValue(item.Value9),
    defbalId9: idValue(item.DefbalId9, 'DefbalId9'),
    value10: stringValue(item.Value10),
    defbalId10: idValue(item.DefbalId10, 'DefbalId10'),
    totalValue1: stringValue(item.TotalValue1),
    totalValue2: stringValue(item.TotalValue2),
  }
}

/** Projects the allowlisted salary fields; excludes unrelated secured children. */
export function projectSalary(value: unknown): OracleFusionHcmSalary {
  const item = record(value)
  return {
    salaryId: idValue(item.SalaryId, 'SalaryId', true)!,
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    salaryBasisId: idValue(item.SalaryBasisId, 'SalaryBasisId'),
    salaryBasisName: stringValue(item.SalaryBasisName),
    salaryBasisType: stringValue(item.SalaryBasisType),
    salaryAmount: numberValue(item.SalaryAmount),
    currencyCode: stringValue(item.CurrencyCode),
    salaryFrequencyCode: stringValue(item.SalaryFrequencyCode),
    dateFrom: stringValue(item.DateFrom),
    dateTo: stringValue(item.DateTo),
    annualSalary: numberValue(item.AnnualSalary),
    annualFullTimeSalary: numberValue(item.AnnualFullTimeSalary),
    multipleComponents: stringValue(item.MultipleComponents),
    pendingTransactionExists: stringValue(item.PendingTransactionExists),
    salaryTransactionStatus: stringValue(item.SalaryTransactionStatus),
    salaryAmountScale: numberValue(item.SalaryAmountScale),
  }
}

/** Projects the allowlisted salary basis fields; excludes unrelated secured children. */
export function projectSalaryBasis(value: unknown): OracleFusionHcmSalaryBasis {
  const item = record(value)
  return {
    salaryBasisId: idValue(item.SalaryBasisId, 'SalaryBasisId', true)!,
    salaryBasisName: stringValue(item.SalaryBasisName),
    salaryBasisType: stringValue(item.SalaryBasisType),
    code: stringValue(item.Code),
    frequencyCode: stringValue(item.FrequencyCode),
    frequencyName: stringValue(item.FrequencyName),
    inputCurrencyCode: stringValue(item.InputCurrencyCode),
    legislativeDataGroupId: idValue(item.LegislativeDataGroupId, 'LegislativeDataGroupId'),
    gradeRateId: idValue(item.GradeRateId, 'GradeRateId'),
    componentUsage: stringValue(item.ComponentUsage),
    salaryAmountScale: numberValue(item.SalaryAmountScale),
    status: stringValue(item.Status),
    useAtAssignmentLevel: stringValue(item.UseAtAssignmentLevel),
    useAtRelationshipLevel: stringValue(item.UseAtRelationshipLevel),
    useAtTermsLevel: stringValue(item.UseAtTermsLevel),
  }
}

/** Projects the allowlisted standard salary component fields; excludes unrelated secured children. */
export function projectStandardSalaryComponent(value: unknown): OracleFusionHcmStandardSalaryComponent {
  const item = record(value)
  return {
    salaryComponentId: idValue(item.SalaryComponentId, 'SalaryComponentId', true)!,
    salaryId: idValue(item.SalaryId, 'SalaryId'),
    componentName: stringValue(item.ComponentName),
    componentReasonCode: stringValue(item.ComponentReasonCode),
    adjustmentAmount: numberValue(item.AdjustmentAmount),
    adjustmentPercentage: numberValue(item.AdjustmentPercentage),
    displaySequence: numberValue(item.DisplaySequence),
    changeAmountScale: numberValue(item.ChangeAmountScale),
  }
}

/** Projects the allowlisted simple salary component fields; excludes unrelated secured children. */
export function projectSimpleSalaryComponent(value: unknown): OracleFusionHcmSimpleSalaryComponent {
  const item = record(value)
  return {
    simpleSalaryCompntId: idValue(item.SimpleSalaryCompntId, 'SimpleSalaryCompntId', true)!,
    salaryId: idValue(item.SalaryId, 'SalaryId'),
    basisSimpleComponentId: idValue(item.BasisSimpleComponentId, 'BasisSimpleComponentId'),
    componentName: stringValue(item.ComponentName),
    componentCode: stringValue(item.ComponentCode),
    componentType: stringValue(item.ComponentType),
    currencyCode: stringValue(item.CurrencyCode),
    amount: numberValue(item.Amount),
    annualAmount: numberValue(item.AnnualAmount),
    annualFtAmount: numberValue(item.AnnualFtAmount),
    adjustmentAmount: numberValue(item.AdjustmentAmount),
    adjustmentPercent: numberValue(item.AdjustmentPercent),
    percentage: numberValue(item.Percentage),
    scale: numberValue(item.Scale),
    userSelectedComponent: stringValue(item.UserSelectedComponent),
    overallSalaryAffect: stringValue(item.OverallSalaryAffect),
  }
}

/** Projects the allowlisted rate salary component fields; excludes unrelated secured children. */
export function projectRateSalaryComponent(value: unknown): OracleFusionHcmRateSalaryComponent {
  const item = record(value)
  return {
    salaryPayComponentId: idValue(item.SalaryPayComponentId, 'SalaryPayComponentId', true)!,
    salaryId: idValue(item.SalaryId, 'SalaryId'),
    payRateDefinitionId: idValue(item.PayRateDefinitionId, 'PayRateDefinitionId'),
    name: stringValue(item.Name),
    shortName: stringValue(item.ShortName),
    rateAmount: numberValue(item.RateAmount),
    rateAnnualAmount: numberValue(item.RateAnnualAmount),
    rateAnnualFtAmount: numberValue(item.RateAnnualFtAmount),
    rateCurrencyCode: stringValue(item.RateCurrencyCode),
    ratePeriodicityCode: stringValue(item.RatePeriodicityCode),
    rateMinimumAmount: numberValue(item.RateMinimumAmount),
    rateMaximumAmount: numberValue(item.RateMaximumAmount),
    rateAdjustmentAmount: numberValue(item.RateAdjustmentAmount),
    rateAdjustmentPercent: numberValue(item.RateAdjustmentPercent),
    rateFactor: numberValue(item.RateFactor),
    rateOverallSalaryFlag: booleanValue(item.RateOverallSalaryFlag),
  }
}

/** Projects the allowlisted grade rate value fields; excludes unrelated secured children. */
export function projectGradeRateValue(value: unknown): OracleFusionHcmGradeRateValue {
  const item = record(value)
  return {
    rateValueId: idValue(item.RateValueId, 'RateValueId', true)!,
    gradeId: idValue(item.GradeId, 'GradeId'),
    effectiveStartDate: stringValue(item.EffectiveStartDate),
    effectiveEndDate: stringValue(item.EffectiveEndDate),
    minimumAmount: numberValue(item.MinimumAmount),
    midValueAmount: numberValue(item.MidValueAmount),
    maximumAmount: numberValue(item.MaximumAmount),
    valueAmount: numberValue(item.ValueAmount),
  }
}

/** Projects the allowlisted goal plan fields; excludes unrelated secured children. */
export function projectGoalPlan(value: unknown): OracleFusionHcmGoalPlan {
  const item = record(value)
  return {
    goalPlanId: idValue(item.GoalPlanId, 'GoalPlanId', true)!,
    goalPlanName: stringValue(item.GoalPlanName),
    reviewPeriodId: idValue(item.ReviewPeriodId, 'ReviewPeriodId'),
    reviewPeriodName: stringValue(item.ReviewPeriodName),
    startDate: stringValue(item.StartDate),
    endDate: stringValue(item.EndDate),
    goalSettingStartDate: stringValue(item.GoalSettingStartDate),
    goalSettingEndDate: stringValue(item.GoalSettingEndDate),
    goalPlanActiveCode: stringValue(item.GoalPlanActiveCode),
    restrictGoalCreationFlag: booleanValue(item.RestrictGoalCreationFlag),
    restrictGoalUpdateFlag: booleanValue(item.RestrictGoalUpdateFlag),
    enableWeightingFlag: booleanValue(item.EnableWeightingFlag),
  }
}

/** Projects the allowlisted performance goal fields; excludes unrelated secured children. */
export function projectPerformanceGoal(value: unknown): OracleFusionHcmPerformanceGoal {
  const item = record(value)
  return {
    goalId: idValue(item.GoalId, 'GoalId', true)!,
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    goalName: stringValue(item.GoalName),
    description: stringValue(item.Description),
    startDate: stringValue(item.StartDate),
    targetCompletionDate: stringValue(item.TargetCompletionDate),
    status: stringValue(item.Status),
    statusMeaning: stringValue(item.StatusMeaning),
    percentComplete: stringValue(item.PercentComplete),
    reviewPeriodId: idValue(item.ReviewPeriodId, 'ReviewPeriodId'),
  }
}

/** Projects the allowlisted development goal fields; excludes unrelated secured children. */
export function projectDevelopmentGoal(value: unknown): OracleFusionHcmDevelopmentGoal {
  const item = record(value)
  return {
    goalId: idValue(item.GoalId, 'GoalId', true)!,
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    assignmentNumber: stringValue(item.AssignmentNumber),
    goalName: stringValue(item.GoalName),
    startDate: stringValue(item.StartDate),
    targetCompletionDate: stringValue(item.TargetCompletionDate),
    actualCompletionDate: stringValue(item.ActualCompletionDate),
    status: stringValue(item.Status),
    statusMeaning: stringValue(item.StatusMeaning),
    percentComplete: stringValue(item.PercentComplete),
    privateFlag: booleanValue(item.PrivateFlag),
    requiresApprovalStatus: stringValue(item.RequiresApprovalStatus),
    goalApprovalState: stringValue(item.GoalApprovalState),
  }
}

/** Projects the allowlisted performance document fields; excludes unrelated secured children. */
export function projectPerformanceDocument(value: unknown): OracleFusionHcmPerformanceDocument {
  const item = record(value)
  return {
    evaluationId: idValue(item.EvaluationId, 'EvaluationId', true)!,
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    assignmentId: idValue(item.AssignmentId, 'AssignmentId'),
    performanceDocumentName: stringValue(item.PerformanceDocumentName),
    evalStatus: stringValue(item.EvalStatus),
    statusCode: stringValue(item.StatusCode),
    reviewPeriodId: idValue(item.ReviewPeriodId, 'ReviewPeriodId'),
    startDate: stringValue(item.StartDate),
    endDate: stringValue(item.EndDate),
    managerId: idValue(item.ManagerId, 'ManagerId'),
    managerAssignmentId: idValue(item.ManagerAssignmentId, 'ManagerAssignmentId'),
  }
}

/** Projects the allowlisted performance document role fields; excludes unrelated secured children. */
export function projectPerformanceDocumentRole(value: unknown): OracleFusionHcmPerformanceDocumentRole {
  const item = record(value)
  return {
    evalRoleId: idValue(item.EvalRoleId, 'EvalRoleId', true)!,
    roleTypeCode: stringValue(item.RoleTypeCode),
    minimumNumberPcpns: numberValue(item.MinimumNumberPcpns),
    matrixParticipantFlag: booleanValue(item.MatrixParticipantFlag),
  }
}

/** Projects the allowlisted performance document participant fields; excludes unrelated secured children. */
export function projectPerformanceDocumentParticipant(value: unknown): OracleFusionHcmPerformanceDocumentParticipant {
  const item = record(value)
  return {
    evalParticipantId: idValue(item.EvalParticipantId, 'EvalParticipantId', true)!,
    evalRoleId: idValue(item.EvalRoleId, 'EvalRoleId'),
    personId: idValue(item.PersonId, 'PersonId'),
    participationStatusCode: stringValue(item.ParticipationStatusCode),
    dueDate: stringValue(item.DueDate),
    fdbackCompletionDate: stringValue(item.FdbackCompletionDate),
    matrixParticipantFlag: booleanValue(item.MatrixParticipantFlag),
    roleTypeCode: stringValue(item.RoleTypeCode),
  }
}

/** Projects the allowlisted performance document task fields; excludes unrelated secured children. */
export function projectPerformanceDocumentTask(value: unknown): OracleFusionHcmPerformanceDocumentTask {
  const item = record(value)
  return {
    evalStepId: idValue(item.EvalStepId, 'EvalStepId', true)!,
    stepCode: stringValue(item.StepCode),
    stepStatus: stringValue(item.StepStatus),
    taskName: stringValue(item.TaskName),
    taskStatus: stringValue(item.TaskStatus),
    dueDate: stringValue(item.DueDate),
  }
}

/** Projects the allowlisted talent profile fields; excludes unrelated secured children. */
export function projectTalentProfile(value: unknown): OracleFusionHcmTalentProfile {
  const item = record(value)
  return {
    profileId: idValue(item.ProfileId, 'ProfileId', true)!,
    personId: idValue(item.PersonId, 'PersonId'),
    personNumber: stringValue(item.PersonNumber),
    profileCode: stringValue(item.ProfileCode),
    displayName: stringValue(item.DisplayName),
    statusCode: stringValue(item.StatusCode),
  }
}

/** Projects the allowlisted talent profile section fields; excludes unrelated secured children. */
export function projectTalentProfileSection(value: unknown): OracleFusionHcmTalentProfileSection {
  const item = record(value)
  return {
    profileSectionId: idValue(item.ProfileSectionId, 'ProfileSectionId', true)!,
    sectionId: idValue(item.SectionId, 'SectionId'),
    sectionName: stringValue(item.SectionName),
    sectionContext: stringValue(item.SectionContext),
  }
}

/** Projects the allowlisted talent profile skill fields; excludes unrelated secured children. */
export function projectTalentProfileSkill(value: unknown): OracleFusionHcmTalentProfileSkill {
  const item = record(value)
  return {
    skillId: idValue(item.SkillId, 'SkillId', true)!,
    profileId: idValue(item.ProfileId, 'ProfileId'),
    sectionId: idValue(item.SectionId, 'SectionId'),
    skill: stringValue(item.Skill),
    skillType: stringValue(item.SkillType),
    skillTypeMeaning: stringValue(item.SkillTypeMeaning),
    dateAchieved: stringValue(item.DateAchieved),
    yearsOfExperience: numberValue(item.YearsOfExperience),
    projectOrActivity: stringValue(item.ProjectOrActivity),
    source: stringValue(item.Source),
    sourceType: stringValue(item.SourceType),
  }
}

/** Projects the allowlisted talent profile certification fields; excludes unrelated secured children. */
export function projectTalentProfileCertification(value: unknown): OracleFusionHcmTalentProfileCertification {
  const item = record(value)
  return {
    certificationId: idValue(item.CertificationId, 'CertificationId', true)!,
    profileId: idValue(item.ProfileId, 'ProfileId'),
    sectionId: idValue(item.SectionId, 'SectionId'),
    licenseOrCertificate: stringValue(item.LicenseOrCertificate),
    title: stringValue(item.Title),
    issueDate: stringValue(item.IssueDate),
    expirationDate: stringValue(item.ExpirationDate),
    renewalDate: stringValue(item.RenewalDate),
    status: stringValue(item.Status),
    statusMeaning: stringValue(item.StatusMeaning),
    issuedBy: stringValue(item.IssuedBy),
    verified: stringValue(item.Verified),
    verifiedMeaning: stringValue(item.VerifiedMeaning),
  }
}

/** Projects the allowlisted time record fields; excludes unrelated secured children. */
export function projectTimeRecord(value: unknown): OracleFusionHcmTimeRecord {
  const item = record(value)
  return {
    timeRecordId: idValue(item.timeRecordId, 'timeRecordId', true)!,
    timeRecordVersion: numberValue(item.timeRecordVersion),
    timeRecordGroupId: idValue(item.timeRecordGroupId, 'timeRecordGroupId'),
    timeRecordGroupVersion: numberValue(item.timeRecordGroupVersion),
    personId: idValue(item.personId, 'personId'),
    personNumber: stringValue(item.personNumber),
    assignmentNumber: stringValue(item.assignmentNumber),
    recordType: stringValue(item.recordType),
    groupType: stringValue(item.groupType),
    startTime: stringValue(item.startTime),
    stopTime: stringValue(item.stopTime),
    measure: numberValue(item.measure),
    unitOfMeasure: stringValue(item.unitOfMeasure),
    earnedDate: stringValue(item.earnedDate),
    overtimeDate: stringValue(item.overtimeDate),
  }
}

/** Projects the allowlisted time card fields; excludes unrelated secured children. */
export function projectTimeCard(value: unknown): OracleFusionHcmTimeCard {
  const item = record(value)
  return {
    timeRecordGroupId: idValue(item.timeRecordGroupId, 'timeRecordGroupId', true)!,
    timeRecordGroupVersion: numberValue(item.timeRecordGroupVersion),
    personId: idValue(item.personId, 'personId'),
    personNumber: stringValue(item.personNumber),
    assignmentNumber: stringValue(item.assignmentNumber),
    startTime: stringValue(item.startTime),
    stopTime: stringValue(item.stopTime),
    totalHours: numberValue(item.totalHours),
    groupType: stringValue(item.groupType),
    parentTimeRecordGroupId: idValue(item.parentTimeRecordGroupId, 'parentTimeRecordGroupId'),
    parentTimeRecordGroupVersion: numberValue(item.parentTimeRecordGroupVersion),
  }
}

/** Projects the allowlisted time attribute fields; excludes unrelated secured children. */
export function projectTimeAttribute(value: unknown): OracleFusionHcmTimeAttribute {
  const item = record(value)
  return {
    tmAtrbFldId: idValue(item.tmAtrbFldId, 'tmAtrbFldId', true)!,
    tmAtrbFldUsageId: idValue(item.tmAtrbFldUsageId, 'tmAtrbFldUsageId'),
    attributeName: stringValue(item.attributeName),
    contextCode: stringValue(item.contextCode),
    displayName: stringValue(item.displayName),
    description: stringValue(item.description),
    name: stringValue(item.name),
  }
}

/** Projects the allowlisted time attribute data source fields; excludes unrelated secured children. */
export function projectTimeAttributeDataSource(value: unknown): OracleFusionHcmTimeAttributeDataSource {
  const item = record(value)
  return {
    dataSourceUsageId: idValue(item.dataSourceUsageId, 'dataSourceUsageId', true)!,
    dataSourceUsageCode: stringValue(item.dataSourceUsageCode),
    tmAtrbFldId: idValue(item.tmAtrbFldId, 'tmAtrbFldId'),
  }
}

/** Projects the allowlisted time attribute criteria bind fields; excludes unrelated secured children. */
export function projectTimeAttributeCriteriaBind(value: unknown): OracleFusionHcmTimeAttributeCriteriaBind {
  const item = record(value)
  return {
    bindName: stringValue(item.bindName),
    criteriaName: stringValue(item.criteriaName),
    dataType: stringValue(item.dataType),
  }
}

/** Projects the allowlisted time attribute value fields; excludes unrelated secured children. */
export function projectTimeAttributeValue(value: unknown): OracleFusionHcmTimeAttributeValue {
  const item = record(value)
  return {
    value: stringValue(item.value),
    displayValue: stringValue(item.displayValue),
  }
}

/** Projects the allowlisted time record request fields; excludes unrelated secured children. */
export function projectTimeRecordRequest(value: unknown): OracleFusionHcmTimeRecordRequest {
  const item = record(value)
  return {
    timeRecordEventRequestId: idValue(item.timeRecordEventRequestId, 'timeRecordEventRequestId', true)!,
    processInline: stringValue(item.processInline),
    processMode: stringValue(item.processMode),
  }
}

/** Projects the allowlisted time record request event fields; excludes unrelated secured children. */
export function projectTimeRecordRequestEvent(value: unknown): OracleFusionHcmTimeRecordRequestEvent {
  const item = record(value)
  return {
    timeRecordEventId: idValue(item.timeRecordEventId, 'timeRecordEventId'),
    timeRecordEventRequestId: idValue(item.timeRecordEventRequestId, 'timeRecordEventRequestId'),
    timeRecordId: idValue(item.timeRecordId, 'timeRecordId'),
    timeRecordVersion: numberValue(item.timeRecordVersion),
    operationType: stringValue(item.operationType),
    eventStatus: stringValue(item.eventStatus),
    eventStatusValue: numberValue(item.eventStatusValue),
    crudStatusValue: numberValue(item.crudStatusValue),
    personId: idValue(item.personId, 'personId'),
    reporterId: stringValue(item.reporterId),
    reporterIdType: stringValue(item.reporterIdType),
    assignmentNumber: stringValue(item.assignmentNumber),
    startTime: stringValue(item.startTime),
    stopTime: stringValue(item.stopTime),
    measure: numberValue(item.measure),
    referenceDate: stringValue(item.referenceDate),
  }
}

/** Projects the allowlisted time record event message fields; excludes unrelated secured children. */
export function projectTimeRecordEventMessage(value: unknown): OracleFusionHcmTimeRecordEventMessage {
  const item = record(value)
  return {
    timeRecordEventMessageId: idValue(item.timeRecordEventMessageId, 'timeRecordEventMessageId', true)!,
    timeRecordId: idValue(item.timeRecordId, 'timeRecordId'),
    timeBldgBlkVersion: numberValue(item.timeBldgBlkVersion),
    messageId: idValue(item.messageId, 'messageId'),
    messageName: stringValue(item.messageName),
    messageField: stringValue(item.messageField),
    attributeType: stringValue(item.attributeType),
    allowException: stringValue(item.allowException),
  }
}
