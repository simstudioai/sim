import { addAssigneesTool, addAssigneesV2Tool } from '@/tools/github/add_assignees'
import { addLabelsTool, addLabelsV2Tool } from '@/tools/github/add_labels'
import { cancelWorkflowRunTool, cancelWorkflowRunV2Tool } from '@/tools/github/cancel_workflow_run'
import { closeIssueTool, closeIssueV2Tool } from '@/tools/github/close_issue'
import { closePRTool, closePRV2Tool } from '@/tools/github/close_pr'
import { commentTool, commentV2Tool } from '@/tools/github/comment'
import { createBranchTool, createBranchV2Tool } from '@/tools/github/create_branch'
import { createFileTool, createFileV2Tool } from '@/tools/github/create_file'
import { createIssueTool, createIssueV2Tool } from '@/tools/github/create_issue'
import { createPRTool, createPRV2Tool } from '@/tools/github/create_pr'
import { createProjectTool, createProjectV2Tool } from '@/tools/github/create_project'
import { createReleaseTool, createReleaseV2Tool } from '@/tools/github/create_release'
import { deleteBranchTool, deleteBranchV2Tool } from '@/tools/github/delete_branch'
import { deleteCommentTool, deleteCommentV2Tool } from '@/tools/github/delete_comment'
import { deleteFileTool, deleteFileV2Tool } from '@/tools/github/delete_file'
import { deleteProjectTool, deleteProjectV2Tool } from '@/tools/github/delete_project'
import { deleteReleaseTool, deleteReleaseV2Tool } from '@/tools/github/delete_release'
import { getBranchTool, getBranchV2Tool } from '@/tools/github/get_branch'
import {
  getBranchProtectionTool,
  getBranchProtectionV2Tool,
} from '@/tools/github/get_branch_protection'
import { getFileContentTool, getFileContentV2Tool } from '@/tools/github/get_file_content'
import { getIssueTool, getIssueV2Tool } from '@/tools/github/get_issue'
import { getPRFilesTool, getPRFilesV2Tool } from '@/tools/github/get_pr_files'
import { getProjectTool, getProjectV2Tool } from '@/tools/github/get_project'
import { getReleaseTool, getReleaseV2Tool } from '@/tools/github/get_release'
import { getTreeTool, getTreeV2Tool } from '@/tools/github/get_tree'
import { getWorkflowTool, getWorkflowV2Tool } from '@/tools/github/get_workflow'
import { getWorkflowRunTool, getWorkflowRunV2Tool } from '@/tools/github/get_workflow_run'
import { issueCommentTool, issueCommentV2Tool } from '@/tools/github/issue_comment'
import { latestCommitTool, latestCommitV2Tool } from '@/tools/github/latest_commit'
import { listBranchesTool, listBranchesV2Tool } from '@/tools/github/list_branches'
import { listIssueCommentsTool, listIssueCommentsV2Tool } from '@/tools/github/list_issue_comments'
import { listIssuesTool, listIssuesV2Tool } from '@/tools/github/list_issues'
import { listPRCommentsTool, listPRCommentsV2Tool } from '@/tools/github/list_pr_comments'
import { listProjectsTool, listProjectsV2Tool } from '@/tools/github/list_projects'
import { listPRsTool, listPRsV2Tool } from '@/tools/github/list_prs'
import { listReleasesTool, listReleasesV2Tool } from '@/tools/github/list_releases'
import { listWorkflowRunsTool, listWorkflowRunsV2Tool } from '@/tools/github/list_workflow_runs'
import { listWorkflowsTool, listWorkflowsV2Tool } from '@/tools/github/list_workflows'
import { mergePRTool, mergePRV2Tool } from '@/tools/github/merge_pr'
import { prTool, prV2Tool } from '@/tools/github/pr'
import { removeLabelTool, removeLabelV2Tool } from '@/tools/github/remove_label'
import { repoInfoTool, repoInfoV2Tool } from '@/tools/github/repo_info'
import { requestReviewersTool, requestReviewersV2Tool } from '@/tools/github/request_reviewers'
import { rerunWorkflowTool, rerunWorkflowV2Tool } from '@/tools/github/rerun_workflow'
import { triggerWorkflowTool, triggerWorkflowV2Tool } from '@/tools/github/trigger_workflow'
import {
  updateBranchProtectionTool,
  updateBranchProtectionV2Tool,
} from '@/tools/github/update_branch_protection'
import { updateCommentTool, updateCommentV2Tool } from '@/tools/github/update_comment'
import { updateFileTool, updateFileV2Tool } from '@/tools/github/update_file'
import { updateIssueTool, updateIssueV2Tool } from '@/tools/github/update_issue'
import { updatePRTool, updatePRV2Tool } from '@/tools/github/update_pr'
import { updateProjectTool, updateProjectV2Tool } from '@/tools/github/update_project'
import { updateReleaseTool, updateReleaseV2Tool } from '@/tools/github/update_release'

export const githubCancelWorkflowRunTool = cancelWorkflowRunTool
export const githubCancelWorkflowRunV2Tool = cancelWorkflowRunV2Tool
export const githubClosePRTool = closePRTool
export const githubClosePRV2Tool = closePRV2Tool
export const githubCommentTool = commentTool
export const githubCommentV2Tool = commentV2Tool
export const githubCreateBranchTool = createBranchTool
export const githubCreateBranchV2Tool = createBranchV2Tool
export const githubCreateFileTool = createFileTool
export const githubCreateFileV2Tool = createFileV2Tool
export const githubCreatePRTool = createPRTool
export const githubCreatePRV2Tool = createPRV2Tool
export const githubCreateProjectTool = createProjectTool
export const githubCreateProjectV2Tool = createProjectV2Tool
export const githubCreateReleaseTool = createReleaseTool
export const githubCreateReleaseV2Tool = createReleaseV2Tool
export const githubDeleteBranchTool = deleteBranchTool
export const githubDeleteBranchV2Tool = deleteBranchV2Tool
export const githubDeleteCommentTool = deleteCommentTool
export const githubDeleteCommentV2Tool = deleteCommentV2Tool
export const githubDeleteFileTool = deleteFileTool
export const githubDeleteFileV2Tool = deleteFileV2Tool
export const githubDeleteProjectTool = deleteProjectTool
export const githubDeleteProjectV2Tool = deleteProjectV2Tool
export const githubDeleteReleaseTool = deleteReleaseTool
export const githubDeleteReleaseV2Tool = deleteReleaseV2Tool
export const githubGetBranchTool = getBranchTool
export const githubGetBranchV2Tool = getBranchV2Tool
export const githubGetBranchProtectionTool = getBranchProtectionTool
export const githubGetBranchProtectionV2Tool = getBranchProtectionV2Tool
export const githubGetFileContentTool = getFileContentTool
export const githubGetFileContentV2Tool = getFileContentV2Tool
export const githubGetPRFilesTool = getPRFilesTool
export const githubGetPRFilesV2Tool = getPRFilesV2Tool
export const githubGetProjectTool = getProjectTool
export const githubGetProjectV2Tool = getProjectV2Tool
export const githubGetReleaseTool = getReleaseTool
export const githubGetReleaseV2Tool = getReleaseV2Tool
export const githubGetTreeTool = getTreeTool
export const githubGetTreeV2Tool = getTreeV2Tool
export const githubGetWorkflowTool = getWorkflowTool
export const githubGetWorkflowV2Tool = getWorkflowV2Tool
export const githubGetWorkflowRunTool = getWorkflowRunTool
export const githubGetWorkflowRunV2Tool = getWorkflowRunV2Tool
export const githubIssueCommentTool = issueCommentTool
export const githubIssueCommentV2Tool = issueCommentV2Tool
export const githubLatestCommitTool = latestCommitTool
export const githubLatestCommitV2Tool = latestCommitV2Tool
export const githubListBranchesTool = listBranchesTool
export const githubListBranchesV2Tool = listBranchesV2Tool
export const githubListIssueCommentsTool = listIssueCommentsTool
export const githubListIssueCommentsV2Tool = listIssueCommentsV2Tool
export const githubListPRCommentsTool = listPRCommentsTool
export const githubListPRCommentsV2Tool = listPRCommentsV2Tool
export const githubListPRsTool = listPRsTool
export const githubListPRsV2Tool = listPRsV2Tool
export const githubListProjectsTool = listProjectsTool
export const githubListProjectsV2Tool = listProjectsV2Tool
export const githubListReleasesTool = listReleasesTool
export const githubListReleasesV2Tool = listReleasesV2Tool
export const githubListWorkflowRunsTool = listWorkflowRunsTool
export const githubListWorkflowRunsV2Tool = listWorkflowRunsV2Tool
export const githubListWorkflowsTool = listWorkflowsTool
export const githubListWorkflowsV2Tool = listWorkflowsV2Tool
export const githubMergePRTool = mergePRTool
export const githubMergePRV2Tool = mergePRV2Tool
export const githubPrTool = prTool
export const githubPrV2Tool = prV2Tool
export const githubRepoInfoTool = repoInfoTool
export const githubRepoInfoV2Tool = repoInfoV2Tool
export const githubRequestReviewersTool = requestReviewersTool
export const githubRequestReviewersV2Tool = requestReviewersV2Tool
export const githubRerunWorkflowTool = rerunWorkflowTool
export const githubRerunWorkflowV2Tool = rerunWorkflowV2Tool
export const githubTriggerWorkflowTool = triggerWorkflowTool
export const githubTriggerWorkflowV2Tool = triggerWorkflowV2Tool
export const githubUpdateBranchProtectionTool = updateBranchProtectionTool
export const githubUpdateBranchProtectionV2Tool = updateBranchProtectionV2Tool
export const githubUpdateCommentTool = updateCommentTool
export const githubUpdateCommentV2Tool = updateCommentV2Tool
export const githubUpdateFileTool = updateFileTool
export const githubUpdateFileV2Tool = updateFileV2Tool
export const githubUpdatePRTool = updatePRTool
export const githubUpdatePRV2Tool = updatePRV2Tool
export const githubUpdateProjectTool = updateProjectTool
export const githubUpdateProjectV2Tool = updateProjectV2Tool
export const githubUpdateReleaseTool = updateReleaseTool
export const githubUpdateReleaseV2Tool = updateReleaseV2Tool
export const githubAddAssigneesTool = addAssigneesTool
export const githubAddAssigneesV2Tool = addAssigneesV2Tool
export const githubAddLabelsTool = addLabelsTool
export const githubAddLabelsV2Tool = addLabelsV2Tool
export const githubCloseIssueTool = closeIssueTool
export const githubCloseIssueV2Tool = closeIssueV2Tool
export const githubCreateIssueTool = createIssueTool
export const githubCreateIssueV2Tool = createIssueV2Tool
export const githubGetIssueTool = getIssueTool
export const githubGetIssueV2Tool = getIssueV2Tool
export const githubListIssuesTool = listIssuesTool
export const githubListIssuesV2Tool = listIssuesV2Tool
export const githubRemoveLabelTool = removeLabelTool
export const githubRemoveLabelV2Tool = removeLabelV2Tool
export const githubUpdateIssueTool = updateIssueTool
export const githubUpdateIssueV2Tool = updateIssueV2Tool
