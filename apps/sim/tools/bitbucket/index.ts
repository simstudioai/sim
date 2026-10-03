import { bitbucketApprovePullRequestTool } from '@/tools/bitbucket/approve_pull_request'
import { bitbucketCreateBranchTool } from '@/tools/bitbucket/create_branch'
import { bitbucketCreatePullRequestTool } from '@/tools/bitbucket/create_pull_request'
import { bitbucketCreatePullRequestCommentTool } from '@/tools/bitbucket/create_pull_request_comment'
import { bitbucketDeclinePullRequestTool } from '@/tools/bitbucket/decline_pull_request'
import { bitbucketDeleteBranchTool } from '@/tools/bitbucket/delete_branch'
import { bitbucketGetCommitTool } from '@/tools/bitbucket/get_commit'
import { bitbucketGetFileTool } from '@/tools/bitbucket/get_file'
import { bitbucketGetFileMetadataTool } from '@/tools/bitbucket/get_file_metadata'
import { bitbucketGetMergeTaskStatusTool } from '@/tools/bitbucket/get_merge_task_status'
import { bitbucketGetPipelineTool } from '@/tools/bitbucket/get_pipeline'
import { bitbucketGetPipelineStepLogTool } from '@/tools/bitbucket/get_pipeline_step_log'
import { bitbucketGetPullRequestTool } from '@/tools/bitbucket/get_pull_request'
import { bitbucketGetPullRequestDiffTool } from '@/tools/bitbucket/get_pull_request_diff'
import { bitbucketGetPullRequestDiffstatTool } from '@/tools/bitbucket/get_pull_request_diffstat'
import { bitbucketGetRepositoryTool } from '@/tools/bitbucket/get_repository'
import { bitbucketListBranchesTool } from '@/tools/bitbucket/list_branches'
import { bitbucketListCommitsTool } from '@/tools/bitbucket/list_commits'
import { bitbucketListDirectoryTool } from '@/tools/bitbucket/list_directory'
import { bitbucketListPipelineStepsTool } from '@/tools/bitbucket/list_pipeline_steps'
import { bitbucketListPipelinesTool } from '@/tools/bitbucket/list_pipelines'
import { bitbucketListPullRequestCommentsTool } from '@/tools/bitbucket/list_pull_request_comments'
import { bitbucketListPullRequestCommitStatusesTool } from '@/tools/bitbucket/list_pull_request_commit_statuses'
import { bitbucketListPullRequestsTool } from '@/tools/bitbucket/list_pull_requests'
import { bitbucketListRepositoriesTool } from '@/tools/bitbucket/list_repositories'
import { bitbucketListWorkspacesTool } from '@/tools/bitbucket/list_workspaces'
import { bitbucketMergePullRequestTool } from '@/tools/bitbucket/merge_pull_request'
import { bitbucketRequestPullRequestChangesTool } from '@/tools/bitbucket/request_pull_request_changes'
import { bitbucketStopPipelineTool } from '@/tools/bitbucket/stop_pipeline'
import { bitbucketTriggerPipelineTool } from '@/tools/bitbucket/trigger_pipeline'

export {
  bitbucketListWorkspacesTool,
  bitbucketListRepositoriesTool,
  bitbucketGetRepositoryTool,
  bitbucketListBranchesTool,
  bitbucketCreateBranchTool,
  bitbucketDeleteBranchTool,
  bitbucketListCommitsTool,
  bitbucketGetCommitTool,
  bitbucketListDirectoryTool,
  bitbucketGetFileTool,
  bitbucketGetFileMetadataTool,
  bitbucketListPullRequestsTool,
  bitbucketGetPullRequestTool,
  bitbucketCreatePullRequestTool,
  bitbucketMergePullRequestTool,
  bitbucketGetMergeTaskStatusTool,
  bitbucketDeclinePullRequestTool,
  bitbucketApprovePullRequestTool,
  bitbucketRequestPullRequestChangesTool,
  bitbucketGetPullRequestDiffTool,
  bitbucketGetPullRequestDiffstatTool,
  bitbucketListPullRequestCommentsTool,
  bitbucketCreatePullRequestCommentTool,
  bitbucketListPullRequestCommitStatusesTool,
  bitbucketListPipelinesTool,
  bitbucketGetPipelineTool,
  bitbucketTriggerPipelineTool,
  bitbucketStopPipelineTool,
  bitbucketListPipelineStepsTool,
  bitbucketGetPipelineStepLogTool,
}

export const bitbucketTools = [
  bitbucketListWorkspacesTool,
  bitbucketListRepositoriesTool,
  bitbucketGetRepositoryTool,
  bitbucketListBranchesTool,
  bitbucketCreateBranchTool,
  bitbucketDeleteBranchTool,
  bitbucketListCommitsTool,
  bitbucketGetCommitTool,
  bitbucketListDirectoryTool,
  bitbucketGetFileTool,
  bitbucketGetFileMetadataTool,
  bitbucketListPullRequestsTool,
  bitbucketGetPullRequestTool,
  bitbucketCreatePullRequestTool,
  bitbucketMergePullRequestTool,
  bitbucketGetMergeTaskStatusTool,
  bitbucketDeclinePullRequestTool,
  bitbucketApprovePullRequestTool,
  bitbucketRequestPullRequestChangesTool,
  bitbucketGetPullRequestDiffTool,
  bitbucketGetPullRequestDiffstatTool,
  bitbucketListPullRequestCommentsTool,
  bitbucketCreatePullRequestCommentTool,
  bitbucketListPullRequestCommitStatusesTool,
  bitbucketListPipelinesTool,
  bitbucketGetPipelineTool,
  bitbucketTriggerPipelineTool,
  bitbucketStopPipelineTool,
  bitbucketListPipelineStepsTool,
  bitbucketGetPipelineStepLogTool,
]
