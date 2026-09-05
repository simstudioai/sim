import { getValidationErrorMessage } from '@/lib/api/server'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import * as operations from '@/lib/internal/oracle-fusion-learning/operations'
import * as schemas from '@/lib/internal/oracle-fusion-learning/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import type { z } from 'zod'

async function execute<S extends z.ZodType>(schema: S, input: unknown, operation: (input: z.output<S>, signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal, mutation = false): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = schema.safeParse(input)
  if (!parsed.success) return Response.json({ success: false, error: getValidationErrorMessage(parsed.error, 'Invalid Oracle Fusion Learning request') }, { status: 400 })
  try {
    const result = await operation(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) return Response.json({ success: false, error: error.message, ...(mutation ? { retryable: false } : {}) }, { status: error.status })
    return Response.json({ success: false, error: 'Oracle Fusion Learning request failed', ...(mutation ? { retryable: false } : {}) }, { status: 500 })
  }
}

export const executeOracleFusionLearningTool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  switch (toolId) {
    case 'oracle_fusion_learning_list_self_paced_items':
      return execute(schemas.list_self_paced_itemsSchema, input, operations.executeListSelfPacedItems, signal)
    case 'oracle_fusion_learning_get_self_paced_item':
      return execute(schemas.get_self_paced_itemSchema, input, operations.executeGetSelfPacedItem, signal)
    case 'oracle_fusion_learning_create_self_paced_item':
      return execute(schemas.create_self_paced_itemSchema, input, operations.executeCreateSelfPacedItem, signal, true)
    case 'oracle_fusion_learning_update_self_paced_item':
      return execute(schemas.update_self_paced_itemSchema, input, operations.executeUpdateSelfPacedItem, signal, true)
    case 'oracle_fusion_learning_delete_self_paced_item':
      return execute(schemas.delete_self_paced_itemSchema, input, operations.executeDeleteSelfPacedItem, signal, true)
    case 'oracle_fusion_learning_list_learning_events':
      return execute(schemas.list_learning_eventsSchema, input, operations.executeListLearningEvents, signal)
    case 'oracle_fusion_learning_get_learning_event':
      return execute(schemas.get_learning_eventSchema, input, operations.executeGetLearningEvent, signal)
    case 'oracle_fusion_learning_create_learning_event':
      return execute(schemas.create_learning_eventSchema, input, operations.executeCreateLearningEvent, signal, true)
    case 'oracle_fusion_learning_update_learning_event':
      return execute(schemas.update_learning_eventSchema, input, operations.executeUpdateLearningEvent, signal, true)
    case 'oracle_fusion_learning_list_event_activities':
      return execute(schemas.list_event_activitiesSchema, input, operations.executeListEventActivities, signal)
    case 'oracle_fusion_learning_create_event_activity':
      return execute(schemas.create_event_activitySchema, input, operations.executeCreateEventActivity, signal, true)
    case 'oracle_fusion_learning_update_event_activity':
      return execute(schemas.update_event_activitySchema, input, operations.executeUpdateEventActivity, signal, true)
    case 'oracle_fusion_learning_delete_event_activity':
      return execute(schemas.delete_event_activitySchema, input, operations.executeDeleteEventActivity, signal, true)
    case 'oracle_fusion_learning_list_learning_records':
      return execute(schemas.list_learning_recordsSchema, input, operations.executeListLearningRecords, signal)
    case 'oracle_fusion_learning_get_learning_record':
      return execute(schemas.get_learning_recordSchema, input, operations.executeGetLearningRecord, signal)
    case 'oracle_fusion_learning_create_learning_record':
      return execute(schemas.create_learning_recordSchema, input, operations.executeCreateLearningRecord, signal, true)
    case 'oracle_fusion_learning_update_learning_record':
      return execute(schemas.update_learning_recordSchema, input, operations.executeUpdateLearningRecord, signal, true)
    case 'oracle_fusion_learning_list_selected_course_offerings':
      return execute(schemas.list_selected_course_offeringsSchema, input, operations.executeListSelectedCourseOfferings, signal)
    case 'oracle_fusion_learning_select_course_offering':
      return execute(schemas.select_course_offeringSchema, input, operations.executeSelectCourseOffering, signal, true)
    case 'oracle_fusion_learning_update_selected_course_offering':
      return execute(schemas.update_selected_course_offeringSchema, input, operations.executeUpdateSelectedCourseOffering, signal, true)
    case 'oracle_fusion_learning_list_completion_details':
      return execute(schemas.list_completion_detailsSchema, input, operations.executeListCompletionDetails, signal)
    case 'oracle_fusion_learning_update_completion_detail':
      return execute(schemas.update_completion_detailSchema, input, operations.executeUpdateCompletionDetail, signal, true)
    case 'oracle_fusion_learning_list_completion_summaries':
      return execute(schemas.list_completion_summariesSchema, input, operations.executeListCompletionSummaries, signal)
    case 'oracle_fusion_learning_list_learning_record_action_hints':
      return execute(schemas.list_learning_record_action_hintsSchema, input, operations.executeListLearningRecordActionHints, signal)
    case 'oracle_fusion_learning_list_enrollment_history':
      return execute(schemas.list_enrollment_historySchema, input, operations.executeListEnrollmentHistory, signal)
    case 'oracle_fusion_learning_list_assignment_profiles':
      return execute(schemas.list_assignment_profilesSchema, input, operations.executeListAssignmentProfiles, signal)
    case 'oracle_fusion_learning_get_assignment_profile':
      return execute(schemas.get_assignment_profileSchema, input, operations.executeGetAssignmentProfile, signal)
    case 'oracle_fusion_learning_create_assignment_profile':
      return execute(schemas.create_assignment_profileSchema, input, operations.executeCreateAssignmentProfile, signal, true)
    case 'oracle_fusion_learning_update_assignment_profile':
      return execute(schemas.update_assignment_profileSchema, input, operations.executeUpdateAssignmentProfile, signal, true)
    case 'oracle_fusion_learning_process_assignment_profile':
      return execute(schemas.process_assignment_profileSchema, input, operations.executeProcessAssignmentProfile, signal, true)
    case 'oracle_fusion_learning_list_assignment_profile_records':
      return execute(schemas.list_assignment_profile_recordsSchema, input, operations.executeListAssignmentProfileRecords, signal)
    case 'oracle_fusion_learning_list_assignment_profile_criteria':
      return execute(schemas.list_assignment_profile_criteriaSchema, input, operations.executeListAssignmentProfileCriteria, signal)
    case 'oracle_fusion_learning_add_assignment_profile_criterion':
      return execute(schemas.add_assignment_profile_criterionSchema, input, operations.executeAddAssignmentProfileCriterion, signal, true)
    case 'oracle_fusion_learning_remove_assignment_profile_criterion':
      return execute(schemas.remove_assignment_profile_criterionSchema, input, operations.executeRemoveAssignmentProfileCriterion, signal, true)
    case 'oracle_fusion_learning_list_learning_item_audiences':
      return execute(schemas.list_learning_item_audiencesSchema, input, operations.executeListLearningItemAudiences, signal)
    case 'oracle_fusion_learning_add_learning_item_audience':
      return execute(schemas.add_learning_item_audienceSchema, input, operations.executeAddLearningItemAudience, signal, true)
    case 'oracle_fusion_learning_remove_learning_item_audience':
      return execute(schemas.remove_learning_item_audienceSchema, input, operations.executeRemoveLearningItemAudience, signal, true)
    case 'oracle_fusion_learning_get_content_item':
      return execute(schemas.get_content_itemSchema, input, operations.executeGetContentItem, signal)
    case 'oracle_fusion_learning_create_web_link_content':
      return execute(schemas.create_web_link_contentSchema, input, operations.executeCreateWebLinkContent, signal, true)
    case 'oracle_fusion_learning_update_content_item':
      return execute(schemas.update_content_itemSchema, input, operations.executeUpdateContentItem, signal, true)
    default:
      return Response.json({ success: false, error: 'Unknown Oracle Fusion Learning operation' }, { status: 400 })
  }
}
