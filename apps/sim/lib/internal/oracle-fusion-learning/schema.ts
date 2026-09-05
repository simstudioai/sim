import { z } from 'zod'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'

export const decimalIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, 'ID must be a positive decimal string')
  .max(19)
  .refine(
    (value) =>
      value.length <= 19 && /^[1-9]\d*$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    'ID exceeds int64 range'
  )

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'Date must be a valid calendar date')
const timestampSchema = z.string().datetime({ offset: true })
const baseSchema = z.object({
  instanceUrl: z.string().trim().min(1).max(2048),
  accessToken: z.string().min(1).max(4096),
})

function jsonBody<S extends z.ZodType>(schema: S) {
  return z.preprocess((value, context) => {
    if (typeof value !== 'string') return value
    if (
      value.length > MAX_INLINE_MATERIALIZATION_BYTES ||
      new TextEncoder().encode(value).byteLength > MAX_INLINE_MATERIALIZATION_BYTES
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Learning writable fields exceed the inline payload limit',
      })
      return z.NEVER
    }
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }, schema)
}

/** Oracle: op-learningselfpaceditems-post.html. Nested uploads and read-only fields are excluded. */
export const selfPostSchema = z
  .object({
    learningItemNumber: z.string().max(2000),
    learningItemTitle: z.string().max(255).nullable().optional(),
    learningItemType: z.string().max(30).nullable().optional(),
    learningItemStatus: z.string().max(30).optional(),
    learningItemVisibility: z.string().max(32),
    learningItemDescription: z.string().max(4000).nullable().optional(),
    learningItemLongDescription: z.string().max(100000).nullable().optional(),
    learningItemShortDescription: z.string().max(100000).nullable().optional(),
    learningItemCatalogProfileId: decimalIdSchema.nullable().optional(),
    learningItemCatalogProfileNumber: z.string().max(100000).nullable().optional(),
    learningItemExpectedEffortInSeconds: z.number().finite().nullable().optional(),
    learningItemPublishStartDate: timestampSchema.nullable().optional(),
    learningItemPublishEndDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentStartDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentEndDate: timestampSchema.nullable().optional(),
    learningItemActiveDate: timestampSchema.nullable().optional(),
    learningItemInactiveDate: timestampSchema.nullable().optional(),
    learningItemInactiveReasonCode: z.string().max(30).nullable().optional(),
    learningItemStatusComment: z.string().max(4000).nullable().optional(),
    learningItemKeepCompletionsOnDelete: z.string().max(100000).nullable().optional(),
    learningItemProvider: z.string().max(32).nullable().optional(),
    learningItemProviderType: z.string().max(32).nullable().optional(),
  })
  .strict()

/** Oracle: op-learningselfpaceditems-learningselfpaceditemsuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const selfPatchSchema = z
  .object({
    learningItemNumber: z.string().max(2000).optional(),
    learningItemTitle: z.string().max(255).nullable().optional(),
    learningItemType: z.string().max(30).nullable().optional(),
    learningItemStatus: z.string().max(30).optional(),
    learningItemVisibility: z.string().max(32).optional(),
    learningItemDescription: z.string().max(4000).nullable().optional(),
    learningItemLongDescription: z.string().max(100000).nullable().optional(),
    learningItemShortDescription: z.string().max(100000).nullable().optional(),
    learningItemCatalogProfileId: decimalIdSchema.nullable().optional(),
    learningItemCatalogProfileNumber: z.string().max(100000).nullable().optional(),
    learningItemExpectedEffortInSeconds: z.number().finite().nullable().optional(),
    learningItemPublishStartDate: timestampSchema.nullable().optional(),
    learningItemPublishEndDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentStartDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentEndDate: timestampSchema.nullable().optional(),
    learningItemActiveDate: timestampSchema.nullable().optional(),
    learningItemInactiveDate: timestampSchema.nullable().optional(),
    learningItemInactiveReasonCode: z.string().max(30).nullable().optional(),
    learningItemStatusComment: z.string().max(4000).nullable().optional(),
    learningItemKeepCompletionsOnDelete: z.string().max(100000).nullable().optional(),
    learningItemProvider: z.string().max(32).nullable().optional(),
    learningItemProviderType: z.string().max(32).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learningevents-post.html. Nested uploads and read-only fields are excluded. */
export const eventPostSchema = z
  .object({
    learningItemNumber: z.string().max(2000),
    learningItemTitle: z.string().max(250).nullable().optional(),
    learningItemType: z.string().max(30).nullable().optional(),
    learningItemStatus: z.string().max(30).optional(),
    learningItemVisibility: z.string().max(32),
    learningItemDescription: z.string().max(4000).nullable().optional(),
    learningItemLongDescription: z.string().max(100000).nullable().optional(),
    learningItemCatalogProfileId: decimalIdSchema.nullable().optional(),
    learningItemCatalogProfileNumber: z.string().max(100000).nullable().optional(),
    learningItemPublishStartDate: timestampSchema.nullable().optional(),
    learningItemPublishEndDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentStartDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentEndDate: timestampSchema.nullable().optional(),
    learningItemStatusComment: z.string().max(4000).nullable().optional(),
    eventStartDate: z.string().max(255).nullable().optional(),
    eventEndDate: z.string().max(255).nullable().optional(),
    eventTimezone: z.string().max(30).nullable().optional(),
    eventCapacityEnabled: z.string().max(30).nullable().optional(),
    eventCapacityMaximum: z.number().int().safe().nullable().optional(),
    eventCapacityMinimum: z.number().int().safe().nullable().optional(),
    eventWaitlistEnabled: z.string().max(30).nullable().optional(),
    eventWaitlistMaximumEnabled: z.string().max(30).nullable().optional(),
    eventWaitlistMaximum: z.number().int().safe().nullable().optional(),
    eventCancelDate: timestampSchema.nullable().optional(),
    eventCancelReasonCode: z.string().max(30).nullable().optional(),
    eventClosedDate: timestampSchema.nullable().optional(),
    eventClosedReasonCode: z.string().max(30).nullable().optional(),
    eventClosedActivityStatus: z.string().max(30).nullable().optional(),
  })
  .strict()

/** Oracle: op-learningevents-learningeventsuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const eventPatchSchema = z
  .object({
    learningItemNumber: z.string().max(2000).optional(),
    learningItemTitle: z.string().max(250).nullable().optional(),
    learningItemType: z.string().max(30).nullable().optional(),
    learningItemStatus: z.string().max(30).optional(),
    learningItemVisibility: z.string().max(32).optional(),
    learningItemDescription: z.string().max(4000).nullable().optional(),
    learningItemLongDescription: z.string().max(100000).nullable().optional(),
    learningItemCatalogProfileId: decimalIdSchema.nullable().optional(),
    learningItemCatalogProfileNumber: z.string().max(100000).nullable().optional(),
    learningItemPublishStartDate: timestampSchema.nullable().optional(),
    learningItemPublishEndDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentStartDate: timestampSchema.nullable().optional(),
    learningItemEnrollmentEndDate: timestampSchema.nullable().optional(),
    learningItemStatusComment: z.string().max(4000).nullable().optional(),
    eventStartDate: z.string().max(255).nullable().optional(),
    eventEndDate: z.string().max(255).nullable().optional(),
    eventTimezone: z.string().max(30).nullable().optional(),
    eventCapacityEnabled: z.string().max(30).nullable().optional(),
    eventCapacityMaximum: z.number().int().safe().nullable().optional(),
    eventCapacityMinimum: z.number().int().safe().nullable().optional(),
    eventWaitlistEnabled: z.string().max(30).nullable().optional(),
    eventWaitlistMaximumEnabled: z.string().max(30).nullable().optional(),
    eventWaitlistMaximum: z.number().int().safe().nullable().optional(),
    eventCancelDate: timestampSchema.nullable().optional(),
    eventCancelReasonCode: z.string().max(30).nullable().optional(),
    eventClosedDate: timestampSchema.nullable().optional(),
    eventClosedReasonCode: z.string().max(30).nullable().optional(),
    eventClosedActivityStatus: z.string().max(30).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learningevents-learningeventsuniqid-child-activities-post.html. Nested uploads and read-only fields are excluded. */
export const activityPostSchema = z
  .object({
    activityNumber: z.string().max(2000),
    activityType: z.string().max(30).nullable().optional(),
    title: z.string().max(250).nullable().optional(),
    description: z.string().max(100000).nullable().optional(),
    status: z.string().max(30),
    startDate: z.string().max(100000).nullable().optional(),
    endDate: z.string().max(100000).nullable().optional(),
    timezone: z.string().max(30).nullable().optional(),
    expectedEffortInSeconds: z.number().finite().nullable().optional(),
    completionRule: z.string().max(30).nullable().optional(),
    completionType: z.string().max(30).nullable().optional(),
    enableAttendanceProcessing: z.string().max(1).nullable().optional(),
    minimumAttendance: z.number().int().safe().nullable().optional(),
    minimumAttendanceUOM: z.string().max(30).nullable().optional(),
    learnerNoMinimumAttendanceStatus: z.string().max(30).nullable().optional(),
    learnerNotAttendStatus: z.string().max(30).nullable().optional(),
    instructors: z.string().max(100000).nullable().optional(),
    classrooms: z.string().max(100000).nullable().optional(),
    providerType: z.string().max(32).nullable().optional(),
    onlineMeetingType: z.string().max(30).nullable().optional(),
    virtualClassroomURL: z.string().max(500).nullable().optional(),
  })
  .strict()

/** Oracle: op-learningevents-learningeventsuniqid-child-activities-activitiesuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const activityPatchSchema = z
  .object({
    activityNumber: z.string().max(2000).optional(),
    activityType: z.string().max(30).nullable().optional(),
    title: z.string().max(250).nullable().optional(),
    description: z.string().max(100000).nullable().optional(),
    status: z.string().max(30).optional(),
    startDate: z.string().max(100000).nullable().optional(),
    endDate: z.string().max(100000).nullable().optional(),
    timezone: z.string().max(30).nullable().optional(),
    expectedEffortInSeconds: z.number().finite().nullable().optional(),
    completionRule: z.string().max(30).nullable().optional(),
    completionType: z.string().max(30).nullable().optional(),
    enableAttendanceProcessing: z.string().max(1).nullable().optional(),
    minimumAttendance: z.number().int().safe().nullable().optional(),
    minimumAttendanceUOM: z.string().max(30).nullable().optional(),
    learnerNoMinimumAttendanceStatus: z.string().max(30).nullable().optional(),
    learnerNotAttendStatus: z.string().max(30).nullable().optional(),
    instructors: z.string().max(100000).nullable().optional(),
    classrooms: z.string().max(100000).nullable().optional(),
    providerType: z.string().max(32).nullable().optional(),
    onlineMeetingType: z.string().max(30).nullable().optional(),
    virtualClassroomURL: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learnerlearningrecords-post.html. Nested uploads and read-only fields are excluded. */
export const recordPostSchema = z
  .object({
    learningItemId: decimalIdSchema,
    learningItemNumber: z.string().max(30).nullable().optional(),
    learningItemType: z.string().max(32).nullable().optional(),
    assignmentType: z.string().max(30).nullable().optional(),
    assignmentStatus: z.string().max(32).optional(),
    assignmentSubStatus: z.string().max(30).nullable().optional(),
    assignmentDueDate: timestampSchema.nullable().optional(),
    assignedDate: timestampSchema.nullable().optional(),
    completedDate: timestampSchema.nullable().optional(),
    actualScore: z.number().finite().nullable().optional(),
    actualEffortInHours: z.number().finite().nullable().optional(),
    actualCpeUnits: z.number().finite().nullable().optional(),
    assignmentJustification: z.string().max(4000).nullable().optional(),
    reasonCode: z.string().max(30).nullable().optional(),
    statusChangeComment: z.string().max(4000).nullable().optional(),
    dataSecurityPrivilege: z.string().max(32).nullable().optional(),
  })
  .strict()

/** Oracle: op-learnerlearningrecords-learnerlearningrecordsuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const recordPatchSchema = z
  .object({
    learningItemNumber: z.string().max(30).nullable().optional(),
    assignmentType: z.string().max(30).nullable().optional(),
    assignmentStatus: z.string().max(32).optional(),
    assignmentSubStatus: z.string().max(30).nullable().optional(),
    assignmentDueDate: timestampSchema.nullable().optional(),
    assignedDate: timestampSchema.nullable().optional(),
    completedDate: timestampSchema.nullable().optional(),
    actualScore: z.number().finite().nullable().optional(),
    actualEffortInHours: z.number().finite().nullable().optional(),
    actualCpeUnits: z.number().finite().nullable().optional(),
    assignmentJustification: z.string().max(4000).nullable().optional(),
    reasonCode: z.string().max(30).nullable().optional(),
    statusChangeComment: z.string().max(4000).nullable().optional(),
    dataSecurityPrivilege: z.string().max(32).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learnerlearningrecords-learnerlearningrecordsuniqid-child-selectedcourseofferings-post.html. Nested uploads and read-only fields are excluded. */
export const offeringPostSchema = z
  .object({
    learningItemId: decimalIdSchema,
    learningItemNumber: z.string().max(255).nullable().optional(),
    learningItemType: z.string().max(32).nullable().optional(),
    assignmentType: z.string().max(30).nullable().optional(),
    assignmentStatus: z.string().max(32).optional(),
    assignmentDueDate: timestampSchema.nullable().optional(),
    assignmentJustification: z.string().max(4000).nullable().optional(),
    reasonCode: z.string().max(30).nullable().optional(),
    statusChangeComment: z.string().max(4000).nullable().optional(),
    dataSecurityPrivilege: z.string().max(32).nullable().optional(),
  })
  .strict()

/** Oracle: op-learnerlearningrecords-learnerlearningrecordsuniqid-child-selectedcourseofferings-otherselectedcourseofferingsuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const offeringPatchSchema = z
  .object({
    learningItemType: z.string().max(32).nullable().optional(),
    assignmentType: z.string().max(30).nullable().optional(),
    assignmentStatus: z.string().max(32).optional(),
    assignmentDueDate: timestampSchema.nullable().optional(),
    assignmentJustification: z.string().max(4000).nullable().optional(),
    reasonCode: z.string().max(30).nullable().optional(),
    statusChangeComment: z.string().max(4000).nullable().optional(),
    dataSecurityPrivilege: z.string().max(32).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learnerlearningrecords-learnerlearningrecordsuniqid-child-completiondetails-completiondetailsuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const completionPatchSchema = z
  .object({
    activityAttemptStatus: z.string().max(32).nullable().optional(),
    activityAttemptCompletionReasonCode: z.string().max(30).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learningassignmentprofiles-post.html. Nested uploads and read-only fields are excluded. */
export const profilePostSchema = z
  .object({
    assignmentProfileNumber: z.string().max(30).nullable().optional(),
    assignmentProfileTitle: z.string().max(250).nullable().optional(),
    assignmentProfileDescription: z.string().max(4000).nullable().optional(),
    assignmentProfileStatus: z.string().max(30),
    assignmentProfileStartDate: dateSchema.nullable().optional(),
    assignmentProfileEndDate: timestampSchema.nullable().optional(),
    learningItemId: decimalIdSchema,
    learningItemNumber: z.string().max(100000).nullable().optional(),
    learningItemType: z.string().max(100000).nullable().optional(),
    assignmentType: z.string().max(30),
    assignmentSubType: z.string().max(30).nullable().optional(),
    targetAssignmentStatus: z.string().max(30).nullable().optional(),
    assignmentRecordStatus: z.string().max(30).nullable().optional(),
    assignmentDueDate: timestampSchema.nullable().optional(),
    assignmentDueDateType: z.string().max(30).nullable().optional(),
    assignmentDueIn: z.number().finite().nullable().optional(),
    assignmentDueInUnits: z.string().max(255).nullable().optional(),
    processingRule: z.string().max(1).optional(),
    processingFrequency: z.string().max(30).nullable().optional(),
    assignmentCompletionDate: timestampSchema.nullable().optional(),
    assignmentActualScore: z.number().finite().nullable().optional(),
    assignmentActualEffort: z.number().finite().nullable().optional(),
    completionReasonCode: z.string().max(30).nullable().optional(),
    completionComments: z.string().max(4000).nullable().optional(),
    waivePrerequisites: z.string().max(1).nullable().optional(),
    waiveReasonCode: z.string().max(30).nullable().optional(),
    waiveComments: z.string().max(4000).nullable().optional(),
    increaseMaximumCapacity: z.string().max(64).nullable().optional(),
    withdrawOnProcessing: z.string().max(30).nullable().optional(),
    excludeEnrollmentFromHistory: z.string().max(1).nullable().optional(),
    enableRenewals: z.string().max(255).nullable().optional(),
    retakeRule: z.string().max(30).nullable().optional(),
    dataSecurityPrivilege: z.string().max(100000).nullable().optional(),
  })
  .strict()

/** Oracle: op-learningassignmentprofiles-learningassignmentprofilesuniqid-patch.html. Nested uploads and read-only fields are excluded. */
export const profilePatchSchema = z
  .object({
    assignmentProfileTitle: z.string().max(250).nullable().optional(),
    assignmentProfileDescription: z.string().max(4000).nullable().optional(),
    assignmentProfileStatus: z.string().max(30).optional(),
    assignmentProfileStartDate: dateSchema.nullable().optional(),
    assignmentProfileEndDate: timestampSchema.nullable().optional(),
    learningItemNumber: z.string().max(100000).nullable().optional(),
    learningItemType: z.string().max(100000).nullable().optional(),
    assignmentType: z.string().max(30).optional(),
    assignmentSubType: z.string().max(30).nullable().optional(),
    targetAssignmentStatus: z.string().max(30).nullable().optional(),
    assignmentRecordStatus: z.string().max(30).nullable().optional(),
    assignmentDueDate: timestampSchema.nullable().optional(),
    assignmentDueDateType: z.string().max(30).nullable().optional(),
    assignmentDueIn: z.number().finite().nullable().optional(),
    assignmentDueInUnits: z.string().max(255).nullable().optional(),
    processingRule: z.string().max(1).optional(),
    processingFrequency: z.string().max(30).nullable().optional(),
    assignmentCompletionDate: timestampSchema.nullable().optional(),
    assignmentActualScore: z.number().finite().nullable().optional(),
    assignmentActualEffort: z.number().finite().nullable().optional(),
    completionReasonCode: z.string().max(30).nullable().optional(),
    completionComments: z.string().max(4000).nullable().optional(),
    waivePrerequisites: z.string().max(1).nullable().optional(),
    waiveReasonCode: z.string().max(30).nullable().optional(),
    waiveComments: z.string().max(4000).nullable().optional(),
    increaseMaximumCapacity: z.string().max(64).nullable().optional(),
    withdrawOnProcessing: z.string().max(30).nullable().optional(),
    excludeEnrollmentFromHistory: z.string().max(1).nullable().optional(),
    enableRenewals: z.string().max(255).nullable().optional(),
    retakeRule: z.string().max(30).nullable().optional(),
    dataSecurityPrivilege: z.string().max(100000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

/** Oracle: op-learningassignmentprofiles-learningassignmentprofilesuniqid-child-learningassignmentprofilecriteria-post.html. Nested uploads and read-only fields are excluded. */
export const criterionPostSchema = z
  .object({
    assignmentProfileCriteriaType: z.string().max(30).nullable().optional(),
    assignmentProfileCriteriaTypeId: decimalIdSchema,
    assignmentProfileCriteriaTypeNumber: z.string().max(255).nullable().optional(),
    reportName: z.string().max(255).nullable().optional(),
  })
  .strict()

/** Oracle: op-learningitemaudiences-post.html. Nested uploads and read-only fields are excluded. */
export const audiencePostSchema = z
  .object({
    learningItemNumber: z.string().max(255).nullable().optional(),
    learningItemType: z.string().max(30),
    sourceType: z.enum(['ORA_PERSON', 'ORA_LEARNING_ORGANIZATION']),
    sourceTypeId: decimalIdSchema,
    sourceTypeNumber: z.string().max(255).nullable().optional(),
    learnRelationNumber: z.string().max(30).optional(),
  })
  .strict()

/** Oracle: op-learningcontentitems-post.html. Nested uploads and read-only fields are excluded. */
export const contentPostSchema = z
  .object({
    Title: z.string().max(100000),
    Description: z.string().max(100000).nullable().optional(),
    ItemNumber: z.string().max(100000).nullable().optional(),
    URL: z
      .string()
      .url()
      .max(4096)
      .refine(
        (value) => ['https:', 'http:'].includes(new URL(value).protocol),
        'URL must use HTTP or HTTPS'
      ),
    Status: z.string().max(100000).nullable().optional(),
    StartDate: dateSchema.nullable().optional(),
    EndDate: dateSchema.nullable().optional(),
  })
  .strict()

/** Oracle: op-learningcontentitems-contentid-patch.html. Nested uploads and read-only fields are excluded. */
export const contentPatchSchema = z
  .object({
    Title: z.string().max(100000).nullable().optional(),
    Description: z.string().max(100000).nullable().optional(),
    ItemNumber: z.string().max(100000).nullable().optional(),
    URL: z
      .string()
      .url()
      .max(4096)
      .refine(
        (value) => ['https:', 'http:'].includes(new URL(value).protocol),
        'URL must use HTTP or HTTPS'
      )
      .nullable()
      .optional(),
    Status: z.string().max(100000).nullable().optional(),
    StartDate: dateSchema.nullable().optional(),
    EndDate: dateSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one writable field')

export const list_self_paced_itemsSchema = baseSchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  effectiveDate: dateSchema.optional(),
})
export type ListSelfPacedItemsInput = z.output<typeof list_self_paced_itemsSchema>

export const get_self_paced_itemSchema = baseSchema.extend({
  learningItemId: decimalIdSchema,
  effectiveDate: dateSchema.optional(),
})
export type GetSelfPacedItemInput = z.output<typeof get_self_paced_itemSchema>

export const create_self_paced_itemSchema = baseSchema.extend({
  body: jsonBody(selfPostSchema),
})
export type CreateSelfPacedItemInput = z.output<typeof create_self_paced_itemSchema>

export const update_self_paced_itemSchema = baseSchema.extend({
  learningItemId: decimalIdSchema,
  body: jsonBody(selfPatchSchema),
})
export type UpdateSelfPacedItemInput = z.output<typeof update_self_paced_itemSchema>

export const delete_self_paced_itemSchema = baseSchema.extend({
  learningItemId: decimalIdSchema,
})
export type DeleteSelfPacedItemInput = z.output<typeof delete_self_paced_itemSchema>

export const list_learning_eventsSchema = baseSchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  effectiveDate: dateSchema.optional(),
})
export type ListLearningEventsInput = z.output<typeof list_learning_eventsSchema>

export const get_learning_eventSchema = baseSchema.extend({
  eventId: decimalIdSchema,
  effectiveDate: dateSchema.optional(),
})
export type GetLearningEventInput = z.output<typeof get_learning_eventSchema>

export const create_learning_eventSchema = baseSchema.extend({
  body: jsonBody(eventPostSchema),
})
export type CreateLearningEventInput = z.output<typeof create_learning_eventSchema>

export const update_learning_eventSchema = baseSchema.extend({
  eventId: decimalIdSchema,
  body: jsonBody(eventPatchSchema),
})
export type UpdateLearningEventInput = z.output<typeof update_learning_eventSchema>

export const list_event_activitiesSchema = baseSchema.extend({
  eventId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  effectiveDate: dateSchema.optional(),
})
export type ListEventActivitiesInput = z.output<typeof list_event_activitiesSchema>

export const create_event_activitySchema = baseSchema.extend({
  eventId: decimalIdSchema,
  body: jsonBody(activityPostSchema),
})
export type CreateEventActivityInput = z.output<typeof create_event_activitySchema>

export const update_event_activitySchema = baseSchema.extend({
  eventId: decimalIdSchema,
  activityId: decimalIdSchema,
  body: jsonBody(activityPatchSchema),
})
export type UpdateEventActivityInput = z.output<typeof update_event_activitySchema>

export const delete_event_activitySchema = baseSchema.extend({
  eventId: decimalIdSchema,
  activityId: decimalIdSchema,
})
export type DeleteEventActivityInput = z.output<typeof delete_event_activitySchema>

export const list_learning_recordsSchema = baseSchema.extend({
  personId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  effectiveDate: dateSchema.optional(),
  assignmentStatus: z.string().trim().min(1).max(32).optional(),
  learningItemId: decimalIdSchema.optional(),
})
export type ListLearningRecordsInput = z.output<typeof list_learning_recordsSchema>

export const get_learning_recordSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  effectiveDate: dateSchema.optional(),
})
export type GetLearningRecordInput = z.output<typeof get_learning_recordSchema>

export const create_learning_recordSchema = baseSchema.extend({
  personId: decimalIdSchema,
  body: jsonBody(recordPostSchema),
})
export type CreateLearningRecordInput = z.output<typeof create_learning_recordSchema>

export const update_learning_recordSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  body: jsonBody(recordPatchSchema),
})
export type UpdateLearningRecordInput = z.output<typeof update_learning_recordSchema>

export const list_selected_course_offeringsSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  effectiveDate: dateSchema.optional(),
  assignmentStatus: z.string().trim().min(1).max(32).optional(),
})
export type ListSelectedCourseOfferingsInput = z.output<typeof list_selected_course_offeringsSchema>

export const select_course_offeringSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  body: jsonBody(offeringPostSchema),
})
export type SelectCourseOfferingInput = z.output<typeof select_course_offeringSchema>

export const update_selected_course_offeringSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  offeringRecordId: decimalIdSchema,
  body: jsonBody(offeringPatchSchema),
})
export type UpdateSelectedCourseOfferingInput = z.output<
  typeof update_selected_course_offeringSchema
>

export const list_completion_detailsSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  effectiveDate: dateSchema.optional(),
  offeringRecordId: decimalIdSchema.optional(),
})
export type ListCompletionDetailsInput = z.output<typeof list_completion_detailsSchema>

export const update_completion_detailSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  completionDetailId: decimalIdSchema,
  offeringRecordId: z.never().optional(),
  body: jsonBody(completionPatchSchema),
})
export type UpdateCompletionDetailInput = z.output<typeof update_completion_detailSchema>

export const list_completion_summariesSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  effectiveDate: dateSchema.optional(),
  offeringRecordId: decimalIdSchema.optional(),
})
export type ListCompletionSummariesInput = z.output<typeof list_completion_summariesSchema>

export const list_learning_record_action_hintsSchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  effectiveDate: dateSchema.optional(),
  offeringRecordId: decimalIdSchema.optional(),
})
export type ListLearningRecordActionHintsInput = z.output<
  typeof list_learning_record_action_hintsSchema
>

export const list_enrollment_historySchema = baseSchema.extend({
  personId: decimalIdSchema,
  recordId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  effectiveDate: dateSchema.optional(),
  offeringRecordId: decimalIdSchema.optional(),
})
export type ListEnrollmentHistoryInput = z.output<typeof list_enrollment_historySchema>

export const list_assignment_profilesSchema = baseSchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  effectiveDate: dateSchema.optional(),
})
export type ListAssignmentProfilesInput = z.output<typeof list_assignment_profilesSchema>

export const get_assignment_profileSchema = baseSchema.extend({
  profileId: decimalIdSchema,
  effectiveDate: dateSchema.optional(),
})
export type GetAssignmentProfileInput = z.output<typeof get_assignment_profileSchema>

export const create_assignment_profileSchema = baseSchema.extend({
  body: jsonBody(profilePostSchema),
})
export type CreateAssignmentProfileInput = z.output<typeof create_assignment_profileSchema>

export const update_assignment_profileSchema = baseSchema.extend({
  profileId: decimalIdSchema,
  body: jsonBody(profilePatchSchema),
})
export type UpdateAssignmentProfileInput = z.output<typeof update_assignment_profileSchema>

export const process_assignment_profileSchema = baseSchema.extend({
  profileId: decimalIdSchema,
})
export type ProcessAssignmentProfileInput = z.output<typeof process_assignment_profileSchema>

export const list_assignment_profile_recordsSchema = baseSchema.extend({
  profileId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  effectiveDate: dateSchema.optional(),
})
export type ListAssignmentProfileRecordsInput = z.output<
  typeof list_assignment_profile_recordsSchema
>

export const list_assignment_profile_criteriaSchema = baseSchema.extend({
  profileId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  effectiveDate: dateSchema.optional(),
})
export type ListAssignmentProfileCriteriaInput = z.output<
  typeof list_assignment_profile_criteriaSchema
>

export const add_assignment_profile_criterionSchema = baseSchema.extend({
  profileId: decimalIdSchema,
  body: jsonBody(criterionPostSchema),
})
export type AddAssignmentProfileCriterionInput = z.output<
  typeof add_assignment_profile_criterionSchema
>

export const remove_assignment_profile_criterionSchema = baseSchema.extend({
  profileId: decimalIdSchema,
  criterionId: decimalIdSchema,
})
export type RemoveAssignmentProfileCriterionInput = z.output<
  typeof remove_assignment_profile_criterionSchema
>

export const list_learning_item_audiencesSchema = baseSchema.extend({
  learningItemId: decimalIdSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
})
export type ListLearningItemAudiencesInput = z.output<typeof list_learning_item_audiencesSchema>

export const add_learning_item_audienceSchema = baseSchema.extend({
  learningItemId: decimalIdSchema,
  body: jsonBody(audiencePostSchema),
})
export type AddLearningItemAudienceInput = z.output<typeof add_learning_item_audienceSchema>

export const remove_learning_item_audienceSchema = baseSchema.extend({
  learningItemId: decimalIdSchema,
  audienceId: decimalIdSchema,
})
export type RemoveLearningItemAudienceInput = z.output<typeof remove_learning_item_audienceSchema>

export const get_content_itemSchema = baseSchema.extend({
  contentId: decimalIdSchema,
})
export type GetContentItemInput = z.output<typeof get_content_itemSchema>

export const create_web_link_contentSchema = baseSchema.extend({
  body: jsonBody(contentPostSchema),
})
export type CreateWebLinkContentInput = z.output<typeof create_web_link_contentSchema>

export const update_content_itemSchema = baseSchema.extend({
  contentId: decimalIdSchema,
  body: jsonBody(contentPatchSchema),
})
export type UpdateContentItemInput = z.output<typeof update_content_itemSchema>
