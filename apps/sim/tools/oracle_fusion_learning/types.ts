import type { z } from 'zod'
import type * as Schemas from '@/lib/internal/oracle-fusion-learning/schema'
import type { ToolOutputProperty } from '@/tools/types'

export interface LearningPage<T> {
  items: T[]
  count: number
  hasMore: boolean
  limit: number
  offset: number
  totalResults?: number
  nextOffset?: number
}
export interface LearningResponse<T> { success: true; output: T }

export const ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES = {
  count: { type: 'number', description: 'Records returned in this page' },
  hasMore: { type: 'boolean', description: 'Oracle indicates another page is available' },
  limit: { type: 'number', description: 'Oracle page limit' },
  offset: { type: 'number', description: 'Current zero-based offset' },
  totalResults: { type: 'number', description: 'Estimated total, when returned', optional: true },
  nextOffset: { type: 'number', description: 'Next offset when hasMore is true', optional: true },
} satisfies Record<string, ToolOutputProperty>

export interface SelfPacedItem {
  learningItemId: string
  learningItemNumber: string | null
  learningItemTitle: string | null
  learningItemType: string | null
  learningItemStatus: string | null
  learningItemVisibility: string | null
  learningItemDescription: string | null
  learningItemCatalogProfileId: string | null
  learningItemCatalogProfileNumber: string | null
  learningItemExpectedEffortInSeconds: number | null
  learningItemPublishStartDate: string | null
  learningItemPublishEndDate: string | null
  learningItemEnrollmentStartDate: string | null
  learningItemEnrollmentEndDate: string | null
  learningItemLastModifiedDate: string | null
  learningItemActiveDate: string | null
  learningItemInactiveDate: string | null
  learningItemProvider: string | null
  learningItemProviderType: string | null
  learningItemDraftExists: string | null
  learningItemPublishedExists: string | null
}

export const ORACLE_FUSION_LEARNING_SELF_PACED_ITEM_OUTPUT_PROPERTIES = {
  learningItemId: { type: 'string', description: 'Learning Item Id' },
  learningItemNumber: { type: 'string', description: 'Learning Item Number', nullable: true },
  learningItemTitle: { type: 'string', description: 'Learning Item Title', nullable: true },
  learningItemType: { type: 'string', description: 'Learning Item Type', nullable: true },
  learningItemStatus: { type: 'string', description: 'Learning Item Status', nullable: true },
  learningItemVisibility: { type: 'string', description: 'Learning Item Visibility', nullable: true },
  learningItemDescription: { type: 'string', description: 'Learning Item Description', nullable: true },
  learningItemCatalogProfileId: { type: 'string', description: 'Learning Item Catalog Profile Id', nullable: true },
  learningItemCatalogProfileNumber: { type: 'string', description: 'Learning Item Catalog Profile Number', nullable: true },
  learningItemExpectedEffortInSeconds: { type: 'number', description: 'Learning Item Expected Effort In Seconds', nullable: true },
  learningItemPublishStartDate: { type: 'string', description: 'Learning Item Publish Start Date', nullable: true },
  learningItemPublishEndDate: { type: 'string', description: 'Learning Item Publish End Date', nullable: true },
  learningItemEnrollmentStartDate: { type: 'string', description: 'Learning Item Enrollment Start Date', nullable: true },
  learningItemEnrollmentEndDate: { type: 'string', description: 'Learning Item Enrollment End Date', nullable: true },
  learningItemLastModifiedDate: { type: 'string', description: 'Learning Item Last Modified Date', nullable: true },
  learningItemActiveDate: { type: 'string', description: 'Learning Item Active Date', nullable: true },
  learningItemInactiveDate: { type: 'string', description: 'Learning Item Inactive Date', nullable: true },
  learningItemProvider: { type: 'string', description: 'Learning Item Provider', nullable: true },
  learningItemProviderType: { type: 'string', description: 'Learning Item Provider Type', nullable: true },
  learningItemDraftExists: { type: 'string', description: 'Learning Item Draft Exists', nullable: true },
  learningItemPublishedExists: { type: 'string', description: 'Learning Item Published Exists', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface LearningEvent {
  learningItemId: string
  learningItemNumber: string | null
  learningItemTitle: string | null
  learningItemType: string | null
  learningItemStatus: string | null
  learningItemVisibility: string | null
  learningItemDescription: string | null
  learningItemCatalogProfileId: string | null
  learningItemCatalogProfileNumber: string | null
  learningItemExpectedEffortInSeconds: number | null
  learningItemPublishStartDate: string | null
  learningItemPublishEndDate: string | null
  learningItemEnrollmentStartDate: string | null
  learningItemEnrollmentEndDate: string | null
  learningItemLastModifiedDate: string | null
  eventStartDate: string | null
  eventEndDate: string | null
  eventTimezone: string | null
  eventCapacityEnabled: string | null
  eventCapacityMaximum: number | null
  eventCapacityMinimum: number | null
  eventWaitlistEnabled: string | null
  eventWaitlistMaximum: number | null
  eventClosedDate: string | null
  eventCancelDate: string | null
}

export const ORACLE_FUSION_LEARNING_LEARNING_EVENT_OUTPUT_PROPERTIES = {
  learningItemId: { type: 'string', description: 'Learning Item Id' },
  learningItemNumber: { type: 'string', description: 'Learning Item Number', nullable: true },
  learningItemTitle: { type: 'string', description: 'Learning Item Title', nullable: true },
  learningItemType: { type: 'string', description: 'Learning Item Type', nullable: true },
  learningItemStatus: { type: 'string', description: 'Learning Item Status', nullable: true },
  learningItemVisibility: { type: 'string', description: 'Learning Item Visibility', nullable: true },
  learningItemDescription: { type: 'string', description: 'Learning Item Description', nullable: true },
  learningItemCatalogProfileId: { type: 'string', description: 'Learning Item Catalog Profile Id', nullable: true },
  learningItemCatalogProfileNumber: { type: 'string', description: 'Learning Item Catalog Profile Number', nullable: true },
  learningItemExpectedEffortInSeconds: { type: 'number', description: 'Learning Item Expected Effort In Seconds', nullable: true },
  learningItemPublishStartDate: { type: 'string', description: 'Learning Item Publish Start Date', nullable: true },
  learningItemPublishEndDate: { type: 'string', description: 'Learning Item Publish End Date', nullable: true },
  learningItemEnrollmentStartDate: { type: 'string', description: 'Learning Item Enrollment Start Date', nullable: true },
  learningItemEnrollmentEndDate: { type: 'string', description: 'Learning Item Enrollment End Date', nullable: true },
  learningItemLastModifiedDate: { type: 'string', description: 'Learning Item Last Modified Date', nullable: true },
  eventStartDate: { type: 'string', description: 'Event Start Date', nullable: true },
  eventEndDate: { type: 'string', description: 'Event End Date', nullable: true },
  eventTimezone: { type: 'string', description: 'Event Timezone', nullable: true },
  eventCapacityEnabled: { type: 'string', description: 'Event Capacity Enabled', nullable: true },
  eventCapacityMaximum: { type: 'number', description: 'Event Capacity Maximum', nullable: true },
  eventCapacityMinimum: { type: 'number', description: 'Event Capacity Minimum', nullable: true },
  eventWaitlistEnabled: { type: 'string', description: 'Event Waitlist Enabled', nullable: true },
  eventWaitlistMaximum: { type: 'number', description: 'Event Waitlist Maximum', nullable: true },
  eventClosedDate: { type: 'string', description: 'Event Closed Date', nullable: true },
  eventCancelDate: { type: 'string', description: 'Event Cancel Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface EventActivity {
  activityId: string
  activityNumber: string | null
  activityType: string | null
  title: string | null
  description: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  timezone: string | null
  expectedEffortInSeconds: number | null
  completionRule: string | null
  completionType: string | null
  enableAttendanceProcessing: string | null
  minimumAttendance: number | null
  minimumAttendanceUOM: string | null
  instructors: string | null
  classrooms: string | null
  virtualClassroomURL: string | null
}

export const ORACLE_FUSION_LEARNING_EVENT_ACTIVITY_OUTPUT_PROPERTIES = {
  activityId: { type: 'string', description: 'Activity Id' },
  activityNumber: { type: 'string', description: 'Activity Number', nullable: true },
  activityType: { type: 'string', description: 'Activity Type', nullable: true },
  title: { type: 'string', description: 'Title', nullable: true },
  description: { type: 'string', description: 'Description', nullable: true },
  status: { type: 'string', description: 'Status', nullable: true },
  startDate: { type: 'string', description: 'Start Date', nullable: true },
  endDate: { type: 'string', description: 'End Date', nullable: true },
  timezone: { type: 'string', description: 'Timezone', nullable: true },
  expectedEffortInSeconds: { type: 'number', description: 'Expected Effort In Seconds', nullable: true },
  completionRule: { type: 'string', description: 'Completion Rule', nullable: true },
  completionType: { type: 'string', description: 'Completion Type', nullable: true },
  enableAttendanceProcessing: { type: 'string', description: 'Enable Attendance Processing', nullable: true },
  minimumAttendance: { type: 'number', description: 'Minimum Attendance', nullable: true },
  minimumAttendanceUOM: { type: 'string', description: 'Minimum Attendance U O M', nullable: true },
  instructors: { type: 'string', description: 'Instructors', nullable: true },
  classrooms: { type: 'string', description: 'Classrooms', nullable: true },
  virtualClassroomURL: { type: 'string', description: 'Virtual Classroom U R L', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface LearningRecord {
  assignmentRecordId: string
  assignmentRecordNumber: string | null
  assignedToId: string | null
  assignedToNumber: string | null
  assignedToDisplayName: string | null
  learningItemId: string | null
  learningItemNumber: string | null
  learningItemTitle: string | null
  learningItemType: string | null
  assignmentType: string | null
  assignmentStatus: string | null
  assignmentSubStatus: string | null
  assignmentDueDate: string | null
  assignedDate: string | null
  completedDate: string | null
  actualScore: number | null
  actualEffortInHours: number | null
  actualCpeUnits: number | null
  assignmentLastModifiedDate: string | null
}

export const ORACLE_FUSION_LEARNING_LEARNING_RECORD_OUTPUT_PROPERTIES = {
  assignmentRecordId: { type: 'string', description: 'Assignment Record Id' },
  assignmentRecordNumber: { type: 'string', description: 'Assignment Record Number', nullable: true },
  assignedToId: { type: 'string', description: 'Assigned To Id', nullable: true },
  assignedToNumber: { type: 'string', description: 'Assigned To Number', nullable: true },
  assignedToDisplayName: { type: 'string', description: 'Assigned To Display Name', nullable: true },
  learningItemId: { type: 'string', description: 'Learning Item Id', nullable: true },
  learningItemNumber: { type: 'string', description: 'Learning Item Number', nullable: true },
  learningItemTitle: { type: 'string', description: 'Learning Item Title', nullable: true },
  learningItemType: { type: 'string', description: 'Learning Item Type', nullable: true },
  assignmentType: { type: 'string', description: 'Assignment Type', nullable: true },
  assignmentStatus: { type: 'string', description: 'Assignment Status', nullable: true },
  assignmentSubStatus: { type: 'string', description: 'Assignment Sub Status', nullable: true },
  assignmentDueDate: { type: 'string', description: 'Assignment Due Date', nullable: true },
  assignedDate: { type: 'string', description: 'Assigned Date', nullable: true },
  completedDate: { type: 'string', description: 'Completed Date', nullable: true },
  actualScore: { type: 'number', description: 'Actual Score', nullable: true },
  actualEffortInHours: { type: 'number', description: 'Actual Effort In Hours', nullable: true },
  actualCpeUnits: { type: 'number', description: 'Actual Cpe Units', nullable: true },
  assignmentLastModifiedDate: { type: 'string', description: 'Assignment Last Modified Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface SelectedCourseOffering {
  assignmentRecordId: string
  assignmentRecordNumber: string | null
  learningItemId: string | null
  learningItemNumber: string | null
  learningItemTitle: string | null
  assignmentStatus: string | null
  assignmentSubStatus: string | null
  assignmentDueDate: string | null
  completedDate: string | null
  isPrimaryOffering: string | null
  offeringStartDate: string | null
  offeringEndDate: string | null
  offeringTimeZone: string | null
  offeringDeliveryMode: string | null
  maximumCapacity: number | null
  offeringAvailableCapacity: number | null
  currentWaitlistPosition: number | null
}

export const ORACLE_FUSION_LEARNING_SELECTED_COURSE_OFFERING_OUTPUT_PROPERTIES = {
  assignmentRecordId: { type: 'string', description: 'Assignment Record Id' },
  assignmentRecordNumber: { type: 'string', description: 'Assignment Record Number', nullable: true },
  learningItemId: { type: 'string', description: 'Learning Item Id', nullable: true },
  learningItemNumber: { type: 'string', description: 'Learning Item Number', nullable: true },
  learningItemTitle: { type: 'string', description: 'Learning Item Title', nullable: true },
  assignmentStatus: { type: 'string', description: 'Assignment Status', nullable: true },
  assignmentSubStatus: { type: 'string', description: 'Assignment Sub Status', nullable: true },
  assignmentDueDate: { type: 'string', description: 'Assignment Due Date', nullable: true },
  completedDate: { type: 'string', description: 'Completed Date', nullable: true },
  isPrimaryOffering: { type: 'string', description: 'Is Primary Offering', nullable: true },
  offeringStartDate: { type: 'string', description: 'Offering Start Date', nullable: true },
  offeringEndDate: { type: 'string', description: 'Offering End Date', nullable: true },
  offeringTimeZone: { type: 'string', description: 'Offering Time Zone', nullable: true },
  offeringDeliveryMode: { type: 'string', description: 'Offering Delivery Mode', nullable: true },
  maximumCapacity: { type: 'number', description: 'Maximum Capacity', nullable: true },
  offeringAvailableCapacity: { type: 'number', description: 'Offering Available Capacity', nullable: true },
  currentWaitlistPosition: { type: 'number', description: 'Current Waitlist Position', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface CompletionDetail {
  activityAssignmentRecordId: string
  activityAttemptId: string | null
  activityId: string | null
  activityNumber: string | null
  activityTitle: string | null
  activityType: string | null
  activityAttemptStatus: string | null
  activityAttemptActualScore: number | null
  activityAttemptActualEffort: number | null
  activityPassingScore: number | null
  activityAttemptLocked: string | null
  activityLearnerMarkCompl: string | null
  activityLearnerRecordAttendance: string | null
  activityStartDatetimeUTC: string | null
  activityEndDatetimeUTC: string | null
  activityTimeZone: string | null
  activityAttemptComplDate: string | null
}

export const ORACLE_FUSION_LEARNING_COMPLETION_DETAIL_OUTPUT_PROPERTIES = {
  activityAssignmentRecordId: { type: 'string', description: 'Activity Assignment Record Id' },
  activityAttemptId: { type: 'string', description: 'Activity Attempt Id', nullable: true },
  activityId: { type: 'string', description: 'Activity Id', nullable: true },
  activityNumber: { type: 'string', description: 'Activity Number', nullable: true },
  activityTitle: { type: 'string', description: 'Activity Title', nullable: true },
  activityType: { type: 'string', description: 'Activity Type', nullable: true },
  activityAttemptStatus: { type: 'string', description: 'Activity Attempt Status', nullable: true },
  activityAttemptActualScore: { type: 'number', description: 'Activity Attempt Actual Score', nullable: true },
  activityAttemptActualEffort: { type: 'number', description: 'Activity Attempt Actual Effort', nullable: true },
  activityPassingScore: { type: 'number', description: 'Activity Passing Score', nullable: true },
  activityAttemptLocked: { type: 'string', description: 'Activity Attempt Locked', nullable: true },
  activityLearnerMarkCompl: { type: 'string', description: 'Activity Learner Mark Compl', nullable: true },
  activityLearnerRecordAttendance: { type: 'string', description: 'Activity Learner Record Attendance', nullable: true },
  activityStartDatetimeUTC: { type: 'string', description: 'Activity Start Datetime U T C', nullable: true },
  activityEndDatetimeUTC: { type: 'string', description: 'Activity End Datetime U T C', nullable: true },
  activityTimeZone: { type: 'string', description: 'Activity Time Zone', nullable: true },
  activityAttemptComplDate: { type: 'string', description: 'Activity Attempt Compl Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface CompletionSummary {
  activitySectionsCount: number | null
  activitySectionsTotalActivitiesCount: number | null
  actualEffort: number | null
  actualScore: number | null
  completionProgress: number | null
  completionRequirement: number | null
  completionRequirementUnits: string | null
  completionRequirementUnitsMeaning: string | null
  effortUnits: string | null
  effortUnitsMeaning: string | null
  expectedEffort: string | null
  expectedEffortInSeconds: string | null
  passingScore: number | null
}

export const ORACLE_FUSION_LEARNING_COMPLETION_SUMMARY_OUTPUT_PROPERTIES = {
  activitySectionsCount: { type: 'number', description: 'Activity Sections Count', nullable: true },
  activitySectionsTotalActivitiesCount: { type: 'number', description: 'Activity Sections Total Activities Count', nullable: true },
  actualEffort: { type: 'number', description: 'Actual Effort', nullable: true },
  actualScore: { type: 'number', description: 'Actual Score', nullable: true },
  completionProgress: { type: 'number', description: 'Completion Progress', nullable: true },
  completionRequirement: { type: 'number', description: 'Completion Requirement', nullable: true },
  completionRequirementUnits: { type: 'string', description: 'Completion Requirement Units', nullable: true },
  completionRequirementUnitsMeaning: { type: 'string', description: 'Completion Requirement Units Meaning', nullable: true },
  effortUnits: { type: 'string', description: 'Effort Units', nullable: true },
  effortUnitsMeaning: { type: 'string', description: 'Effort Units Meaning', nullable: true },
  expectedEffort: { type: 'string', description: 'Expected Effort', nullable: true },
  expectedEffortInSeconds: { type: 'string', description: 'Expected Effort In Seconds', nullable: true },
  passingScore: { type: 'number', description: 'Passing Score', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface ActionHints {
  activityLearnerMarkCompl: string | null
  allowRetry: string | null
  canEditAssignmentHint: string | null
  canManageLearningItem: string | null
  canRecommendLearningItem: string | null
  canRetakeLearningItem: string | null
  dataSecurityPrivilege: string | null
  isWithdrawApprovalEnabled: string | null
  nextRetryDate: string | null
}

export const ORACLE_FUSION_LEARNING_ACTION_HINTS_OUTPUT_PROPERTIES = {
  activityLearnerMarkCompl: { type: 'string', description: 'Activity Learner Mark Compl', nullable: true },
  allowRetry: { type: 'string', description: 'Allow Retry', nullable: true },
  canEditAssignmentHint: { type: 'string', description: 'Can Edit Assignment Hint', nullable: true },
  canManageLearningItem: { type: 'string', description: 'Can Manage Learning Item', nullable: true },
  canRecommendLearningItem: { type: 'string', description: 'Can Recommend Learning Item', nullable: true },
  canRetakeLearningItem: { type: 'string', description: 'Can Retake Learning Item', nullable: true },
  dataSecurityPrivilege: { type: 'string', description: 'Data Security Privilege', nullable: true },
  isWithdrawApprovalEnabled: { type: 'string', description: 'Is Withdraw Approval Enabled', nullable: true },
  nextRetryDate: { type: 'string', description: 'Next Retry Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface EnrollmentHistory {
  enrollmentHistoryOrderId: number | null
  enrollmentHistoryStatusMessage: string | null
}

export const ORACLE_FUSION_LEARNING_ENROLLMENT_HISTORY_OUTPUT_PROPERTIES = {
  enrollmentHistoryOrderId: { type: 'number', description: 'Enrollment History Order Id', nullable: true },
  enrollmentHistoryStatusMessage: { type: 'string', description: 'Enrollment History Status Message', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface AssignmentProfile {
  assignmentProfileId: string
  assignmentProfileNumber: string | null
  assignmentProfileTitle: string | null
  assignmentProfileDescription: string | null
  assignmentProfileStatus: string | null
  assignmentProfileStartDate: string | null
  assignmentProfileEndDate: string | null
  learningItemId: string | null
  learningItemNumber: string | null
  learningItemTitle: string | null
  learningItemType: string | null
  assignmentType: string | null
  assignmentSubType: string | null
  targetAssignmentStatus: string | null
  assignmentRecordStatus: string | null
  assignmentDueDate: string | null
  assignmentDueDateType: string | null
  processingRule: string | null
  processingFrequency: string | null
  processId: string | null
  lastProcessedDate: string | null
  lastModifiedDate: string | null
}

export const ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_OUTPUT_PROPERTIES = {
  assignmentProfileId: { type: 'string', description: 'Assignment Profile Id' },
  assignmentProfileNumber: { type: 'string', description: 'Assignment Profile Number', nullable: true },
  assignmentProfileTitle: { type: 'string', description: 'Assignment Profile Title', nullable: true },
  assignmentProfileDescription: { type: 'string', description: 'Assignment Profile Description', nullable: true },
  assignmentProfileStatus: { type: 'string', description: 'Assignment Profile Status', nullable: true },
  assignmentProfileStartDate: { type: 'string', description: 'Assignment Profile Start Date', nullable: true },
  assignmentProfileEndDate: { type: 'string', description: 'Assignment Profile End Date', nullable: true },
  learningItemId: { type: 'string', description: 'Learning Item Id', nullable: true },
  learningItemNumber: { type: 'string', description: 'Learning Item Number', nullable: true },
  learningItemTitle: { type: 'string', description: 'Learning Item Title', nullable: true },
  learningItemType: { type: 'string', description: 'Learning Item Type', nullable: true },
  assignmentType: { type: 'string', description: 'Assignment Type', nullable: true },
  assignmentSubType: { type: 'string', description: 'Assignment Sub Type', nullable: true },
  targetAssignmentStatus: { type: 'string', description: 'Target Assignment Status', nullable: true },
  assignmentRecordStatus: { type: 'string', description: 'Assignment Record Status', nullable: true },
  assignmentDueDate: { type: 'string', description: 'Assignment Due Date', nullable: true },
  assignmentDueDateType: { type: 'string', description: 'Assignment Due Date Type', nullable: true },
  processingRule: { type: 'string', description: 'Processing Rule', nullable: true },
  processingFrequency: { type: 'string', description: 'Processing Frequency', nullable: true },
  processId: { type: 'string', description: 'Process Id', nullable: true },
  lastProcessedDate: { type: 'string', description: 'Last Processed Date', nullable: true },
  lastModifiedDate: { type: 'string', description: 'Last Modified Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface AssignmentProfileRecord {
  assignmentRecordId: string | null
  assignmentRecordNumber: string | null
  assignmentProfileId: string | null
  assignmentProfileNumber: string | null
  assignedToId: string | null
  assignedToDisplayName: string | null
  assignedOnDate: string | null
  assignmentDueDate: string | null
  assignmentStatus: string | null
  assignmentStatusMeaning: string | null
  assignmentType: string | null
  assignmentProcessingStatus: string | null
  assignmentProcessingStatusMeaning: string | null
  learningItemId: string | null
  reasonCodeMeaning: string | null
}

export const ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_RECORD_OUTPUT_PROPERTIES = {
  assignmentRecordId: { type: 'string', description: 'Assignment Record Id', nullable: true },
  assignmentRecordNumber: { type: 'string', description: 'Assignment Record Number', nullable: true },
  assignmentProfileId: { type: 'string', description: 'Assignment Profile Id', nullable: true },
  assignmentProfileNumber: { type: 'string', description: 'Assignment Profile Number', nullable: true },
  assignedToId: { type: 'string', description: 'Assigned To Id', nullable: true },
  assignedToDisplayName: { type: 'string', description: 'Assigned To Display Name', nullable: true },
  assignedOnDate: { type: 'string', description: 'Assigned On Date', nullable: true },
  assignmentDueDate: { type: 'string', description: 'Assignment Due Date', nullable: true },
  assignmentStatus: { type: 'string', description: 'Assignment Status', nullable: true },
  assignmentStatusMeaning: { type: 'string', description: 'Assignment Status Meaning', nullable: true },
  assignmentType: { type: 'string', description: 'Assignment Type', nullable: true },
  assignmentProcessingStatus: { type: 'string', description: 'Assignment Processing Status', nullable: true },
  assignmentProcessingStatusMeaning: { type: 'string', description: 'Assignment Processing Status Meaning', nullable: true },
  learningItemId: { type: 'string', description: 'Learning Item Id', nullable: true },
  reasonCodeMeaning: { type: 'string', description: 'Reason Code Meaning', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface AssignmentProfileCriterion {
  assignmentProfileCriteriaId: string
  assignmentProfileCriteriaType: string | null
  assignmentProfileCriteriaTypeMeaning: string | null
  assignmentProfileCriteriaTypeId: string | null
  assignmentProfileCriteriaTypeNumber: string | null
  assignmentProfileCriteriaSourceName: string | null
  assignmentProfileCriteriaCount: number | null
  assignmentProfileId: string | null
  reportName: string | null
}

export const ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_CRITERION_OUTPUT_PROPERTIES = {
  assignmentProfileCriteriaId: { type: 'string', description: 'Assignment Profile Criteria Id' },
  assignmentProfileCriteriaType: { type: 'string', description: 'Assignment Profile Criteria Type', nullable: true },
  assignmentProfileCriteriaTypeMeaning: { type: 'string', description: 'Assignment Profile Criteria Type Meaning', nullable: true },
  assignmentProfileCriteriaTypeId: { type: 'string', description: 'Assignment Profile Criteria Type Id', nullable: true },
  assignmentProfileCriteriaTypeNumber: { type: 'string', description: 'Assignment Profile Criteria Type Number', nullable: true },
  assignmentProfileCriteriaSourceName: { type: 'string', description: 'Assignment Profile Criteria Source Name', nullable: true },
  assignmentProfileCriteriaCount: { type: 'number', description: 'Assignment Profile Criteria Count', nullable: true },
  assignmentProfileId: { type: 'string', description: 'Assignment Profile Id', nullable: true },
  reportName: { type: 'string', description: 'Report Name', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface LearningItemAudience {
  learnRelationId: string
  learnRelationNumber: string | null
  learningItemId: string | null
  learningItemNumber: string | null
  learningItemType: string | null
  sourceType: string | null
  sourceTypeId: string | null
  sourceTypeNumber: string | null
  sourceTypeDisplayName: string | null
  creationDate: string | null
}

export const ORACLE_FUSION_LEARNING_LEARNING_ITEM_AUDIENCE_OUTPUT_PROPERTIES = {
  learnRelationId: { type: 'string', description: 'Learn Relation Id' },
  learnRelationNumber: { type: 'string', description: 'Learn Relation Number', nullable: true },
  learningItemId: { type: 'string', description: 'Learning Item Id', nullable: true },
  learningItemNumber: { type: 'string', description: 'Learning Item Number', nullable: true },
  learningItemType: { type: 'string', description: 'Learning Item Type', nullable: true },
  sourceType: { type: 'string', description: 'Source Type', nullable: true },
  sourceTypeId: { type: 'string', description: 'Source Type Id', nullable: true },
  sourceTypeNumber: { type: 'string', description: 'Source Type Number', nullable: true },
  sourceTypeDisplayName: { type: 'string', description: 'Source Type Display Name', nullable: true },
  creationDate: { type: 'string', description: 'Creation Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export interface ContentItem {
  ContentId: string
  Title: string | null
  Description: string | null
  ItemNumber: string | null
  TrackingType: string | null
  URL: string | null
  Status: string | null
  IngestionStatus: string | null
  ReplaceStatus: string | null
  StartDate: string | null
  EndDate: string | null
}

export const ORACLE_FUSION_LEARNING_CONTENT_ITEM_OUTPUT_PROPERTIES = {
  ContentId: { type: 'string', description: 'Content Id' },
  Title: { type: 'string', description: 'Title', nullable: true },
  Description: { type: 'string', description: 'Description', nullable: true },
  ItemNumber: { type: 'string', description: 'Item Number', nullable: true },
  TrackingType: { type: 'string', description: 'Tracking Type', nullable: true },
  URL: { type: 'string', description: 'U R L', nullable: true },
  Status: { type: 'string', description: 'Status', nullable: true },
  IngestionStatus: { type: 'string', description: 'Ingestion Status', nullable: true },
  ReplaceStatus: { type: 'string', description: 'Replace Status', nullable: true },
  StartDate: { type: 'string', description: 'Start Date', nullable: true },
  EndDate: { type: 'string', description: 'End Date', nullable: true },
} satisfies Record<string, ToolOutputProperty>

export type ListSelfPacedItemsParams = Omit<z.input<typeof Schemas.list_self_paced_itemsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListSelfPacedItemsResponse = LearningResponse<LearningPage<SelfPacedItem>>

export const ORACLE_FUSION_LEARNING_LIST_SELF_PACED_ITEMS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_SELF_PACED_ITEM_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type GetSelfPacedItemParams = Omit<z.input<typeof Schemas.get_self_paced_itemSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type GetSelfPacedItemResponse = LearningResponse<{ item: SelfPacedItem }>

export const ORACLE_FUSION_LEARNING_GET_SELF_PACED_ITEM_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_SELF_PACED_ITEM_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type CreateSelfPacedItemParams = Omit<z.input<typeof Schemas.create_self_paced_itemSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.selfPostSchema> | string
}
export type CreateSelfPacedItemResponse = LearningResponse<{ item: SelfPacedItem }>

export const ORACLE_FUSION_LEARNING_CREATE_SELF_PACED_ITEM_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_SELF_PACED_ITEM_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateSelfPacedItemParams = Omit<z.input<typeof Schemas.update_self_paced_itemSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.selfPatchSchema> | string
}
export type UpdateSelfPacedItemResponse = LearningResponse<{ item: SelfPacedItem }>

export const ORACLE_FUSION_LEARNING_UPDATE_SELF_PACED_ITEM_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_SELF_PACED_ITEM_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type DeleteSelfPacedItemParams = Omit<z.input<typeof Schemas.delete_self_paced_itemSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type DeleteSelfPacedItemResponse = LearningResponse<{ deleted: true }>

export const ORACLE_FUSION_LEARNING_DELETE_SELF_PACED_ITEM_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Oracle accepted the bodyless deletion' },
} satisfies Record<string, ToolOutputProperty>

export type ListLearningEventsParams = Omit<z.input<typeof Schemas.list_learning_eventsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListLearningEventsResponse = LearningResponse<LearningPage<LearningEvent>>

export const ORACLE_FUSION_LEARNING_LIST_LEARNING_EVENTS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_LEARNING_EVENT_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type GetLearningEventParams = Omit<z.input<typeof Schemas.get_learning_eventSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type GetLearningEventResponse = LearningResponse<{ item: LearningEvent }>

export const ORACLE_FUSION_LEARNING_GET_LEARNING_EVENT_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_EVENT_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type CreateLearningEventParams = Omit<z.input<typeof Schemas.create_learning_eventSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.eventPostSchema> | string
}
export type CreateLearningEventResponse = LearningResponse<{ item: LearningEvent }>

export const ORACLE_FUSION_LEARNING_CREATE_LEARNING_EVENT_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_EVENT_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateLearningEventParams = Omit<z.input<typeof Schemas.update_learning_eventSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.eventPatchSchema> | string
}
export type UpdateLearningEventResponse = LearningResponse<{ item: LearningEvent }>

export const ORACLE_FUSION_LEARNING_UPDATE_LEARNING_EVENT_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_EVENT_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type ListEventActivitiesParams = Omit<z.input<typeof Schemas.list_event_activitiesSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListEventActivitiesResponse = LearningResponse<LearningPage<EventActivity>>

export const ORACLE_FUSION_LEARNING_LIST_EVENT_ACTIVITIES_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_EVENT_ACTIVITY_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type CreateEventActivityParams = Omit<z.input<typeof Schemas.create_event_activitySchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.activityPostSchema> | string
}
export type CreateEventActivityResponse = LearningResponse<{ item: EventActivity }>

export const ORACLE_FUSION_LEARNING_CREATE_EVENT_ACTIVITY_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_EVENT_ACTIVITY_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateEventActivityParams = Omit<z.input<typeof Schemas.update_event_activitySchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.activityPatchSchema> | string
}
export type UpdateEventActivityResponse = LearningResponse<{ item: EventActivity }>

export const ORACLE_FUSION_LEARNING_UPDATE_EVENT_ACTIVITY_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_EVENT_ACTIVITY_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type DeleteEventActivityParams = Omit<z.input<typeof Schemas.delete_event_activitySchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type DeleteEventActivityResponse = LearningResponse<{ deleted: true }>

export const ORACLE_FUSION_LEARNING_DELETE_EVENT_ACTIVITY_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Oracle accepted the bodyless deletion' },
} satisfies Record<string, ToolOutputProperty>

export type ListLearningRecordsParams = Omit<z.input<typeof Schemas.list_learning_recordsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListLearningRecordsResponse = LearningResponse<LearningPage<LearningRecord>>

export const ORACLE_FUSION_LEARNING_LIST_LEARNING_RECORDS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_LEARNING_RECORD_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type GetLearningRecordParams = Omit<z.input<typeof Schemas.get_learning_recordSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type GetLearningRecordResponse = LearningResponse<{ item: LearningRecord }>

export const ORACLE_FUSION_LEARNING_GET_LEARNING_RECORD_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_RECORD_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type CreateLearningRecordParams = Omit<z.input<typeof Schemas.create_learning_recordSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.recordPostSchema> | string
}
export type CreateLearningRecordResponse = LearningResponse<{ item: LearningRecord }>

export const ORACLE_FUSION_LEARNING_CREATE_LEARNING_RECORD_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_RECORD_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateLearningRecordParams = Omit<z.input<typeof Schemas.update_learning_recordSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.recordPatchSchema> | string
}
export type UpdateLearningRecordResponse = LearningResponse<{ item: LearningRecord }>

export const ORACLE_FUSION_LEARNING_UPDATE_LEARNING_RECORD_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_RECORD_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type ListSelectedCourseOfferingsParams = Omit<z.input<typeof Schemas.list_selected_course_offeringsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListSelectedCourseOfferingsResponse = LearningResponse<LearningPage<SelectedCourseOffering>>

export const ORACLE_FUSION_LEARNING_LIST_SELECTED_COURSE_OFFERINGS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_SELECTED_COURSE_OFFERING_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type SelectCourseOfferingParams = Omit<z.input<typeof Schemas.select_course_offeringSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.offeringPostSchema> | string
}
export type SelectCourseOfferingResponse = LearningResponse<{ item: SelectedCourseOffering }>

export const ORACLE_FUSION_LEARNING_SELECT_COURSE_OFFERING_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_SELECTED_COURSE_OFFERING_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateSelectedCourseOfferingParams = Omit<z.input<typeof Schemas.update_selected_course_offeringSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.offeringPatchSchema> | string
}
export type UpdateSelectedCourseOfferingResponse = LearningResponse<{ item: SelectedCourseOffering }>

export const ORACLE_FUSION_LEARNING_UPDATE_SELECTED_COURSE_OFFERING_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_SELECTED_COURSE_OFFERING_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type ListCompletionDetailsParams = Omit<z.input<typeof Schemas.list_completion_detailsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListCompletionDetailsResponse = LearningResponse<LearningPage<CompletionDetail>>

export const ORACLE_FUSION_LEARNING_LIST_COMPLETION_DETAILS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_COMPLETION_DETAIL_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type UpdateCompletionDetailParams = Omit<z.input<typeof Schemas.update_completion_detailSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.completionPatchSchema> | string
}
export type UpdateCompletionDetailResponse = LearningResponse<{ item: CompletionDetail }>

export const ORACLE_FUSION_LEARNING_UPDATE_COMPLETION_DETAIL_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_COMPLETION_DETAIL_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type ListCompletionSummariesParams = Omit<z.input<typeof Schemas.list_completion_summariesSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListCompletionSummariesResponse = LearningResponse<LearningPage<CompletionSummary>>

export const ORACLE_FUSION_LEARNING_LIST_COMPLETION_SUMMARIES_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_COMPLETION_SUMMARY_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type ListLearningRecordActionHintsParams = Omit<z.input<typeof Schemas.list_learning_record_action_hintsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListLearningRecordActionHintsResponse = LearningResponse<LearningPage<ActionHints>>

export const ORACLE_FUSION_LEARNING_LIST_LEARNING_RECORD_ACTION_HINTS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_ACTION_HINTS_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type ListEnrollmentHistoryParams = Omit<z.input<typeof Schemas.list_enrollment_historySchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListEnrollmentHistoryResponse = LearningResponse<LearningPage<EnrollmentHistory>>

export const ORACLE_FUSION_LEARNING_LIST_ENROLLMENT_HISTORY_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_ENROLLMENT_HISTORY_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type ListAssignmentProfilesParams = Omit<z.input<typeof Schemas.list_assignment_profilesSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListAssignmentProfilesResponse = LearningResponse<LearningPage<AssignmentProfile>>

export const ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILES_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type GetAssignmentProfileParams = Omit<z.input<typeof Schemas.get_assignment_profileSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type GetAssignmentProfileResponse = LearningResponse<{ item: AssignmentProfile }>

export const ORACLE_FUSION_LEARNING_GET_ASSIGNMENT_PROFILE_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type CreateAssignmentProfileParams = Omit<z.input<typeof Schemas.create_assignment_profileSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.profilePostSchema> | string
}
export type CreateAssignmentProfileResponse = LearningResponse<{ item: AssignmentProfile }>

export const ORACLE_FUSION_LEARNING_CREATE_ASSIGNMENT_PROFILE_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateAssignmentProfileParams = Omit<z.input<typeof Schemas.update_assignment_profileSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.profilePatchSchema> | string
}
export type UpdateAssignmentProfileResponse = LearningResponse<{ item: AssignmentProfile }>

export const ORACLE_FUSION_LEARNING_UPDATE_ASSIGNMENT_PROFILE_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type ProcessAssignmentProfileParams = Omit<z.input<typeof Schemas.process_assignment_profileSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ProcessAssignmentProfileResponse = LearningResponse<{ result: number }>

export const ORACLE_FUSION_LEARNING_PROCESS_ASSIGNMENT_PROFILE_OUTPUTS = {
  result: { type: 'number', description: 'Numeric processing acknowledgement; not a verified job ID' },
} satisfies Record<string, ToolOutputProperty>

export type ListAssignmentProfileRecordsParams = Omit<z.input<typeof Schemas.list_assignment_profile_recordsSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListAssignmentProfileRecordsResponse = LearningResponse<LearningPage<AssignmentProfileRecord>>

export const ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILE_RECORDS_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_RECORD_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type ListAssignmentProfileCriteriaParams = Omit<z.input<typeof Schemas.list_assignment_profile_criteriaSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListAssignmentProfileCriteriaResponse = LearningResponse<LearningPage<AssignmentProfileCriterion>>

export const ORACLE_FUSION_LEARNING_LIST_ASSIGNMENT_PROFILE_CRITERIA_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_CRITERION_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type AddAssignmentProfileCriterionParams = Omit<z.input<typeof Schemas.add_assignment_profile_criterionSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.criterionPostSchema> | string
}
export type AddAssignmentProfileCriterionResponse = LearningResponse<{ item: AssignmentProfileCriterion }>

export const ORACLE_FUSION_LEARNING_ADD_ASSIGNMENT_PROFILE_CRITERION_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_ASSIGNMENT_PROFILE_CRITERION_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type RemoveAssignmentProfileCriterionParams = Omit<z.input<typeof Schemas.remove_assignment_profile_criterionSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type RemoveAssignmentProfileCriterionResponse = LearningResponse<{ deleted: true }>

export const ORACLE_FUSION_LEARNING_REMOVE_ASSIGNMENT_PROFILE_CRITERION_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Oracle accepted the bodyless deletion' },
} satisfies Record<string, ToolOutputProperty>

export type ListLearningItemAudiencesParams = Omit<z.input<typeof Schemas.list_learning_item_audiencesSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type ListLearningItemAudiencesResponse = LearningResponse<LearningPage<LearningItemAudience>>

export const ORACLE_FUSION_LEARNING_LIST_LEARNING_ITEM_AUDIENCES_OUTPUTS = {
  items: { type: 'array', description: 'Requested page of Learning records', items: { type: 'object', properties: ORACLE_FUSION_LEARNING_LEARNING_ITEM_AUDIENCE_OUTPUT_PROPERTIES } },
  ...ORACLE_FUSION_LEARNING_PAGINATION_OUTPUT_PROPERTIES,
} satisfies Record<string, ToolOutputProperty>

export type AddLearningItemAudienceParams = Omit<z.input<typeof Schemas.add_learning_item_audienceSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.audiencePostSchema> | string
}
export type AddLearningItemAudienceResponse = LearningResponse<{ item: LearningItemAudience }>

export const ORACLE_FUSION_LEARNING_ADD_LEARNING_ITEM_AUDIENCE_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_LEARNING_ITEM_AUDIENCE_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type RemoveLearningItemAudienceParams = Omit<z.input<typeof Schemas.remove_learning_item_audienceSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type RemoveLearningItemAudienceResponse = LearningResponse<{ deleted: true }>

export const ORACLE_FUSION_LEARNING_REMOVE_LEARNING_ITEM_AUDIENCE_OUTPUTS = {
  deleted: { type: 'boolean', description: 'Oracle accepted the bodyless deletion' },
} satisfies Record<string, ToolOutputProperty>

export type GetContentItemParams = Omit<z.input<typeof Schemas.get_content_itemSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}
export type GetContentItemResponse = LearningResponse<{ item: ContentItem }>

export const ORACLE_FUSION_LEARNING_GET_CONTENT_ITEM_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_CONTENT_ITEM_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type CreateWebLinkContentParams = Omit<z.input<typeof Schemas.create_web_link_contentSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.contentPostSchema> | string
}
export type CreateWebLinkContentResponse = LearningResponse<{ item: ContentItem }>

export const ORACLE_FUSION_LEARNING_CREATE_WEB_LINK_CONTENT_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_CONTENT_ITEM_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>

export type UpdateContentItemParams = Omit<z.input<typeof Schemas.update_content_itemSchema>, 'accessToken' | 'instanceUrl'> & {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
  body: z.input<typeof Schemas.contentPatchSchema> | string
}
export type UpdateContentItemResponse = LearningResponse<{ item: ContentItem }>

export const ORACLE_FUSION_LEARNING_UPDATE_CONTENT_ITEM_OUTPUTS = {
  item: { type: 'object', description: 'Safe Learning resource projection', properties: ORACLE_FUSION_LEARNING_CONTENT_ITEM_OUTPUT_PROPERTIES },
} satisfies Record<string, ToolOutputProperty>
