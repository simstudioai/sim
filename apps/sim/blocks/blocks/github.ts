import { GithubIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'
import type { GitHubResponse } from '@/tools/github/types'
import { getTrigger } from '@/triggers'

export const GitHubBlock: BlockConfig<GitHubResponse> = {
  type: 'github',
  name: 'GitHub (Legacy)',
  description: 'Interact with GitHub or trigger workflows from GitHub events',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Github into the workflow. Can get get PR details, create PR comment, get repository info, and get latest commit. Can be used in trigger mode to trigger a workflow when a PR is created, commented on, or a commit is pushed.',
  docsLink: 'https://docs.sim.ai/tools/github',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GithubIcon,
  triggerAllowed: true,
  hideFromToolbar: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get PR details', id: 'github_pr' },
        { label: 'Create PR comment', id: 'github_comment' },
        { label: 'Get repository info', id: 'github_repo_info' },
        { label: 'Get latest commit', id: 'github_latest_commit' },
        // Comment Operations
        { label: 'Create issue comment', id: 'github_issue_comment' },
        { label: 'List issue comments', id: 'github_list_issue_comments' },
        { label: 'Update comment', id: 'github_update_comment' },
        { label: 'Delete comment', id: 'github_delete_comment' },
        { label: 'List PR comments', id: 'github_list_pr_comments' },
        // Pull Request Operations
        { label: 'Create pull request', id: 'github_create_pr' },
        { label: 'Update pull request', id: 'github_update_pr' },
        { label: 'Merge pull request', id: 'github_merge_pr' },
        { label: 'List pull requests', id: 'github_list_prs' },
        { label: 'Get PR files', id: 'github_get_pr_files' },
        { label: 'Close pull request', id: 'github_close_pr' },
        { label: 'Request PR reviewers', id: 'github_request_reviewers' },
        // File Operations
        { label: 'Get file content', id: 'github_get_file_content' },
        { label: 'Create file', id: 'github_create_file' },
        { label: 'Update file', id: 'github_update_file' },
        { label: 'Delete file', id: 'github_delete_file' },
        { label: 'Get directory tree', id: 'github_get_tree' },
        // Branch Operations
        { label: 'List branches', id: 'github_list_branches' },
        { label: 'Get branch', id: 'github_get_branch' },
        { label: 'Create branch', id: 'github_create_branch' },
        { label: 'Delete branch', id: 'github_delete_branch' },
        { label: 'Get branch protection', id: 'github_get_branch_protection' },
        { label: 'Update branch protection', id: 'github_update_branch_protection' },
        // Issue Operations
        { label: 'Create issue', id: 'github_create_issue' },
        { label: 'Update issue', id: 'github_update_issue' },
        { label: 'List issues', id: 'github_list_issues' },
        { label: 'Get issue', id: 'github_get_issue' },
        { label: 'Close issue', id: 'github_close_issue' },
        { label: 'Add issue labels', id: 'github_add_labels' },
        { label: 'Remove issue label', id: 'github_remove_label' },
        { label: 'Add issue assignees', id: 'github_add_assignees' },
        // Release Operations
        { label: 'Create release', id: 'github_create_release' },
        { label: 'Update release', id: 'github_update_release' },
        { label: 'List releases', id: 'github_list_releases' },
        { label: 'Get release', id: 'github_get_release' },
        { label: 'Delete release', id: 'github_delete_release' },
        // Workflow Operations
        { label: 'List workflows', id: 'github_list_workflows' },
        { label: 'Get workflow', id: 'github_get_workflow' },
        { label: 'Trigger workflow', id: 'github_trigger_workflow' },
        { label: 'List workflow runs', id: 'github_list_workflow_runs' },
        { label: 'Get workflow run', id: 'github_get_workflow_run' },
        { label: 'Cancel workflow run', id: 'github_cancel_workflow_run' },
        { label: 'Rerun workflow', id: 'github_rerun_workflow' },
        // Project Operations
        { label: 'List projects', id: 'github_list_projects' },
        { label: 'Get project', id: 'github_get_project' },
        { label: 'Create project', id: 'github_create_project' },
        { label: 'Update project', id: 'github_update_project' },
        { label: 'Delete project', id: 'github_delete_project' },
        // Search Operations
        { label: 'Search code', id: 'github_search_code' },
        { label: 'Search commits', id: 'github_search_commits' },
        { label: 'Search issues', id: 'github_search_issues' },
        { label: 'Search repositories', id: 'github_search_repos' },
        { label: 'Search users', id: 'github_search_users' },
        // Commit Operations
        { label: 'List commits', id: 'github_list_commits' },
        { label: 'Get commit', id: 'github_get_commit' },
        { label: 'Compare commits', id: 'github_compare_commits' },
        // Gist Operations
        { label: 'Create gist', id: 'github_create_gist' },
        { label: 'Get gist', id: 'github_get_gist' },
        { label: 'List gists', id: 'github_list_gists' },
        { label: 'Update gist', id: 'github_update_gist' },
        { label: 'Delete gist', id: 'github_delete_gist' },
        { label: 'Fork gist', id: 'github_fork_gist' },
        { label: 'Star gist', id: 'github_star_gist' },
        { label: 'Unstar gist', id: 'github_unstar_gist' },
        // Fork Operations
        { label: 'Fork repository', id: 'github_fork_repo' },
        { label: 'List forks', id: 'github_list_forks' },
        // Milestone Operations
        { label: 'Create milestone', id: 'github_create_milestone' },
        { label: 'Get milestone', id: 'github_get_milestone' },
        { label: 'List milestones', id: 'github_list_milestones' },
        { label: 'Update milestone', id: 'github_update_milestone' },
        { label: 'Delete milestone', id: 'github_delete_milestone' },
        // Reaction Operations
        { label: 'Add issue reaction', id: 'github_create_issue_reaction' },
        { label: 'Remove issue reaction', id: 'github_delete_issue_reaction' },
        { label: 'Add comment reaction', id: 'github_create_comment_reaction' },
        { label: 'Remove comment reaction', id: 'github_delete_comment_reaction' },
        // Star Operations
        { label: 'Star repository', id: 'github_star_repo' },
        { label: 'Unstar repository', id: 'github_unstar_repo' },
        { label: 'Check if starred', id: 'github_check_star' },
        { label: 'List stargazers', id: 'github_list_stargazers' },
      ],
      value: () => 'github_pr',
    },
    {
      id: 'owner',
      title: 'Repository Owner',
      type: 'short-input',
      placeholder: 'e.g., microsoft',
      required: true,
    },
    {
      id: 'repo',
      title: 'Repository Name',
      type: 'short-input',
      placeholder: 'e.g., vscode',
      required: true,
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      condition: { field: 'operation', value: 'github_pr' },
      required: true,
    },
    {
      id: 'body',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Enter comment text',
      condition: { field: 'operation', value: 'github_comment' },
      required: true,
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      condition: { field: 'operation', value: 'github_comment' },
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main (leave empty for default)',
      condition: { field: 'operation', value: 'github_latest_commit' },
    },
    // Comment operations parameters
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_issue_comment' },
    },
    {
      id: 'body',
      title: 'Comment Text',
      type: 'long-input',
      placeholder: 'Enter comment text',
      required: true,
      condition: { field: 'operation', value: 'github_issue_comment' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_list_issue_comments' },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_issue_comments' },
    },
    {
      id: 'comment_id',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'e.g., 987654321',
      required: true,
      condition: { field: 'operation', value: 'github_update_comment' },
    },
    {
      id: 'body',
      title: 'Updated Comment Text',
      type: 'long-input',
      placeholder: 'Enter updated comment text',
      required: true,
      condition: { field: 'operation', value: 'github_update_comment' },
    },
    {
      id: 'comment_id',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'e.g., 987654321',
      required: true,
      condition: { field: 'operation', value: 'github_delete_comment' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_list_pr_comments' },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_pr_comments' },
    },
    // Pull request operations parameters
    {
      id: 'title',
      title: 'PR Title',
      type: 'short-input',
      placeholder: 'Enter pull request title',
      required: true,
      condition: { field: 'operation', value: 'github_create_pr' },
    },
    {
      id: 'head',
      title: 'Head Branch',
      type: 'short-input',
      placeholder: 'e.g., feature-branch',
      required: true,
      condition: { field: 'operation', value: 'github_create_pr' },
    },
    {
      id: 'base',
      title: 'Base Branch',
      type: 'short-input',
      placeholder: 'e.g., main',
      required: true,
      condition: { field: 'operation', value: 'github_create_pr' },
    },
    {
      id: 'body',
      title: 'PR Description',
      type: 'long-input',
      placeholder: 'Enter pull request description (optional)',
      condition: { field: 'operation', value: 'github_create_pr' },
    },
    {
      id: 'draft',
      title: 'Create as Draft',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_create_pr' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_update_pr' },
    },
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'Enter new title (optional)',
      condition: { field: 'operation', value: 'github_update_pr' },
    },
    {
      id: 'body',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Enter new description (optional)',
      condition: { field: 'operation', value: 'github_update_pr' },
    },
    {
      id: 'state',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
      ],
      condition: { field: 'operation', value: 'github_update_pr' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_merge_pr' },
    },
    {
      id: 'merge_method',
      title: 'Merge Method',
      type: 'dropdown',
      options: [
        { label: 'Merge', id: 'merge' },
        { label: 'Squash', id: 'squash' },
        { label: 'Rebase', id: 'rebase' },
      ],
      condition: { field: 'operation', value: 'github_merge_pr' },
    },
    {
      id: 'commit_title',
      title: 'Commit Title',
      type: 'short-input',
      placeholder: 'Enter commit title (optional)',
      condition: { field: 'operation', value: 'github_merge_pr' },
    },
    {
      id: 'state',
      title: 'State Filter',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'All', id: 'all' },
      ],
      condition: { field: 'operation', value: 'github_list_prs' },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_prs' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_get_pr_files' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_close_pr' },
    },
    {
      id: 'pullNumber',
      title: 'Pull Request Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_request_reviewers' },
    },
    {
      id: 'reviewers',
      title: 'Reviewer Usernames',
      type: 'short-input',
      placeholder: 'Comma-separated: user1,user2',
      condition: { field: 'operation', value: 'github_request_reviewers' },
    },
    {
      id: 'team_reviewers',
      title: 'Team Slugs',
      type: 'short-input',
      placeholder: 'Comma-separated: team1,team2',
      condition: { field: 'operation', value: 'github_request_reviewers' },
    },
    // File operations parameters
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'e.g., src/main.ts',
      required: true,
      condition: { field: 'operation', value: 'github_get_file_content' },
    },
    {
      id: 'ref',
      title: 'Branch/Tag/Commit',
      type: 'short-input',
      placeholder: 'e.g., main (optional)',
      condition: { field: 'operation', value: 'github_get_file_content' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'e.g., src/main.ts',
      required: true,
      condition: { field: 'operation', value: 'github_create_file' },
    },
    {
      id: 'content',
      title: 'File Content',
      type: 'long-input',
      placeholder: 'Enter file content',
      required: true,
      condition: { field: 'operation', value: 'github_create_file' },
    },
    {
      id: 'message',
      title: 'Commit Message',
      type: 'short-input',
      placeholder: 'Enter commit message',
      required: true,
      condition: { field: 'operation', value: 'github_create_file' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main (optional)',
      condition: { field: 'operation', value: 'github_create_file' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'e.g., src/main.ts',
      required: true,
      condition: { field: 'operation', value: 'github_update_file' },
    },
    {
      id: 'content',
      title: 'New File Content',
      type: 'long-input',
      placeholder: 'Enter updated file content',
      required: true,
      condition: { field: 'operation', value: 'github_update_file' },
    },
    {
      id: 'message',
      title: 'Commit Message',
      type: 'short-input',
      placeholder: 'Enter commit message',
      required: true,
      condition: { field: 'operation', value: 'github_update_file' },
    },
    {
      id: 'sha',
      title: 'File SHA',
      type: 'short-input',
      placeholder: 'File SHA from get operation',
      required: true,
      condition: { field: 'operation', value: 'github_update_file' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main (optional)',
      condition: { field: 'operation', value: 'github_update_file' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'e.g., src/main.ts',
      required: true,
      condition: { field: 'operation', value: 'github_delete_file' },
    },
    {
      id: 'message',
      title: 'Commit Message',
      type: 'short-input',
      placeholder: 'Enter commit message',
      required: true,
      condition: { field: 'operation', value: 'github_delete_file' },
    },
    {
      id: 'sha',
      title: 'File SHA',
      type: 'short-input',
      placeholder: 'File SHA from get operation',
      required: true,
      condition: { field: 'operation', value: 'github_delete_file' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main (optional)',
      condition: { field: 'operation', value: 'github_delete_file' },
    },
    {
      id: 'path',
      title: 'Directory Path',
      type: 'short-input',
      placeholder: 'e.g., src (leave empty for root)',
      condition: { field: 'operation', value: 'github_get_tree' },
    },
    {
      id: 'ref',
      title: 'Branch/Tag/Commit',
      type: 'short-input',
      placeholder: 'e.g., main (optional)',
      condition: { field: 'operation', value: 'github_get_tree' },
    },
    // Branch operations parameters
    {
      id: 'protected',
      title: 'Filter by Protection',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Protected', id: 'true' },
        { label: 'Unprotected', id: 'false' },
      ],
      condition: { field: 'operation', value: 'github_list_branches' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main',
      required: true,
      condition: { field: 'operation', value: 'github_get_branch' },
    },
    {
      id: 'branch',
      title: 'New Branch Name',
      type: 'short-input',
      placeholder: 'e.g., feature-branch',
      required: true,
      condition: { field: 'operation', value: 'github_create_branch' },
    },
    {
      id: 'sha',
      title: 'Source Commit SHA',
      type: 'short-input',
      placeholder: 'SHA to create branch from',
      required: true,
      condition: { field: 'operation', value: 'github_create_branch' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., feature-branch',
      required: true,
      condition: { field: 'operation', value: 'github_delete_branch' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main',
      required: true,
      condition: { field: 'operation', value: 'github_get_branch_protection' },
    },
    {
      id: 'branch',
      title: 'Branch Name',
      type: 'short-input',
      placeholder: 'e.g., main',
      required: true,
      condition: { field: 'operation', value: 'github_update_branch_protection' },
    },
    {
      id: 'required_status_checks',
      title: 'Required Status Checks',
      type: 'short-input',
      placeholder: 'JSON: {"strict":true,"contexts":["ci/test"]}',
      condition: { field: 'operation', value: 'github_update_branch_protection' },
    },
    {
      id: 'enforce_admins',
      title: 'Enforce for Admins',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_update_branch_protection' },
    },
    {
      id: 'required_pull_request_reviews',
      title: 'Required PR Reviews',
      type: 'short-input',
      placeholder: 'JSON: {"required_approving_review_count":1}',
      condition: { field: 'operation', value: 'github_update_branch_protection' },
    },
    // Issue operations parameters
    {
      id: 'title',
      title: 'Issue Title',
      type: 'short-input',
      placeholder: 'Enter issue title',
      required: true,
      condition: { field: 'operation', value: 'github_create_issue' },
    },
    {
      id: 'body',
      title: 'Issue Description',
      type: 'long-input',
      placeholder: 'Enter issue description (optional)',
      condition: { field: 'operation', value: 'github_create_issue' },
    },
    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'Comma-separated: bug,enhancement',
      condition: { field: 'operation', value: 'github_create_issue' },
    },
    {
      id: 'assignees',
      title: 'Assignees',
      type: 'short-input',
      placeholder: 'Comma-separated: user1,user2',
      condition: { field: 'operation', value: 'github_create_issue' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_update_issue' },
    },
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'Enter new title (optional)',
      condition: { field: 'operation', value: 'github_update_issue' },
    },
    {
      id: 'body',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Enter new description (optional)',
      condition: { field: 'operation', value: 'github_update_issue' },
    },
    {
      id: 'state',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
      ],
      condition: { field: 'operation', value: 'github_update_issue' },
    },
    {
      id: 'state',
      title: 'State Filter',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'All', id: 'all' },
      ],
      condition: { field: 'operation', value: 'github_list_issues' },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_issues' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_get_issue' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_close_issue' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_add_labels' },
    },
    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'Comma-separated: bug,enhancement',
      required: true,
      condition: { field: 'operation', value: 'github_add_labels' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_remove_label' },
    },
    {
      id: 'name',
      title: 'Label Name',
      type: 'short-input',
      placeholder: 'e.g., bug',
      required: true,
      condition: { field: 'operation', value: 'github_remove_label' },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: { field: 'operation', value: 'github_add_assignees' },
    },
    {
      id: 'assignees',
      title: 'Assignees',
      type: 'short-input',
      placeholder: 'Comma-separated: user1,user2',
      required: true,
      condition: { field: 'operation', value: 'github_add_assignees' },
    },
    // Release operations parameters
    {
      id: 'tag_name',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'e.g., v1.0.0',
      required: true,
      condition: { field: 'operation', value: 'github_create_release' },
    },
    {
      id: 'name',
      title: 'Release Name',
      type: 'short-input',
      placeholder: 'e.g., Version 1.0.0',
      condition: { field: 'operation', value: 'github_create_release' },
    },
    {
      id: 'body',
      title: 'Release Notes',
      type: 'long-input',
      placeholder: 'Enter release notes (optional)',
      condition: { field: 'operation', value: 'github_create_release' },
    },
    {
      id: 'draft',
      title: 'Draft',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_create_release' },
    },
    {
      id: 'prerelease',
      title: 'Prerelease',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_create_release' },
    },
    {
      id: 'release_id',
      title: 'Release ID',
      type: 'short-input',
      placeholder: 'e.g., 123456',
      required: true,
      condition: { field: 'operation', value: 'github_update_release' },
    },
    {
      id: 'tag_name',
      title: 'New Tag Name',
      type: 'short-input',
      placeholder: 'e.g., v1.0.1 (optional)',
      condition: { field: 'operation', value: 'github_update_release' },
    },
    {
      id: 'name',
      title: 'New Release Name',
      type: 'short-input',
      placeholder: 'Enter new name (optional)',
      condition: { field: 'operation', value: 'github_update_release' },
    },
    {
      id: 'body',
      title: 'New Release Notes',
      type: 'long-input',
      placeholder: 'Enter updated notes (optional)',
      condition: { field: 'operation', value: 'github_update_release' },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_releases' },
    },
    {
      id: 'release_id',
      title: 'Release ID',
      type: 'short-input',
      placeholder: 'e.g., 123456',
      required: true,
      condition: { field: 'operation', value: 'github_get_release' },
    },
    {
      id: 'release_id',
      title: 'Release ID',
      type: 'short-input',
      placeholder: 'e.g., 123456',
      required: true,
      condition: { field: 'operation', value: 'github_delete_release' },
    },
    // Workflow operations parameters
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_workflows' },
    },
    {
      id: 'workflow_id',
      title: 'Workflow ID or Filename',
      type: 'short-input',
      placeholder: 'e.g., 123456 or ci.yml',
      required: true,
      condition: { field: 'operation', value: 'github_get_workflow' },
    },
    {
      id: 'workflow_id',
      title: 'Workflow ID or Filename',
      type: 'short-input',
      placeholder: 'e.g., 123456 or ci.yml',
      required: true,
      condition: { field: 'operation', value: 'github_trigger_workflow' },
    },
    {
      id: 'ref',
      title: 'Branch/Tag to Run On',
      type: 'short-input',
      placeholder: 'e.g., main',
      required: true,
      condition: { field: 'operation', value: 'github_trigger_workflow' },
    },
    {
      id: 'inputs',
      title: 'Workflow Inputs',
      type: 'long-input',
      placeholder: 'JSON: {"key":"value"}',
      condition: { field: 'operation', value: 'github_trigger_workflow' },
    },
    {
      id: 'workflow_id',
      title: 'Workflow ID or Filename',
      type: 'short-input',
      placeholder: 'e.g., 123456 or ci.yml (optional)',
      condition: { field: 'operation', value: 'github_list_workflow_runs' },
    },
    {
      id: 'status',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Queued', id: 'queued' },
        { label: 'In Progress', id: 'in_progress' },
        { label: 'Completed', id: 'completed' },
      ],
      condition: { field: 'operation', value: 'github_list_workflow_runs' },
    },
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: { field: 'operation', value: 'github_list_workflow_runs' },
    },
    {
      id: 'run_id',
      title: 'Workflow Run ID',
      type: 'short-input',
      placeholder: 'e.g., 123456789',
      required: true,
      condition: { field: 'operation', value: 'github_get_workflow_run' },
    },
    {
      id: 'run_id',
      title: 'Workflow Run ID',
      type: 'short-input',
      placeholder: 'e.g., 123456789',
      required: true,
      condition: { field: 'operation', value: 'github_cancel_workflow_run' },
    },
    {
      id: 'run_id',
      title: 'Workflow Run ID',
      type: 'short-input',
      placeholder: 'e.g., 123456789',
      required: true,
      condition: { field: 'operation', value: 'github_rerun_workflow' },
    },
    // Project operations parameters
    {
      id: 'owner_login',
      title: 'Owner Login',
      type: 'short-input',
      placeholder: 'e.g., octocat or org-name',
      required: true,
      condition: { field: 'operation', value: 'github_list_projects' },
    },
    {
      id: 'owner_type',
      title: 'Owner Type',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'user' },
        { label: 'Organization', id: 'org' },
      ],
      required: true,
      condition: { field: 'operation', value: 'github_list_projects' },
    },
    {
      id: 'project_number',
      title: 'Project Number',
      type: 'short-input',
      placeholder: 'e.g., 1',
      required: true,
      condition: { field: 'operation', value: 'github_get_project' },
    },
    {
      id: 'owner_login',
      title: 'Owner Login',
      type: 'short-input',
      placeholder: 'e.g., octocat or org-name',
      required: true,
      condition: { field: 'operation', value: 'github_get_project' },
    },
    {
      id: 'owner_type',
      title: 'Owner Type',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'user' },
        { label: 'Organization', id: 'org' },
      ],
      required: true,
      condition: { field: 'operation', value: 'github_get_project' },
    },
    {
      id: 'owner_id',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'User or org node ID',
      required: true,
      condition: { field: 'operation', value: 'github_create_project' },
    },
    {
      id: 'title',
      title: 'Project Title',
      type: 'short-input',
      placeholder: 'Enter project title',
      required: true,
      condition: { field: 'operation', value: 'github_create_project' },
    },
    {
      id: 'project_id',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Project node ID',
      required: true,
      condition: { field: 'operation', value: 'github_update_project' },
    },
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'Enter new title (optional)',
      condition: { field: 'operation', value: 'github_update_project' },
    },
    {
      id: 'project_public',
      title: 'Public',
      type: 'dropdown',
      options: [
        { label: 'Private', id: 'false' },
        { label: 'Public', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_update_project' },
    },
    {
      id: 'project_id',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Project node ID',
      required: true,
      condition: { field: 'operation', value: 'github_delete_project' },
    },
    // Search operations parameters
    {
      id: 'q',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g., react language:typescript',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'github_search_code',
          'github_search_commits',
          'github_search_issues',
          'github_search_repos',
          'github_search_users',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a GitHub search query based on the user's description.
GitHub search supports these qualifiers:
- For repos: language:python, stars:>1000, forks:>100, topic:react, user:owner, org:name, created:>2023-01-01
- For code: repo:owner/name, path:src, extension:ts, language:javascript
- For issues/PRs: is:issue, is:pr, is:open, is:closed, label:bug, author:user, assignee:user
- For commits: repo:owner/name, author:user, committer:user, author-date:>2023-01-01
- For users: type:user, type:org, followers:>100, repos:>10, location:city

Examples:
- "Python repos with more than 1000 stars" -> language:python stars:>1000
- "Open bugs in facebook/react" -> repo:facebook/react is:issue is:open label:bug
- "TypeScript files in src folder" -> language:typescript path:src

Return ONLY the search query - no explanations.`,
        placeholder: 'Describe what you want to search for...',
      },
    },
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Best match', id: '' },
        { label: 'Stars', id: 'stars' },
        { label: 'Forks', id: 'forks' },
        { label: 'Updated', id: 'updated' },
      ],
      condition: { field: 'operation', value: 'github_search_repos' },
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      condition: {
        field: 'operation',
        value: [
          'github_search_code',
          'github_search_commits',
          'github_search_issues',
          'github_search_repos',
          'github_search_users',
        ],
      },
    },
    // Commit operations parameters
    {
      id: 'sha',
      title: 'SHA or Branch',
      type: 'short-input',
      placeholder: 'e.g., main or abc123',
      condition: { field: 'operation', value: 'github_list_commits' },
    },
    {
      id: 'author',
      title: 'Author Filter',
      type: 'short-input',
      placeholder: 'GitHub username or email',
      condition: { field: 'operation', value: 'github_list_commits' },
    },
    {
      id: 'since',
      title: 'Since Date',
      type: 'short-input',
      placeholder: 'ISO 8601: 2024-01-01T00:00:00Z',
      condition: { field: 'operation', value: ['github_list_commits', 'github_list_gists'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z
- "30 days ago" -> Calculate 30 days before current time
- "January 1st 2024" -> 2024-01-01T00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last week", "beginning of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'until',
      title: 'Until Date',
      type: 'short-input',
      placeholder: 'ISO 8601: 2024-12-31T23:59:59Z',
      condition: { field: 'operation', value: 'github_list_commits' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current timestamp
- "end of today" -> Today's date at 23:59:59Z
- "end of last week" -> Calculate end of last week
- "yesterday" -> Yesterday's date at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "now", "end of yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'ref',
      title: 'Commit Reference',
      type: 'short-input',
      placeholder: 'SHA, branch, or tag',
      required: true,
      condition: { field: 'operation', value: 'github_get_commit' },
    },
    {
      id: 'base',
      title: 'Base Reference',
      type: 'short-input',
      placeholder: 'Base branch/tag/SHA',
      required: true,
      condition: { field: 'operation', value: 'github_compare_commits' },
    },
    {
      id: 'head',
      title: 'Head Reference',
      type: 'short-input',
      placeholder: 'Head branch/tag/SHA',
      required: true,
      condition: { field: 'operation', value: 'github_compare_commits' },
    },
    // Gist operations parameters
    {
      id: 'gist_id',
      title: 'Gist ID',
      type: 'short-input',
      placeholder: 'e.g., aa5a315d61ae9438b18d',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'github_get_gist',
          'github_update_gist',
          'github_delete_gist',
          'github_fork_gist',
          'github_star_gist',
          'github_unstar_gist',
        ],
      },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Gist description',
      condition: { field: 'operation', value: ['github_create_gist', 'github_update_gist'] },
    },
    {
      id: 'files',
      title: 'Files (JSON)',
      type: 'long-input',
      placeholder: '{"file.txt": {"content": "Hello"}}',
      required: true,
      condition: { field: 'operation', value: 'github_create_gist' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for GitHub Gist files based on the user's description.
The format is: {"filename.ext": {"content": "file contents"}}

Examples:
- "A Python hello world file" -> {"hello.py": {"content": "print('Hello, World!')"}}
- "A README with project title" -> {"README.md": {"content": "# My Project\\n\\nDescription here"}}
- "JavaScript function to add numbers" -> {"add.js": {"content": "function add(a, b) {\\n  return a + b;\\n}"}}
- "Two files: index.html and style.css" -> {"index.html": {"content": "<!DOCTYPE html>..."}, "style.css": {"content": "body { margin: 0; }"}}

Return ONLY valid JSON - no explanations, no markdown formatting.`,
        placeholder: 'Describe the files you want to create...',
        generationType: 'json-object',
      },
    },
    {
      id: 'files',
      title: 'Files (JSON)',
      type: 'long-input',
      placeholder: '{"file.txt": {"content": "Updated"}}',
      condition: { field: 'operation', value: 'github_update_gist' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for updating GitHub Gist files based on the user's description.
The format is: {"filename.ext": {"content": "new contents"}}
To delete a file, set its value to null: {"old-file.txt": null}
To rename a file, set the new filename: {"old-name.txt": {"filename": "new-name.txt", "content": "..."}}

Examples:
- "Update hello.py to print goodbye" -> {"hello.py": {"content": "print('Goodbye!')"}}
- "Delete the old readme" -> {"README.md": null}
- "Rename script.js to main.js" -> {"script.js": {"filename": "main.js"}}

Return ONLY valid JSON - no explanations, no markdown formatting.`,
        placeholder: 'Describe the file changes...',
        generationType: 'json-object',
      },
    },
    {
      id: 'gist_public',
      title: 'Public',
      type: 'dropdown',
      options: [
        { label: 'Secret', id: 'false' },
        { label: 'Public', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_create_gist' },
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'GitHub username (optional)',
      condition: { field: 'operation', value: 'github_list_gists' },
    },
    // Fork operations parameters
    {
      id: 'organization',
      title: 'Organization',
      type: 'short-input',
      placeholder: 'Fork to org (optional)',
      condition: { field: 'operation', value: 'github_fork_repo' },
    },
    {
      id: 'fork_name',
      title: 'Fork Name',
      type: 'short-input',
      placeholder: 'Custom name (optional)',
      condition: { field: 'operation', value: 'github_fork_repo' },
    },
    {
      id: 'default_branch_only',
      title: 'Default Branch Only',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'github_fork_repo' },
    },
    {
      id: 'fork_sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Newest', id: 'newest' },
        { label: 'Oldest', id: 'oldest' },
        { label: 'Stargazers', id: 'stargazers' },
        { label: 'Watchers', id: 'watchers' },
      ],
      condition: { field: 'operation', value: 'github_list_forks' },
    },
    // Milestone operations parameters
    {
      id: 'milestone_title',
      title: 'Milestone Title',
      type: 'short-input',
      placeholder: 'e.g., v1.0 Release',
      required: true,
      condition: { field: 'operation', value: 'github_create_milestone' },
    },
    {
      id: 'milestone_title',
      title: 'New Title',
      type: 'short-input',
      placeholder: 'Updated title (optional)',
      condition: { field: 'operation', value: 'github_update_milestone' },
    },
    {
      id: 'milestone_description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Milestone description',
      condition: {
        field: 'operation',
        value: ['github_create_milestone', 'github_update_milestone'],
      },
    },
    {
      id: 'due_on',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'ISO 8601: 2024-12-31T23:59:59Z',
      condition: {
        field: 'operation',
        value: ['github_create_milestone', 'github_update_milestone'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp for a milestone due date based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "end of this month" -> Last day of current month at 23:59:59Z
- "next Friday" -> Calculate next Friday's date at 23:59:59Z
- "in 2 weeks" -> Calculate 14 days from now at 23:59:59Z
- "December 31st" -> 2024-12-31T23:59:59Z (current year)
- "Q1 2025" -> 2025-03-31T23:59:59Z (end of Q1)

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the due date (e.g., "end of month", "next Friday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'milestone_number',
      title: 'Milestone Number',
      type: 'short-input',
      placeholder: 'e.g., 1',
      required: true,
      condition: {
        field: 'operation',
        value: ['github_get_milestone', 'github_update_milestone', 'github_delete_milestone'],
      },
    },
    {
      id: 'milestone_state',
      title: 'State Filter',
      type: 'dropdown',
      options: [
        { label: 'Open', id: 'open' },
        { label: 'Closed', id: 'closed' },
        { label: 'All', id: 'all' },
      ],
      condition: { field: 'operation', value: 'github_list_milestones' },
    },
    {
      id: 'milestone_sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Due Date', id: 'due_on' },
        { label: 'Completeness', id: 'completeness' },
      ],
      condition: { field: 'operation', value: 'github_list_milestones' },
    },
    // Reaction operations parameters
    {
      id: 'reaction_content',
      title: 'Reaction',
      type: 'dropdown',
      options: [
        { label: '👍 +1', id: '+1' },
        { label: '👎 -1', id: '-1' },
        { label: '😄 Laugh', id: 'laugh' },
        { label: '😕 Confused', id: 'confused' },
        { label: '❤️ Heart', id: 'heart' },
        { label: '🎉 Hooray', id: 'hooray' },
        { label: '🚀 Rocket', id: 'rocket' },
        { label: '👀 Eyes', id: 'eyes' },
      ],
      required: true,
      condition: {
        field: 'operation',
        value: ['github_create_issue_reaction', 'github_create_comment_reaction'],
      },
    },
    {
      id: 'issue_number',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'e.g., 123',
      required: true,
      condition: {
        field: 'operation',
        value: ['github_create_issue_reaction', 'github_delete_issue_reaction'],
      },
    },
    {
      id: 'reaction_id',
      title: 'Reaction ID',
      type: 'short-input',
      placeholder: 'e.g., 12345678',
      required: true,
      condition: {
        field: 'operation',
        value: ['github_delete_issue_reaction', 'github_delete_comment_reaction'],
      },
    },
    {
      id: 'comment_id',
      title: 'Comment ID',
      type: 'short-input',
      placeholder: 'e.g., 987654321',
      required: true,
      condition: {
        field: 'operation',
        value: ['github_create_comment_reaction', 'github_delete_comment_reaction'],
      },
    },
    // Star operations parameters - owner/repo already covered by existing subBlocks
    {
      id: 'per_page',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'e.g., 30 (default: 30, max: 100)',
      condition: {
        field: 'operation',
        value: [
          'github_search_code',
          'github_search_commits',
          'github_search_issues',
          'github_search_repos',
          'github_search_users',
          'github_list_commits',
          'github_list_gists',
          'github_list_forks',
          'github_list_milestones',
          'github_list_stargazers',
        ],
      },
    },
    {
      id: 'apiKey',
      title: 'GitHub Token',
      type: 'short-input',
      placeholder: 'Enter GitHub Token',
      password: true,
      required: true,
    },
    ...getTrigger('github_issue_opened').subBlocks,
    ...getTrigger('github_issue_closed').subBlocks,
    ...getTrigger('github_issue_comment').subBlocks,
    ...getTrigger('github_pr_opened').subBlocks,
    ...getTrigger('github_pr_closed').subBlocks,
    ...getTrigger('github_pr_merged').subBlocks,
    ...getTrigger('github_pr_comment').subBlocks,
    ...getTrigger('github_pr_reviewed').subBlocks,
    ...getTrigger('github_push').subBlocks,
    ...getTrigger('github_release_published').subBlocks,
    ...getTrigger('github_workflow_run').subBlocks,
    {
      id: 'commentType',
      title: 'Comment Type',
      type: 'dropdown',
      options: [
        { label: 'General PR Comment', id: 'pr_comment' },
        { label: 'File-specific Comment', id: 'file_comment' },
      ],
      condition: { field: 'operation', value: 'github_comment' },
    },
    {
      id: 'path',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'e.g., src/main.ts',
      condition: {
        field: 'operation',
        value: 'github_comment',
        and: {
          field: 'commentType',
          value: 'file_comment',
        },
      },
    },
    {
      id: 'line',
      title: 'Line Number',
      type: 'short-input',
      placeholder: 'e.g., 42',
      condition: {
        field: 'operation',
        value: 'github_comment',
        and: {
          field: 'commentType',
          value: 'file_comment',
        },
      },
    },
  ],
  tools: {
    access: [
      'github_pr',
      'github_comment',
      'github_repo_info',
      'github_latest_commit',
      // Comment tools
      'github_issue_comment',
      'github_list_issue_comments',
      'github_update_comment',
      'github_delete_comment',
      'github_list_pr_comments',
      // Pull request tools
      'github_create_pr',
      'github_update_pr',
      'github_merge_pr',
      'github_list_prs',
      'github_get_pr_files',
      'github_close_pr',
      'github_request_reviewers',
      // File tools
      'github_get_file_content',
      'github_create_file',
      'github_update_file',
      'github_delete_file',
      'github_get_tree',
      // Branch tools
      'github_list_branches',
      'github_get_branch',
      'github_create_branch',
      'github_delete_branch',
      'github_get_branch_protection',
      'github_update_branch_protection',
      // Issue tools
      'github_create_issue',
      'github_update_issue',
      'github_list_issues',
      'github_get_issue',
      'github_close_issue',
      'github_add_labels',
      'github_remove_label',
      'github_add_assignees',
      // Release tools
      'github_create_release',
      'github_update_release',
      'github_list_releases',
      'github_get_release',
      'github_delete_release',
      // Workflow tools
      'github_list_workflows',
      'github_get_workflow',
      'github_trigger_workflow',
      'github_list_workflow_runs',
      'github_get_workflow_run',
      'github_cancel_workflow_run',
      'github_rerun_workflow',
      // Project tools
      'github_list_projects',
      'github_get_project',
      'github_create_project',
      'github_update_project',
      'github_delete_project',
      // Search tools
      'github_search_code',
      'github_search_commits',
      'github_search_issues',
      'github_search_repos',
      'github_search_users',
      // Commit tools
      'github_list_commits',
      'github_get_commit',
      'github_compare_commits',
      // Gist tools
      'github_create_gist',
      'github_get_gist',
      'github_list_gists',
      'github_update_gist',
      'github_delete_gist',
      'github_fork_gist',
      'github_star_gist',
      'github_unstar_gist',
      // Fork tools
      'github_fork_repo',
      'github_list_forks',
      // Milestone tools
      'github_create_milestone',
      'github_get_milestone',
      'github_list_milestones',
      'github_update_milestone',
      'github_delete_milestone',
      // Reaction tools
      'github_create_issue_reaction',
      'github_delete_issue_reaction',
      'github_create_comment_reaction',
      'github_delete_comment_reaction',
      // Star tools
      'github_star_repo',
      'github_unstar_repo',
      'github_check_star',
      'github_list_stargazers',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'github_pr':
            return 'github_pr'
          case 'github_comment':
            return 'github_comment'
          case 'github_repo_info':
            return 'github_repo_info'
          case 'github_latest_commit':
            return 'github_latest_commit'
          // Comment operations
          case 'github_issue_comment':
            return 'github_issue_comment'
          case 'github_list_issue_comments':
            return 'github_list_issue_comments'
          case 'github_update_comment':
            return 'github_update_comment'
          case 'github_delete_comment':
            return 'github_delete_comment'
          case 'github_list_pr_comments':
            return 'github_list_pr_comments'
          // Pull request operations
          case 'github_create_pr':
            return 'github_create_pr'
          case 'github_update_pr':
            return 'github_update_pr'
          case 'github_merge_pr':
            return 'github_merge_pr'
          case 'github_list_prs':
            return 'github_list_prs'
          case 'github_get_pr_files':
            return 'github_get_pr_files'
          case 'github_close_pr':
            return 'github_close_pr'
          case 'github_request_reviewers':
            return 'github_request_reviewers'
          // File operations
          case 'github_get_file_content':
            return 'github_get_file_content'
          case 'github_create_file':
            return 'github_create_file'
          case 'github_update_file':
            return 'github_update_file'
          case 'github_delete_file':
            return 'github_delete_file'
          case 'github_get_tree':
            return 'github_get_tree'
          // Branch operations
          case 'github_list_branches':
            return 'github_list_branches'
          case 'github_get_branch':
            return 'github_get_branch'
          case 'github_create_branch':
            return 'github_create_branch'
          case 'github_delete_branch':
            return 'github_delete_branch'
          case 'github_get_branch_protection':
            return 'github_get_branch_protection'
          case 'github_update_branch_protection':
            return 'github_update_branch_protection'
          // Issue operations
          case 'github_create_issue':
            return 'github_create_issue'
          case 'github_update_issue':
            return 'github_update_issue'
          case 'github_list_issues':
            return 'github_list_issues'
          case 'github_get_issue':
            return 'github_get_issue'
          case 'github_close_issue':
            return 'github_close_issue'
          case 'github_add_labels':
            return 'github_add_labels'
          case 'github_remove_label':
            return 'github_remove_label'
          case 'github_add_assignees':
            return 'github_add_assignees'
          // Release operations
          case 'github_create_release':
            return 'github_create_release'
          case 'github_update_release':
            return 'github_update_release'
          case 'github_list_releases':
            return 'github_list_releases'
          case 'github_get_release':
            return 'github_get_release'
          case 'github_delete_release':
            return 'github_delete_release'
          // Workflow operations
          case 'github_list_workflows':
            return 'github_list_workflows'
          case 'github_get_workflow':
            return 'github_get_workflow'
          case 'github_trigger_workflow':
            return 'github_trigger_workflow'
          case 'github_list_workflow_runs':
            return 'github_list_workflow_runs'
          case 'github_get_workflow_run':
            return 'github_get_workflow_run'
          case 'github_cancel_workflow_run':
            return 'github_cancel_workflow_run'
          case 'github_rerun_workflow':
            return 'github_rerun_workflow'
          // Project operations
          case 'github_list_projects':
            return 'github_list_projects'
          case 'github_get_project':
            return 'github_get_project'
          case 'github_create_project':
            return 'github_create_project'
          case 'github_update_project':
            return 'github_update_project'
          case 'github_delete_project':
            return 'github_delete_project'
          // Search operations
          case 'github_search_code':
            return 'github_search_code'
          case 'github_search_commits':
            return 'github_search_commits'
          case 'github_search_issues':
            return 'github_search_issues'
          case 'github_search_repos':
            return 'github_search_repos'
          case 'github_search_users':
            return 'github_search_users'
          // Commit operations
          case 'github_list_commits':
            return 'github_list_commits'
          case 'github_get_commit':
            return 'github_get_commit'
          case 'github_compare_commits':
            return 'github_compare_commits'
          // Gist operations
          case 'github_create_gist':
            return 'github_create_gist'
          case 'github_get_gist':
            return 'github_get_gist'
          case 'github_list_gists':
            return 'github_list_gists'
          case 'github_update_gist':
            return 'github_update_gist'
          case 'github_delete_gist':
            return 'github_delete_gist'
          case 'github_fork_gist':
            return 'github_fork_gist'
          case 'github_star_gist':
            return 'github_star_gist'
          case 'github_unstar_gist':
            return 'github_unstar_gist'
          // Fork operations
          case 'github_fork_repo':
            return 'github_fork_repo'
          case 'github_list_forks':
            return 'github_list_forks'
          // Milestone operations
          case 'github_create_milestone':
            return 'github_create_milestone'
          case 'github_get_milestone':
            return 'github_get_milestone'
          case 'github_list_milestones':
            return 'github_list_milestones'
          case 'github_update_milestone':
            return 'github_update_milestone'
          case 'github_delete_milestone':
            return 'github_delete_milestone'
          // Reaction operations
          case 'github_create_issue_reaction':
            return 'github_create_issue_reaction'
          case 'github_delete_issue_reaction':
            return 'github_delete_issue_reaction'
          case 'github_create_comment_reaction':
            return 'github_create_comment_reaction'
          case 'github_delete_comment_reaction':
            return 'github_delete_comment_reaction'
          // Star operations
          case 'github_star_repo':
            return 'github_star_repo'
          case 'github_unstar_repo':
            return 'github_unstar_repo'
          case 'github_check_star':
            return 'github_check_star'
          case 'github_list_stargazers':
            return 'github_list_stargazers'
          default:
            return 'github_repo_info'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    owner: { type: 'string', description: 'Repository owner' },
    repo: { type: 'string', description: 'Repository name' },
    pullNumber: { type: 'number', description: 'Pull request number' },
    body: { type: 'string', description: 'Comment text or description' },
    apiKey: { type: 'string', description: 'GitHub access token' },
    commentType: { type: 'string', description: 'Comment type' },
    path: { type: 'string', description: 'File path' },
    line: { type: 'number', description: 'Line number' },
    side: { type: 'string', description: 'Comment side' },
    commitId: { type: 'string', description: 'Commit identifier' },
    branch: { type: 'string', description: 'Branch name' },
    // Comment parameters
    issue_number: { type: 'number', description: 'Issue number' },
    comment_id: { type: 'number', description: 'Comment ID' },
    per_page: { type: 'number', description: 'Results per page' },
    // Pull request parameters
    title: { type: 'string', description: 'Title' },
    head: { type: 'string', description: 'Head branch' },
    base: { type: 'string', description: 'Base branch' },
    draft: { type: 'boolean', description: 'Draft status' },
    state: { type: 'string', description: 'State filter or value' },
    merge_method: { type: 'string', description: 'Merge method' },
    commit_title: { type: 'string', description: 'Commit title' },
    reviewers: { type: 'string', description: 'Reviewer usernames' },
    team_reviewers: { type: 'string', description: 'Team reviewer slugs' },
    // File parameters
    content: { type: 'string', description: 'File content' },
    message: { type: 'string', description: 'Commit message' },
    sha: { type: 'string', description: 'File or commit SHA' },
    ref: { type: 'string', description: 'Branch, tag, or commit reference' },
    // Branch parameters
    protected: { type: 'string', description: 'Protection status filter' },
    required_status_checks: { type: 'string', description: 'Required status checks JSON' },
    enforce_admins: { type: 'boolean', description: 'Enforce for admins' },
    required_pull_request_reviews: { type: 'string', description: 'Required PR reviews JSON' },
    // Issue parameters
    labels: { type: 'string', description: 'Comma-separated labels' },
    assignees: { type: 'string', description: 'Comma-separated assignees' },
    name: { type: 'string', description: 'Label or release name' },
    // Release parameters
    tag_name: { type: 'string', description: 'Release tag name' },
    release_id: { type: 'number', description: 'Release ID' },
    prerelease: { type: 'boolean', description: 'Prerelease status' },
    // Workflow parameters
    workflow_id: { type: 'string', description: 'Workflow ID or filename' },
    run_id: { type: 'number', description: 'Workflow run ID' },
    status: { type: 'string', description: 'Status filter' },
    inputs: { type: 'string', description: 'Workflow inputs JSON' },
    // Project parameters
    owner_login: { type: 'string', description: 'Owner login' },
    owner_type: { type: 'string', description: 'Owner type (user or org)' },
    owner_id: { type: 'string', description: 'Owner node ID' },
    project_number: { type: 'number', description: 'Project number' },
    project_id: { type: 'string', description: 'Project node ID' },
    project_public: { type: 'boolean', description: 'Project public status' },
    // Search parameters
    q: { type: 'string', description: 'Search query with qualifiers' },
    sort: { type: 'string', description: 'Sort field' },
    order: { type: 'string', description: 'Sort order (asc or desc)' },
    // Commit parameters
    author: { type: 'string', description: 'Author filter' },
    committer: { type: 'string', description: 'Committer filter' },
    since: { type: 'string', description: 'Date filter (since)' },
    until: { type: 'string', description: 'Date filter (until)' },
    // Gist parameters
    gist_id: { type: 'string', description: 'Gist ID' },
    description: { type: 'string', description: 'Description' },
    files: { type: 'string', description: 'Files JSON object' },
    gist_public: { type: 'boolean', description: 'Public gist status' },
    username: { type: 'string', description: 'GitHub username' },
    // Fork parameters
    organization: { type: 'string', description: 'Target organization for fork' },
    fork_name: { type: 'string', description: 'Custom name for fork' },
    default_branch_only: { type: 'boolean', description: 'Fork only default branch' },
    fork_sort: { type: 'string', description: 'Fork list sort field' },
    // Milestone parameters
    milestone_title: { type: 'string', description: 'Milestone title' },
    milestone_description: { type: 'string', description: 'Milestone description' },
    due_on: { type: 'string', description: 'Milestone due date' },
    milestone_number: { type: 'number', description: 'Milestone number' },
    milestone_state: { type: 'string', description: 'Milestone state filter' },
    milestone_sort: { type: 'string', description: 'Milestone sort field' },
    // Reaction parameters
    reaction_content: { type: 'string', description: 'Reaction type' },
    reaction_id: { type: 'number', description: 'Reaction ID' },
    // Pagination parameters
    page: { type: 'number', description: 'Page number for pagination' },
  },
  outputs: {
    content: { type: 'string', description: 'Response content' },
    metadata: { type: 'json', description: 'Response metadata' },
    // Trigger outputs
    action: { type: 'string', description: 'The action that was performed' },
    event_type: { type: 'string', description: 'Type of GitHub event' },
    repository: { type: 'string', description: 'Repository full name' },
    repository_name: { type: 'string', description: 'Repository name only' },
    repository_owner: { type: 'string', description: 'Repository owner username' },
    sender: { type: 'string', description: 'Username of the user who triggered the event' },
    sender_id: { type: 'string', description: 'User ID of the sender' },
    ref: { type: 'string', description: 'Git reference (for push events)' },
    before: { type: 'string', description: 'SHA of the commit before the push' },
    after: { type: 'string', description: 'SHA of the commit after the push' },
    commits: { type: 'string', description: 'Array of commit objects (for push events)' },
    pull_request: { type: 'string', description: 'Pull request object (for pull_request events)' },
    issue: { type: 'string', description: 'Issue object (for issues events)' },
    comment: { type: 'string', description: 'Comment object (for comment events)' },
    branch: { type: 'string', description: 'Branch name extracted from ref' },
    commit_message: { type: 'string', description: 'Latest commit message' },
    commit_author: { type: 'string', description: 'Author of the latest commit' },
  },
  triggers: {
    enabled: true,
    available: [
      'github_issue_opened',
      'github_issue_closed',
      'github_issue_comment',
      'github_pr_opened',
      'github_pr_closed',
      'github_pr_merged',
      'github_pr_comment',
      'github_pr_reviewed',
      'github_push',
      'github_release_published',
      'github_workflow_run',
    ],
  },
}

export const GitHubV2Block: BlockConfig<GitHubResponse> = {
  ...GitHubBlock,
  type: 'github_v2',
  name: 'GitHub',
  hideFromToolbar: false,
  tools: {
    ...GitHubBlock.tools,
    access: (GitHubBlock.tools?.access || []).map((toolId) => `${toolId}_v2`),
    config: {
      ...GitHubBlock.tools?.config,
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => (GitHubBlock.tools?.config as any)?.tool(params),
        suffix: '_v2',
        fallbackToolId: 'github_create_issue_v2',
      }),
      params: (GitHubBlock.tools?.config as any)?.params,
    },
  },
  outputs: {
    data: { type: 'json', description: 'Operation result data (API-aligned)' },

    // Trigger outputs (unchanged)
    action: { type: 'string', description: 'The action that was performed' },
    event_type: { type: 'string', description: 'Type of GitHub event' },
    repository: { type: 'string', description: 'Repository full name' },
    repository_name: { type: 'string', description: 'Repository name only' },
    repository_owner: { type: 'string', description: 'Repository owner username' },
    sender: { type: 'string', description: 'Username of the user who triggered the event' },
    sender_id: { type: 'string', description: 'User ID of the sender' },
    ref: { type: 'string', description: 'Git reference (for push events)' },
    before: { type: 'string', description: 'SHA of the commit before the push' },
    after: { type: 'string', description: 'SHA of the commit after the push' },
    commits: { type: 'string', description: 'Array of commit objects (for push events)' },
    pull_request: { type: 'string', description: 'Pull request object (for pull_request events)' },
    issue: { type: 'string', description: 'Issue object (for issues events)' },
    comment: { type: 'string', description: 'Comment object (for comment events)' },
    branch: { type: 'string', description: 'Branch name extracted from ref' },
    commit_message: { type: 'string', description: 'Latest commit message' },
    commit_author: { type: 'string', description: 'Author of the latest commit' },
  },
}
