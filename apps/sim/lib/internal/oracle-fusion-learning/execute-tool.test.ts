/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeOracleFusionLearningTool } from '@/lib/internal/oracle-fusion-learning/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const mocks = vi.hoisted(() => ({
  executeListSelfPacedItems: vi.fn(),
  executeGetSelfPacedItem: vi.fn(),
  executeCreateSelfPacedItem: vi.fn(),
  executeUpdateSelfPacedItem: vi.fn(),
  executeDeleteSelfPacedItem: vi.fn(),
  executeListLearningEvents: vi.fn(),
  executeGetLearningEvent: vi.fn(),
  executeCreateLearningEvent: vi.fn(),
  executeUpdateLearningEvent: vi.fn(),
  executeListEventActivities: vi.fn(),
  executeCreateEventActivity: vi.fn(),
  executeUpdateEventActivity: vi.fn(),
  executeDeleteEventActivity: vi.fn(),
  executeListLearningRecords: vi.fn(),
  executeGetLearningRecord: vi.fn(),
  executeCreateLearningRecord: vi.fn(),
  executeUpdateLearningRecord: vi.fn(),
  executeListSelectedCourseOfferings: vi.fn(),
  executeSelectCourseOffering: vi.fn(),
  executeUpdateSelectedCourseOffering: vi.fn(),
  executeListCompletionDetails: vi.fn(),
  executeUpdateCompletionDetail: vi.fn(),
  executeListCompletionSummaries: vi.fn(),
  executeListLearningRecordActionHints: vi.fn(),
  executeListEnrollmentHistory: vi.fn(),
  executeListAssignmentProfiles: vi.fn(),
  executeGetAssignmentProfile: vi.fn(),
  executeCreateAssignmentProfile: vi.fn(),
  executeUpdateAssignmentProfile: vi.fn(),
  executeProcessAssignmentProfile: vi.fn(),
  executeListAssignmentProfileRecords: vi.fn(),
  executeListAssignmentProfileCriteria: vi.fn(),
  executeAddAssignmentProfileCriterion: vi.fn(),
  executeRemoveAssignmentProfileCriterion: vi.fn(),
  executeListLearningItemAudiences: vi.fn(),
  executeAddLearningItemAudience: vi.fn(),
  executeRemoveLearningItemAudience: vi.fn(),
  executeGetContentItem: vi.fn(),
  executeCreateWebLinkContent: vi.fn(),
  executeUpdateContentItem: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-fusion-learning/operations', () => mocks)

const auth = {
  instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
  accessToken: 'test-access-token',
}
function invoke(overrides: Partial<InternalToolOperationCall> = {}) {
  return executeOracleFusionLearningTool({
    toolId: 'oracle_fusion_learning_list_self_paced_items',
    input: auth,
    headers: new Headers(),
    context: { workflowId: 'workflow', workspaceId: 'workspace', userId: 'user' },
    requestId: 'request',
    ...overrides,
  })
}

describe('Learning operation dispatch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({ success: true, output: {} })
  })

  it.each([
    ['list_self_paced_items', 'executeListSelfPacedItems', {}],
    ['get_self_paced_item', 'executeGetSelfPacedItem', { learningItemId: '1' }],
    [
      'create_self_paced_item',
      'executeCreateSelfPacedItem',
      { body: { learningItemNumber: 'DRAFT-1', learningItemVisibility: 'TEST_VISIBILITY' } },
    ],
    [
      'update_self_paced_item',
      'executeUpdateSelfPacedItem',
      { learningItemId: '1', body: { learningItemDescription: null } },
    ],
    ['delete_self_paced_item', 'executeDeleteSelfPacedItem', { learningItemId: '1' }],
    ['list_learning_events', 'executeListLearningEvents', {}],
    ['get_learning_event', 'executeGetLearningEvent', { eventId: '1' }],
    [
      'create_learning_event',
      'executeCreateLearningEvent',
      { body: { learningItemNumber: 'EVENT-1', learningItemVisibility: 'TEST_VISIBILITY' } },
    ],
    [
      'update_learning_event',
      'executeUpdateLearningEvent',
      { eventId: '1', body: { learningItemDescription: null } },
    ],
    ['list_event_activities', 'executeListEventActivities', { eventId: '1' }],
    [
      'create_event_activity',
      'executeCreateEventActivity',
      { eventId: '1', body: { activityNumber: 'ACT-1', status: 'TEST_STATUS' } },
    ],
    [
      'update_event_activity',
      'executeUpdateEventActivity',
      { eventId: '1', activityId: '1', body: { description: null } },
    ],
    ['delete_event_activity', 'executeDeleteEventActivity', { eventId: '1', activityId: '1' }],
    ['list_learning_records', 'executeListLearningRecords', { personId: '1' }],
    ['get_learning_record', 'executeGetLearningRecord', { personId: '1', recordId: '1' }],
    [
      'create_learning_record',
      'executeCreateLearningRecord',
      { personId: '1', body: { learningItemId: '3' } },
    ],
    [
      'update_learning_record',
      'executeUpdateLearningRecord',
      { personId: '1', recordId: '1', body: { completedDate: null } },
    ],
    [
      'list_selected_course_offerings',
      'executeListSelectedCourseOfferings',
      { personId: '1', recordId: '1' },
    ],
    [
      'select_course_offering',
      'executeSelectCourseOffering',
      { personId: '1', recordId: '1', body: { learningItemId: '4' } },
    ],
    [
      'update_selected_course_offering',
      'executeUpdateSelectedCourseOffering',
      { personId: '1', recordId: '1', offeringRecordId: '1', body: { assignmentDueDate: null } },
    ],
    ['list_completion_details', 'executeListCompletionDetails', { personId: '1', recordId: '1' }],
    [
      'update_completion_detail',
      'executeUpdateCompletionDetail',
      {
        personId: '1',
        recordId: '1',
        completionDetailId: '1',
        body: { activityAttemptStatus: 'ORA_ASSN_TASK_COMPLETED' },
      },
    ],
    [
      'list_completion_summaries',
      'executeListCompletionSummaries',
      { personId: '1', recordId: '1' },
    ],
    [
      'list_learning_record_action_hints',
      'executeListLearningRecordActionHints',
      { personId: '1', recordId: '1' },
    ],
    ['list_enrollment_history', 'executeListEnrollmentHistory', { personId: '1', recordId: '1' }],
    ['list_assignment_profiles', 'executeListAssignmentProfiles', {}],
    ['get_assignment_profile', 'executeGetAssignmentProfile', {"profileId":"1"}],
    ['create_assignment_profile', 'executeCreateAssignmentProfile', {"body":{"assignmentProfileStatus":"TEST_STATUS","assignmentType":"ORA_REQUIRE_ASSIGNMENT","learningItemId":"3"}}],
    ['update_assignment_profile', 'executeUpdateAssignmentProfile', {"profileId":"1","body":{"completionComments":null}}],
    ['process_assignment_profile', 'executeProcessAssignmentProfile', {"profileId":"1"}],
    ['list_assignment_profile_records', 'executeListAssignmentProfileRecords', {"profileId":"1"}],
    ['list_assignment_profile_criteria', 'executeListAssignmentProfileCriteria', {"profileId":"1"}],
    ['add_assignment_profile_criterion', 'executeAddAssignmentProfileCriterion', {"profileId":"1","body":{"assignmentProfileCriteriaTypeId":"5"}}],
    ['remove_assignment_profile_criterion', 'executeRemoveAssignmentProfileCriterion', {"profileId":"1","criterionId":"1"}],
    ['list_learning_item_audiences', 'executeListLearningItemAudiences', {"learningItemId":"1"}],
    ['add_learning_item_audience', 'executeAddLearningItemAudience', {"learningItemId":"1","body":{"sourceType":"ORA_PERSON","sourceTypeId":"6","learningItemType":"TEST_TYPE"}}],
    ['remove_learning_item_audience', 'executeRemoveLearningItemAudience', {"learningItemId":"1","audienceId":"1"}],
    ['get_content_item', 'executeGetContentItem', {"contentId":"1"}],
    ['create_web_link_content', 'executeCreateWebLinkContent', {"body":{"Title":"Web course","URL":"https://example.com"}}],
    ['update_content_item', 'executeUpdateContentItem', {"contentId":"1","body":{"Description":null}}],
  ] as const)('dispatches %s through its product schema', async (operation, handler, input) => {
    const signal = new AbortController().signal
    const response = await invoke({ toolId: `oracle_fusion_learning_${operation}`, input: { ...auth, ...input }, signal })
    expect(response.status).toBe(200)
    expect(mocks[handler]).toHaveBeenCalledWith({ ...auth, ...input }, signal)
  })

  it('rejects unsupported fields before calling the mutation operation', async () => {
    const response = await invoke({ toolId: 'oracle_fusion_learning_update_completion_detail', input: {
      ...auth, personId: '1', recordId: '2', completionDetailId: '3', body: { completedDate: '2026-09-05' },
    } })
    expect(response.status).toBe(400)
    expect(mocks.executeUpdateCompletionDetail).not.toHaveBeenCalled()
  })

  it('propagates aborts rather than returning a successful or retryable result', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(invoke({ signal: controller.signal })).rejects.toThrow('cancelled')
    expect(mocks.executeListSelfPacedItems).not.toHaveBeenCalled()
  })

  it('marks an uncertain mutation failure as non-retryable for the shared executor', async () => {
    mocks.executeCreateWebLinkContent.mockRejectedValue(new Error('uncertain outcome'))
    const response = await invoke({
      toolId: 'oracle_fusion_learning_create_web_link_content',
      input: { ...auth, body: { Title: 'Course', URL: 'https://example.com' } },
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false, error: 'Oracle Fusion Learning request failed', retryable: false,
    })
    expect(mocks.executeCreateWebLinkContent).toHaveBeenCalledTimes(1)
  })

  it('returns a fixed error for unexpected failures', async () => {
    mocks.executeListSelfPacedItems.mockRejectedValue(new Error('private-provider-data'))
    const response = await invoke()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false, error: 'Oracle Fusion Learning request failed' })
  })
})
