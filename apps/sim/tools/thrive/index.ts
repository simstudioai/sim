import { addAudienceManagersTool } from '@/tools/thrive/add_audience_managers'
import { addAudienceMembersTool } from '@/tools/thrive/add_audience_members'
import { addUserTagsTool } from '@/tools/thrive/add_user_tags'
import { createAssignmentTool } from '@/tools/thrive/create_assignment'
import { createAudienceTool } from '@/tools/thrive/create_audience'
import { createCompletionTool } from '@/tools/thrive/create_completion'
import { createUserTool } from '@/tools/thrive/create_user'
import { deleteAssignmentTool } from '@/tools/thrive/delete_assignment'
import { deleteAudienceTool } from '@/tools/thrive/delete_audience'
import { deleteUserTool } from '@/tools/thrive/delete_user'
import { getActivityTool } from '@/tools/thrive/get_activity'
import { getAssignmentTool } from '@/tools/thrive/get_assignment'
import { getAudienceTool } from '@/tools/thrive/get_audience'
import { getCompletionTool } from '@/tools/thrive/get_completion'
import { getContentTool } from '@/tools/thrive/get_content'
import { getCpdCategoryTool } from '@/tools/thrive/get_cpd_category'
import { getCpdEntryTool } from '@/tools/thrive/get_cpd_entry'
import { getCpdRequirementTool } from '@/tools/thrive/get_cpd_requirement'
import { getEnrolmentTool } from '@/tools/thrive/get_enrolment'
import { getSkillLevelsTool } from '@/tools/thrive/get_skill_levels'
import { getTagTool } from '@/tools/thrive/get_tag'
import { getUserByIdTool } from '@/tools/thrive/get_user_by_id'
import { getUserByRefTool } from '@/tools/thrive/get_user_by_ref'
import { listAssignmentsTool } from '@/tools/thrive/list_assignments'
import { listAudienceManagersTool } from '@/tools/thrive/list_audience_managers'
import { listAudienceMembersTool } from '@/tools/thrive/list_audience_members'
import { listAudiencesTool } from '@/tools/thrive/list_audiences'
import { listCompletionsTool } from '@/tools/thrive/list_completions'
import { listEnrolmentsTool } from '@/tools/thrive/list_enrolments'
import { listTagsTool } from '@/tools/thrive/list_tags'
import { queryActivitiesTool } from '@/tools/thrive/query_activities'
import { queryContentTool } from '@/tools/thrive/query_content'
import { queryCpdCategoriesTool } from '@/tools/thrive/query_cpd_categories'
import { queryCpdEntriesTool } from '@/tools/thrive/query_cpd_entries'
import { queryCpdRequirementsTool } from '@/tools/thrive/query_cpd_requirements'
import { queryCpdUserSummariesTool } from '@/tools/thrive/query_cpd_user_summaries'
import { removeAudienceManagerTool } from '@/tools/thrive/remove_audience_manager'
import { removeAudienceMemberTool } from '@/tools/thrive/remove_audience_member'
import { removeUserTagsTool } from '@/tools/thrive/remove_user_tags'
import { replaceAudienceManagersTool } from '@/tools/thrive/replace_audience_managers'
import { replaceAudienceMembersTool } from '@/tools/thrive/replace_audience_members'
import { searchUsersTool } from '@/tools/thrive/search_users'
import { suspendUserTool } from '@/tools/thrive/suspend_user'
import { updateAssignmentTool } from '@/tools/thrive/update_assignment'
import { updateAudienceTool } from '@/tools/thrive/update_audience'
import { updateUserTool } from '@/tools/thrive/update_user'
import { updateUserSkillsTool } from '@/tools/thrive/update_user_skills'

export const thriveCreateUserTool = createUserTool
export const thriveUpdateUserTool = updateUserTool
export const thriveDeleteUserTool = deleteUserTool
export const thriveSuspendUserTool = suspendUserTool
export const thriveSearchUsersTool = searchUsersTool
export const thriveGetUserByIdTool = getUserByIdTool
export const thriveGetUserByRefTool = getUserByRefTool

export const thriveListAudiencesTool = listAudiencesTool
export const thriveCreateAudienceTool = createAudienceTool
export const thriveGetAudienceTool = getAudienceTool
export const thriveUpdateAudienceTool = updateAudienceTool
export const thriveDeleteAudienceTool = deleteAudienceTool
export const thriveListAudienceMembersTool = listAudienceMembersTool
export const thriveAddAudienceMembersTool = addAudienceMembersTool
export const thriveReplaceAudienceMembersTool = replaceAudienceMembersTool
export const thriveRemoveAudienceMemberTool = removeAudienceMemberTool
export const thriveListAudienceManagersTool = listAudienceManagersTool
export const thriveAddAudienceManagersTool = addAudienceManagersTool
export const thriveReplaceAudienceManagersTool = replaceAudienceManagersTool
export const thriveRemoveAudienceManagerTool = removeAudienceManagerTool

export const thriveListAssignmentsTool = listAssignmentsTool
export const thriveCreateAssignmentTool = createAssignmentTool
export const thriveGetAssignmentTool = getAssignmentTool
export const thriveUpdateAssignmentTool = updateAssignmentTool
export const thriveDeleteAssignmentTool = deleteAssignmentTool
export const thriveListEnrolmentsTool = listEnrolmentsTool
export const thriveGetEnrolmentTool = getEnrolmentTool

export const thriveListCompletionsTool = listCompletionsTool
export const thriveGetCompletionTool = getCompletionTool
export const thriveCreateCompletionTool = createCompletionTool

export const thriveGetContentTool = getContentTool
export const thriveQueryContentTool = queryContentTool

export const thriveGetActivityTool = getActivityTool
export const thriveQueryActivitiesTool = queryActivitiesTool

export const thriveGetCpdCategoryTool = getCpdCategoryTool
export const thriveQueryCpdCategoriesTool = queryCpdCategoriesTool
export const thriveGetCpdEntryTool = getCpdEntryTool
export const thriveQueryCpdEntriesTool = queryCpdEntriesTool
export const thriveGetCpdRequirementTool = getCpdRequirementTool
export const thriveQueryCpdRequirementsTool = queryCpdRequirementsTool
export const thriveQueryCpdUserSummariesTool = queryCpdUserSummariesTool

export const thriveListTagsTool = listTagsTool
export const thriveGetTagTool = getTagTool
export const thriveAddUserTagsTool = addUserTagsTool
export const thriveRemoveUserTagsTool = removeUserTagsTool
export const thriveUpdateUserSkillsTool = updateUserSkillsTool
export const thriveGetSkillLevelsTool = getSkillLevelsTool
