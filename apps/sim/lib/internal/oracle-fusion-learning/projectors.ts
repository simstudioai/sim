import { isRecordLike } from '@sim/utils/object'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import type * as Types from '@/tools/oracle_fusion_learning/types'

function record(value: unknown): Record<string, unknown> {
  if (!isRecordLike(value)) throw new Error('Invalid Learning resource')
  return value
}
function id(value: unknown): string {
  const normalized = normalizeOracleFusionDecimalIdentifier(value, { maxDigits: 19 })
  if (!normalized || normalized === '0') throw new Error('Invalid Learning identifier')
  return normalized
}
function optionalId(value: unknown): string | null {
  return value == null ? null : id(value)
}
function text(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Invalid Learning text field')
  return value
}
function number(value: unknown): number | null {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid Learning number field')
  return value
}

export const selfFields = 'learningItemId,learningItemNumber,learningItemTitle,learningItemType,learningItemStatus,learningItemVisibility,learningItemDescription,learningItemCatalogProfileId,learningItemCatalogProfileNumber,learningItemExpectedEffortInSeconds,learningItemPublishStartDate,learningItemPublishEndDate,learningItemEnrollmentStartDate,learningItemEnrollmentEndDate,learningItemLastModifiedDate,learningItemActiveDate,learningItemInactiveDate,learningItemProvider,learningItemProviderType,learningItemDraftExists,learningItemPublishedExists'

export function projectSelfPacedItem(value: unknown): Types.SelfPacedItem {
  const item = record(value)
  return {
    learningItemId: id(item.learningItemId),
    learningItemNumber: text(item.learningItemNumber),
    learningItemTitle: text(item.learningItemTitle),
    learningItemType: text(item.learningItemType),
    learningItemStatus: text(item.learningItemStatus),
    learningItemVisibility: text(item.learningItemVisibility),
    learningItemDescription: text(item.learningItemDescription),
    learningItemCatalogProfileId: optionalId(item.learningItemCatalogProfileId),
    learningItemCatalogProfileNumber: text(item.learningItemCatalogProfileNumber),
    learningItemExpectedEffortInSeconds: number(item.learningItemExpectedEffortInSeconds),
    learningItemPublishStartDate: text(item.learningItemPublishStartDate),
    learningItemPublishEndDate: text(item.learningItemPublishEndDate),
    learningItemEnrollmentStartDate: text(item.learningItemEnrollmentStartDate),
    learningItemEnrollmentEndDate: text(item.learningItemEnrollmentEndDate),
    learningItemLastModifiedDate: text(item.learningItemLastModifiedDate),
    learningItemActiveDate: text(item.learningItemActiveDate),
    learningItemInactiveDate: text(item.learningItemInactiveDate),
    learningItemProvider: text(item.learningItemProvider),
    learningItemProviderType: text(item.learningItemProviderType),
    learningItemDraftExists: text(item.learningItemDraftExists),
    learningItemPublishedExists: text(item.learningItemPublishedExists),
  }
}

export const eventFields = 'learningItemId,learningItemNumber,learningItemTitle,learningItemType,learningItemStatus,learningItemVisibility,learningItemDescription,learningItemCatalogProfileId,learningItemCatalogProfileNumber,learningItemExpectedEffortInSeconds,learningItemPublishStartDate,learningItemPublishEndDate,learningItemEnrollmentStartDate,learningItemEnrollmentEndDate,learningItemLastModifiedDate,eventStartDate,eventEndDate,eventTimezone,eventCapacityEnabled,eventCapacityMaximum,eventCapacityMinimum,eventWaitlistEnabled,eventWaitlistMaximum,eventClosedDate,eventCancelDate'

export function projectLearningEvent(value: unknown): Types.LearningEvent {
  const item = record(value)
  return {
    learningItemId: id(item.learningItemId),
    learningItemNumber: text(item.learningItemNumber),
    learningItemTitle: text(item.learningItemTitle),
    learningItemType: text(item.learningItemType),
    learningItemStatus: text(item.learningItemStatus),
    learningItemVisibility: text(item.learningItemVisibility),
    learningItemDescription: text(item.learningItemDescription),
    learningItemCatalogProfileId: optionalId(item.learningItemCatalogProfileId),
    learningItemCatalogProfileNumber: text(item.learningItemCatalogProfileNumber),
    learningItemExpectedEffortInSeconds: number(item.learningItemExpectedEffortInSeconds),
    learningItemPublishStartDate: text(item.learningItemPublishStartDate),
    learningItemPublishEndDate: text(item.learningItemPublishEndDate),
    learningItemEnrollmentStartDate: text(item.learningItemEnrollmentStartDate),
    learningItemEnrollmentEndDate: text(item.learningItemEnrollmentEndDate),
    learningItemLastModifiedDate: text(item.learningItemLastModifiedDate),
    eventStartDate: text(item.eventStartDate),
    eventEndDate: text(item.eventEndDate),
    eventTimezone: text(item.eventTimezone),
    eventCapacityEnabled: text(item.eventCapacityEnabled),
    eventCapacityMaximum: number(item.eventCapacityMaximum),
    eventCapacityMinimum: number(item.eventCapacityMinimum),
    eventWaitlistEnabled: text(item.eventWaitlistEnabled),
    eventWaitlistMaximum: number(item.eventWaitlistMaximum),
    eventClosedDate: text(item.eventClosedDate),
    eventCancelDate: text(item.eventCancelDate),
  }
}

export const activityFields = 'activityId,activityNumber,activityType,title,description,status,startDate,endDate,timezone,expectedEffortInSeconds,completionRule,completionType,enableAttendanceProcessing,minimumAttendance,minimumAttendanceUOM,instructors,classrooms,virtualClassroomURL'

export function projectEventActivity(value: unknown): Types.EventActivity {
  const item = record(value)
  return {
    activityId: id(item.activityId),
    activityNumber: text(item.activityNumber),
    activityType: text(item.activityType),
    title: text(item.title),
    description: text(item.description),
    status: text(item.status),
    startDate: text(item.startDate),
    endDate: text(item.endDate),
    timezone: text(item.timezone),
    expectedEffortInSeconds: number(item.expectedEffortInSeconds),
    completionRule: text(item.completionRule),
    completionType: text(item.completionType),
    enableAttendanceProcessing: text(item.enableAttendanceProcessing),
    minimumAttendance: number(item.minimumAttendance),
    minimumAttendanceUOM: text(item.minimumAttendanceUOM),
    instructors: text(item.instructors),
    classrooms: text(item.classrooms),
    virtualClassroomURL: text(item.virtualClassroomURL),
  }
}

export const recordFields = 'assignmentRecordId,assignmentRecordNumber,assignedToId,assignedToNumber,assignedToDisplayName,learningItemId,learningItemNumber,learningItemTitle,learningItemType,assignmentType,assignmentStatus,assignmentSubStatus,assignmentDueDate,assignedDate,completedDate,actualScore,actualEffortInHours,actualCpeUnits,assignmentLastModifiedDate'

export function projectLearningRecord(value: unknown): Types.LearningRecord {
  const item = record(value)
  return {
    assignmentRecordId: id(item.assignmentRecordId),
    assignmentRecordNumber: text(item.assignmentRecordNumber),
    assignedToId: optionalId(item.assignedToId),
    assignedToNumber: text(item.assignedToNumber),
    assignedToDisplayName: text(item.assignedToDisplayName),
    learningItemId: optionalId(item.learningItemId),
    learningItemNumber: text(item.learningItemNumber),
    learningItemTitle: text(item.learningItemTitle),
    learningItemType: text(item.learningItemType),
    assignmentType: text(item.assignmentType),
    assignmentStatus: text(item.assignmentStatus),
    assignmentSubStatus: text(item.assignmentSubStatus),
    assignmentDueDate: text(item.assignmentDueDate),
    assignedDate: text(item.assignedDate),
    completedDate: text(item.completedDate),
    actualScore: number(item.actualScore),
    actualEffortInHours: number(item.actualEffortInHours),
    actualCpeUnits: number(item.actualCpeUnits),
    assignmentLastModifiedDate: text(item.assignmentLastModifiedDate),
  }
}

export const offeringFields = 'assignmentRecordId,assignmentRecordNumber,learningItemId,learningItemNumber,learningItemTitle,assignmentStatus,assignmentSubStatus,assignmentDueDate,completedDate,isPrimaryOffering,offeringStartDate,offeringEndDate,offeringTimeZone,offeringDeliveryMode,maximumCapacity,offeringAvailableCapacity,currentWaitlistPosition'

export function projectSelectedCourseOffering(value: unknown): Types.SelectedCourseOffering {
  const item = record(value)
  return {
    assignmentRecordId: id(item.assignmentRecordId),
    assignmentRecordNumber: text(item.assignmentRecordNumber),
    learningItemId: optionalId(item.learningItemId),
    learningItemNumber: text(item.learningItemNumber),
    learningItemTitle: text(item.learningItemTitle),
    assignmentStatus: text(item.assignmentStatus),
    assignmentSubStatus: text(item.assignmentSubStatus),
    assignmentDueDate: text(item.assignmentDueDate),
    completedDate: text(item.completedDate),
    isPrimaryOffering: text(item.isPrimaryOffering),
    offeringStartDate: text(item.offeringStartDate),
    offeringEndDate: text(item.offeringEndDate),
    offeringTimeZone: text(item.offeringTimeZone),
    offeringDeliveryMode: text(item.offeringDeliveryMode),
    maximumCapacity: number(item.maximumCapacity),
    offeringAvailableCapacity: number(item.offeringAvailableCapacity),
    currentWaitlistPosition: number(item.currentWaitlistPosition),
  }
}

export const completionFields = 'activityAssignmentRecordId,activityAttemptId,activityId,activityNumber,activityTitle,activityType,activityAttemptStatus,activityAttemptActualScore,activityAttemptActualEffort,activityPassingScore,activityAttemptLocked,activityLearnerMarkCompl,activityLearnerRecordAttendance,activityStartDatetimeUTC,activityEndDatetimeUTC,activityTimeZone,activityAttemptComplDate'

export function projectCompletionDetail(value: unknown): Types.CompletionDetail {
  const item = record(value)
  return {
    activityAssignmentRecordId: id(item.activityAssignmentRecordId),
    activityAttemptId: optionalId(item.activityAttemptId),
    activityId: optionalId(item.activityId),
    activityNumber: text(item.activityNumber),
    activityTitle: text(item.activityTitle),
    activityType: text(item.activityType),
    activityAttemptStatus: text(item.activityAttemptStatus),
    activityAttemptActualScore: number(item.activityAttemptActualScore),
    activityAttemptActualEffort: number(item.activityAttemptActualEffort),
    activityPassingScore: number(item.activityPassingScore),
    activityAttemptLocked: text(item.activityAttemptLocked),
    activityLearnerMarkCompl: text(item.activityLearnerMarkCompl),
    activityLearnerRecordAttendance: text(item.activityLearnerRecordAttendance),
    activityStartDatetimeUTC: text(item.activityStartDatetimeUTC),
    activityEndDatetimeUTC: text(item.activityEndDatetimeUTC),
    activityTimeZone: text(item.activityTimeZone),
    activityAttemptComplDate: text(item.activityAttemptComplDate),
  }
}

export const summaryFields = 'activitySectionsCount,activitySectionsTotalActivitiesCount,actualEffort,actualScore,completionProgress,completionRequirement,completionRequirementUnits,completionRequirementUnitsMeaning,effortUnits,effortUnitsMeaning,expectedEffort,expectedEffortInSeconds,passingScore'

export function projectCompletionSummary(value: unknown): Types.CompletionSummary {
  const item = record(value)
  return {
    activitySectionsCount: number(item.activitySectionsCount),
    activitySectionsTotalActivitiesCount: number(item.activitySectionsTotalActivitiesCount),
    actualEffort: number(item.actualEffort),
    actualScore: number(item.actualScore),
    completionProgress: number(item.completionProgress),
    completionRequirement: number(item.completionRequirement),
    completionRequirementUnits: text(item.completionRequirementUnits),
    completionRequirementUnitsMeaning: text(item.completionRequirementUnitsMeaning),
    effortUnits: text(item.effortUnits),
    effortUnitsMeaning: text(item.effortUnitsMeaning),
    expectedEffort: text(item.expectedEffort),
    expectedEffortInSeconds: text(item.expectedEffortInSeconds),
    passingScore: number(item.passingScore),
  }
}

export const hintsFields = 'activityLearnerMarkCompl,allowRetry,canEditAssignmentHint,canManageLearningItem,canRecommendLearningItem,canRetakeLearningItem,dataSecurityPrivilege,isWithdrawApprovalEnabled,nextRetryDate'

export function projectActionHints(value: unknown): Types.ActionHints {
  const item = record(value)
  return {
    activityLearnerMarkCompl: text(item.activityLearnerMarkCompl),
    allowRetry: text(item.allowRetry),
    canEditAssignmentHint: text(item.canEditAssignmentHint),
    canManageLearningItem: text(item.canManageLearningItem),
    canRecommendLearningItem: text(item.canRecommendLearningItem),
    canRetakeLearningItem: text(item.canRetakeLearningItem),
    dataSecurityPrivilege: text(item.dataSecurityPrivilege),
    isWithdrawApprovalEnabled: text(item.isWithdrawApprovalEnabled),
    nextRetryDate: text(item.nextRetryDate),
  }
}

export const historyFields = 'enrollmentHistoryOrderId,enrollmentHistoryStatusMessage'

export function projectEnrollmentHistory(value: unknown): Types.EnrollmentHistory {
  const item = record(value)
  return {
    enrollmentHistoryOrderId: number(item.enrollmentHistoryOrderId),
    enrollmentHistoryStatusMessage: text(item.enrollmentHistoryStatusMessage),
  }
}

export const profileFields = 'assignmentProfileId,assignmentProfileNumber,assignmentProfileTitle,assignmentProfileDescription,assignmentProfileStatus,assignmentProfileStartDate,assignmentProfileEndDate,learningItemId,learningItemNumber,learningItemTitle,learningItemType,assignmentType,assignmentSubType,targetAssignmentStatus,assignmentRecordStatus,assignmentDueDate,assignmentDueDateType,processingRule,processingFrequency,processId,lastProcessedDate,lastModifiedDate'

export function projectAssignmentProfile(value: unknown): Types.AssignmentProfile {
  const item = record(value)
  return {
    assignmentProfileId: id(item.assignmentProfileId),
    assignmentProfileNumber: text(item.assignmentProfileNumber),
    assignmentProfileTitle: text(item.assignmentProfileTitle),
    assignmentProfileDescription: text(item.assignmentProfileDescription),
    assignmentProfileStatus: text(item.assignmentProfileStatus),
    assignmentProfileStartDate: text(item.assignmentProfileStartDate),
    assignmentProfileEndDate: text(item.assignmentProfileEndDate),
    learningItemId: optionalId(item.learningItemId),
    learningItemNumber: text(item.learningItemNumber),
    learningItemTitle: text(item.learningItemTitle),
    learningItemType: text(item.learningItemType),
    assignmentType: text(item.assignmentType),
    assignmentSubType: text(item.assignmentSubType),
    targetAssignmentStatus: text(item.targetAssignmentStatus),
    assignmentRecordStatus: text(item.assignmentRecordStatus),
    assignmentDueDate: text(item.assignmentDueDate),
    assignmentDueDateType: text(item.assignmentDueDateType),
    processingRule: text(item.processingRule),
    processingFrequency: text(item.processingFrequency),
    processId: optionalId(item.processId),
    lastProcessedDate: text(item.lastProcessedDate),
    lastModifiedDate: text(item.lastModifiedDate),
  }
}

export const profileRecordFields = 'assignmentRecordId,assignmentRecordNumber,assignmentProfileId,assignmentProfileNumber,assignedToId,assignedToDisplayName,assignedOnDate,assignmentDueDate,assignmentStatus,assignmentStatusMeaning,assignmentType,assignmentProcessingStatus,assignmentProcessingStatusMeaning,learningItemId,reasonCodeMeaning'

export function projectAssignmentProfileRecord(value: unknown): Types.AssignmentProfileRecord {
  const item = record(value)
  return {
    assignmentRecordId: optionalId(item.assignmentRecordId),
    assignmentRecordNumber: text(item.assignmentRecordNumber),
    assignmentProfileId: optionalId(item.assignmentProfileId),
    assignmentProfileNumber: text(item.assignmentProfileNumber),
    assignedToId: optionalId(item.assignedToId),
    assignedToDisplayName: text(item.assignedToDisplayName),
    assignedOnDate: text(item.assignedOnDate),
    assignmentDueDate: text(item.assignmentDueDate),
    assignmentStatus: text(item.assignmentStatus),
    assignmentStatusMeaning: text(item.assignmentStatusMeaning),
    assignmentType: text(item.assignmentType),
    assignmentProcessingStatus: text(item.assignmentProcessingStatus),
    assignmentProcessingStatusMeaning: text(item.assignmentProcessingStatusMeaning),
    learningItemId: optionalId(item.learningItemId),
    reasonCodeMeaning: text(item.reasonCodeMeaning),
  }
}

export const criterionFields = 'assignmentProfileCriteriaId,assignmentProfileCriteriaType,assignmentProfileCriteriaTypeMeaning,assignmentProfileCriteriaTypeId,assignmentProfileCriteriaTypeNumber,assignmentProfileCriteriaSourceName,assignmentProfileCriteriaCount,assignmentProfileId,reportName'

export function projectAssignmentProfileCriterion(value: unknown): Types.AssignmentProfileCriterion {
  const item = record(value)
  return {
    assignmentProfileCriteriaId: id(item.assignmentProfileCriteriaId),
    assignmentProfileCriteriaType: text(item.assignmentProfileCriteriaType),
    assignmentProfileCriteriaTypeMeaning: text(item.assignmentProfileCriteriaTypeMeaning),
    assignmentProfileCriteriaTypeId: optionalId(item.assignmentProfileCriteriaTypeId),
    assignmentProfileCriteriaTypeNumber: text(item.assignmentProfileCriteriaTypeNumber),
    assignmentProfileCriteriaSourceName: text(item.assignmentProfileCriteriaSourceName),
    assignmentProfileCriteriaCount: number(item.assignmentProfileCriteriaCount),
    assignmentProfileId: optionalId(item.assignmentProfileId),
    reportName: text(item.reportName),
  }
}

export const audienceFields = 'learnRelationId,learnRelationNumber,learningItemId,learningItemNumber,learningItemType,sourceType,sourceTypeId,sourceTypeNumber,sourceTypeDisplayName,creationDate'

export function projectLearningItemAudience(value: unknown): Types.LearningItemAudience {
  const item = record(value)
  return {
    learnRelationId: id(item.learnRelationId),
    learnRelationNumber: text(item.learnRelationNumber),
    learningItemId: optionalId(item.learningItemId),
    learningItemNumber: text(item.learningItemNumber),
    learningItemType: text(item.learningItemType),
    sourceType: text(item.sourceType),
    sourceTypeId: optionalId(item.sourceTypeId),
    sourceTypeNumber: text(item.sourceTypeNumber),
    sourceTypeDisplayName: text(item.sourceTypeDisplayName),
    creationDate: text(item.creationDate),
  }
}

export const contentFields = 'ContentId,Title,Description,ItemNumber,TrackingType,URL,Status,IngestionStatus,ReplaceStatus,StartDate,EndDate'

export function projectContentItem(value: unknown): Types.ContentItem {
  const item = record(value)
  return {
    ContentId: id(item.ContentId),
    Title: text(item.Title),
    Description: text(item.Description),
    ItemNumber: text(item.ItemNumber),
    TrackingType: text(item.TrackingType),
    URL: text(item.URL),
    Status: text(item.Status),
    IngestionStatus: text(item.IngestionStatus),
    ReplaceStatus: text(item.ReplaceStatus),
    StartDate: text(item.StartDate),
    EndDate: text(item.EndDate),
  }
}
