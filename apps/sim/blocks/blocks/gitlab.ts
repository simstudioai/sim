import { GitLabIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { GitLabResponse } from '@/tools/gitlab/types'
import { getTrigger } from '@/triggers'

/**
 * Access/membership operations scoped to a project OR group. These take a
 * `resourceType` (Project | Group) plus a `resourceId`.
 */
const RESOURCE_SCOPED_OPS = [
  'gitlab_list_members',
  'gitlab_add_member',
  'gitlab_update_member',
  'gitlab_remove_member',
  'gitlab_invite_member',
  'gitlab_list_invitations',
  'gitlab_update_invitation',
  'gitlab_revoke_invitation',
  'gitlab_list_access_requests',
  'gitlab_approve_access_request',
  'gitlab_deny_access_request',
]

/** Operations that require a target user ID (member target or admin user target). */
const USER_ID_OPS = [
  'gitlab_add_member',
  'gitlab_update_member',
  'gitlab_remove_member',
  'gitlab_approve_access_request',
  'gitlab_deny_access_request',
  'gitlab_update_user',
  'gitlab_delete_user',
  'gitlab_block_user',
  'gitlab_unblock_user',
  'gitlab_deactivate_user',
  'gitlab_activate_user',
  'gitlab_ban_user',
  'gitlab_unban_user',
  'gitlab_approve_user',
  'gitlab_reject_user',
  'gitlab_delete_user_identity',
]

/** Operations that take a named access-level dropdown (required unless noted). */
const ACCESS_LEVEL_OPS = [
  'gitlab_add_member',
  'gitlab_update_member',
  'gitlab_invite_member',
  'gitlab_approve_access_request',
  'gitlab_add_saml_group_link',
]

/** Operations where the access level is required (approve/invitation update are optional). */
const ACCESS_LEVEL_REQUIRED_OPS = [
  'gitlab_add_member',
  'gitlab_update_member',
  'gitlab_invite_member',
  'gitlab_add_saml_group_link',
]

/** Operations that support an access-expiration date. */
const EXPIRES_AT_OPS = [
  'gitlab_add_member',
  'gitlab_update_member',
  'gitlab_invite_member',
  'gitlab_update_invitation',
]

/** Operations that support a custom member role ID (Ultimate). */
const MEMBER_ROLE_OPS = [
  'gitlab_add_member',
  'gitlab_update_member',
  'gitlab_invite_member',
  'gitlab_add_saml_group_link',
]

/** Operations that take an email address. */
const EMAIL_OPS = ['gitlab_invite_member', 'gitlab_update_invitation', 'gitlab_revoke_invitation']

/** Group-only SAML group link operations that take a group ID. */
const SAML_LINK_OPS = [
  'gitlab_list_saml_group_links',
  'gitlab_add_saml_group_link',
  'gitlab_delete_saml_group_link',
]

/** SAML operations that take a SAML group name. */
const SAML_NAME_OPS = ['gitlab_add_saml_group_link', 'gitlab_delete_saml_group_link']

export const GitLabBlock: BlockConfig<GitLabResponse> = {
  type: 'gitlab',
  name: 'GitLab',
  description: 'Interact with GitLab projects, issues, merge requests, and pipelines',
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  longDescription:
    'Integrate GitLab into the workflow. Can manage projects, issues, merge requests, pipelines, and add comments, plus project/group membership, invitations, access requests, SAML group links, and instance user administration. Supports all core GitLab DevOps operations.',
  docsLink: 'https://docs.sim.ai/integrations/gitlab',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  icon: GitLabIcon,
  bgColor: '#FFFFFF',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Project Operations
        { label: 'List Projects', id: 'gitlab_list_projects' },
        { label: 'Get Project', id: 'gitlab_get_project' },
        // Issue Operations
        { label: 'List Issues', id: 'gitlab_list_issues' },
        { label: 'Get Issue', id: 'gitlab_get_issue' },
        { label: 'Create Issue', id: 'gitlab_create_issue' },
        { label: 'Update Issue', id: 'gitlab_update_issue' },
        { label: 'Delete Issue', id: 'gitlab_delete_issue' },
        { label: 'Add Issue Comment', id: 'gitlab_create_issue_note' },
        // Merge Request Operations
        { label: 'List Merge Requests', id: 'gitlab_list_merge_requests' },
        { label: 'Get Merge Request', id: 'gitlab_get_merge_request' },
        { label: 'Create Merge Request', id: 'gitlab_create_merge_request' },
        { label: 'Update Merge Request', id: 'gitlab_update_merge_request' },
        { label: 'Merge Merge Request', id: 'gitlab_merge_merge_request' },
        { label: 'Add MR Comment', id: 'gitlab_create_merge_request_note' },
        // Pipeline Operations
        { label: 'List Pipelines', id: 'gitlab_list_pipelines' },
        { label: 'Get Pipeline', id: 'gitlab_get_pipeline' },
        { label: 'Create Pipeline', id: 'gitlab_create_pipeline' },
        { label: 'Retry Pipeline', id: 'gitlab_retry_pipeline' },
        { label: 'Cancel Pipeline', id: 'gitlab_cancel_pipeline' },
        // Repository Operations
        { label: 'List Repository Tree', id: 'gitlab_list_repository_tree' },
        { label: 'Get File', id: 'gitlab_get_file' },
        { label: 'Create File', id: 'gitlab_create_file' },
        { label: 'Update File', id: 'gitlab_update_file' },
        { label: 'List Commits', id: 'gitlab_list_commits' },
        { label: 'List Branches', id: 'gitlab_list_branches' },
        { label: 'Create Branch', id: 'gitlab_create_branch' },
        { label: 'Delete Branch', id: 'gitlab_delete_branch' },
        { label: 'Compare Branches', id: 'gitlab_compare_branches' },
        // Additional Merge Request Operations
        { label: 'Get MR Changes', id: 'gitlab_get_merge_request_changes' },
        { label: 'Approve Merge Request', id: 'gitlab_approve_merge_request' },
        // Job Operations
        { label: 'List Pipeline Jobs', id: 'gitlab_list_pipeline_jobs' },
        { label: 'Get Job Log', id: 'gitlab_get_job_log' },
        { label: 'Play Job', id: 'gitlab_play_job' },
        // Release Operations
        { label: 'List Releases', id: 'gitlab_list_releases' },
        { label: 'Create Release', id: 'gitlab_create_release' },
        // Access / Membership Operations
        { label: 'List Members', id: 'gitlab_list_members' },
        { label: 'Add Member', id: 'gitlab_add_member' },
        { label: 'Update Member', id: 'gitlab_update_member' },
        { label: 'Remove Member', id: 'gitlab_remove_member' },
        { label: 'Invite Member by Email', id: 'gitlab_invite_member' },
        { label: 'List Invitations', id: 'gitlab_list_invitations' },
        { label: 'Update Invitation', id: 'gitlab_update_invitation' },
        { label: 'Revoke Invitation', id: 'gitlab_revoke_invitation' },
        { label: 'List Access Requests', id: 'gitlab_list_access_requests' },
        { label: 'Approve Access Request', id: 'gitlab_approve_access_request' },
        { label: 'Deny Access Request', id: 'gitlab_deny_access_request' },
        { label: 'List SAML Group Links', id: 'gitlab_list_saml_group_links' },
        { label: 'Search Users', id: 'gitlab_search_users' },
        // User Administration Operations (require an admin token)
        { label: 'Create User', id: 'gitlab_create_user' },
        { label: 'Update User', id: 'gitlab_update_user' },
        { label: 'Delete User', id: 'gitlab_delete_user' },
        { label: 'Block User', id: 'gitlab_block_user' },
        { label: 'Unblock User', id: 'gitlab_unblock_user' },
        { label: 'Deactivate User', id: 'gitlab_deactivate_user' },
        { label: 'Activate User', id: 'gitlab_activate_user' },
        { label: 'Ban User', id: 'gitlab_ban_user' },
        { label: 'Unban User', id: 'gitlab_unban_user' },
        { label: 'Approve User Signup', id: 'gitlab_approve_user' },
        { label: 'Reject User Signup', id: 'gitlab_reject_user' },
        { label: 'Delete User Identity', id: 'gitlab_delete_user_identity' },
        { label: 'Add SAML Group Link', id: 'gitlab_add_saml_group_link' },
        { label: 'Delete SAML Group Link', id: 'gitlab_delete_saml_group_link' },
      ],
      value: () => 'gitlab_list_projects',
    },
    {
      id: 'accessToken',
      title: 'Personal Access Token',
      type: 'short-input',
      placeholder: 'Enter your GitLab Personal Access Token',
      password: true,
      required: true,
    },
    // Self-managed GitLab host (defaults to gitlab.com)
    {
      id: 'host',
      title: 'GitLab Host',
      type: 'short-input',
      placeholder: 'gitlab.com',
      mode: 'advanced',
      description: 'Self-managed GitLab host. Leave blank for gitlab.com.',
    },
    // Project ID (required for most operations)
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter project ID or path (e.g., username/project)',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'gitlab_get_project',
          'gitlab_list_issues',
          'gitlab_get_issue',
          'gitlab_create_issue',
          'gitlab_update_issue',
          'gitlab_delete_issue',
          'gitlab_create_issue_note',
          'gitlab_list_merge_requests',
          'gitlab_get_merge_request',
          'gitlab_create_merge_request',
          'gitlab_update_merge_request',
          'gitlab_merge_merge_request',
          'gitlab_create_merge_request_note',
          'gitlab_list_pipelines',
          'gitlab_get_pipeline',
          'gitlab_create_pipeline',
          'gitlab_retry_pipeline',
          'gitlab_cancel_pipeline',
          'gitlab_list_repository_tree',
          'gitlab_get_file',
          'gitlab_create_file',
          'gitlab_update_file',
          'gitlab_list_commits',
          'gitlab_list_branches',
          'gitlab_create_branch',
          'gitlab_delete_branch',
          'gitlab_compare_branches',
          'gitlab_get_merge_request_changes',
          'gitlab_approve_merge_request',
          'gitlab_list_pipeline_jobs',
          'gitlab_get_job_log',
          'gitlab_play_job',
          'gitlab_list_releases',
          'gitlab_create_release',
        ],
      },
    },
    // Issue Number (IID) - the # shown in GitLab UI
    {
      id: 'issueIid',
      title: 'Issue Number',
      type: 'short-input',
      placeholder: 'Enter issue number (e.g., 1 for issue #1)',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'gitlab_get_issue',
          'gitlab_update_issue',
          'gitlab_delete_issue',
          'gitlab_create_issue_note',
        ],
      },
    },
    // Merge Request Number (IID) - the ! number shown in GitLab UI
    {
      id: 'mergeRequestIid',
      title: 'MR Number',
      type: 'short-input',
      placeholder: 'Enter MR number (e.g., 1 for !1)',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'gitlab_get_merge_request',
          'gitlab_update_merge_request',
          'gitlab_merge_merge_request',
          'gitlab_create_merge_request_note',
          'gitlab_get_merge_request_changes',
          'gitlab_approve_merge_request',
        ],
      },
    },
    // Pipeline ID
    {
      id: 'pipelineId',
      title: 'Pipeline ID',
      type: 'short-input',
      placeholder: 'Enter pipeline ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'gitlab_get_pipeline',
          'gitlab_retry_pipeline',
          'gitlab_cancel_pipeline',
          'gitlab_list_pipeline_jobs',
        ],
      },
    },
    // Title (for issue/MR creation)
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Enter title',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_issue', 'gitlab_create_merge_request'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, descriptive title for a GitLab issue or merge request based on the user's request.
The title should be concise but informative.

Return ONLY the title - no explanations, no extra text.`,
        placeholder: 'Describe the issue or merge request...',
      },
    },
    // Description
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Enter description (Markdown supported)',
      condition: {
        field: 'operation',
        value: [
          'gitlab_create_issue',
          'gitlab_update_issue',
          'gitlab_create_merge_request',
          'gitlab_update_merge_request',
          'gitlab_create_release',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comprehensive description for a GitLab issue, merge request, or release based on the user's request.
Include relevant sections as appropriate:
- Summary of changes or problem
- Context and motivation
- Testing done (for MRs)
- Steps to reproduce (for bugs)
- Highlights and notable changes (for releases)

Use Markdown formatting for readability.

Return ONLY the description - no explanations outside the content.`,
        placeholder: 'Describe the content in detail...',
      },
    },
    // Comment body
    {
      id: 'body',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Enter comment text (Markdown supported)',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_issue_note', 'gitlab_create_merge_request_note'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a helpful GitLab comment based on the user's request.
The comment should be clear, constructive, and professional.
Use Markdown formatting for readability.

Return ONLY the comment text - no explanations, no extra formatting.`,
        placeholder: 'Describe the comment you want to write...',
      },
    },
    // Source branch (for MR creation)
    {
      id: 'sourceBranch',
      title: 'Source Branch',
      type: 'short-input',
      placeholder: 'Enter source branch name',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_merge_request'],
      },
    },
    // Target branch (for MR creation)
    {
      id: 'targetBranch',
      title: 'Target Branch',
      type: 'short-input',
      placeholder: 'Enter target branch name (e.g., main)',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_merge_request'],
      },
    },
    // Ref (for pipeline creation)
    {
      id: 'ref',
      title: 'Branch/Tag',
      type: 'short-input',
      placeholder: 'Enter branch or tag name',
      required: {
        field: 'operation',
        value: ['gitlab_create_pipeline', 'gitlab_get_file', 'gitlab_create_branch'],
      },
      condition: {
        field: 'operation',
        value: [
          'gitlab_create_pipeline',
          'gitlab_get_file',
          'gitlab_create_branch',
          'gitlab_create_release',
        ],
      },
    },
    // File Path
    {
      id: 'filePath',
      title: 'File Path',
      type: 'short-input',
      placeholder: 'Path to file (e.g., src/index.ts)',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_get_file', 'gitlab_create_file', 'gitlab_update_file'],
      },
    },
    // Branch
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'Branch name',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'gitlab_create_file',
          'gitlab_update_file',
          'gitlab_create_branch',
          'gitlab_delete_branch',
        ],
      },
    },
    // Compare from ref
    {
      id: 'compareFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Branch, tag, or commit SHA to compare from',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_compare_branches'],
      },
    },
    // Compare to ref
    {
      id: 'compareTo',
      title: 'To',
      type: 'short-input',
      placeholder: 'Branch, tag, or commit SHA to compare to',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_compare_branches'],
      },
    },
    // Compare directly instead of using merge base
    {
      id: 'straight',
      title: 'Compare Directly',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_compare_branches'],
      },
    },
    // Release tag name
    {
      id: 'tagName',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'Enter the Git tag for the release (e.g., v1.0.0)',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_release'],
      },
    },
    // Release name
    {
      id: 'releaseName',
      title: 'Release Name',
      type: 'short-input',
      placeholder: 'Enter release name (optional)',
      condition: {
        field: 'operation',
        value: ['gitlab_create_release'],
      },
    },
    // Release date
    {
      id: 'releasedAt',
      title: 'Released At',
      type: 'short-input',
      placeholder: 'ISO 8601 date for an upcoming or historical release (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_release'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description of when the release happened or will happen.

Return ONLY the timestamp string - no explanations, no extra text.`,
        generationType: 'timestamp',
        placeholder: 'Describe when the release happened...',
      },
    },
    // Release milestones
    {
      id: 'releaseMilestones',
      title: 'Milestones',
      type: 'short-input',
      placeholder: 'Milestone titles (comma-separated, optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_release'],
      },
    },
    // File Content
    {
      id: 'content',
      title: 'File Content',
      type: 'long-input',
      placeholder: 'File content',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_file', 'gitlab_update_file'],
      },
    },
    // Commit Message
    {
      id: 'commitMessage',
      title: 'Commit Message',
      type: 'short-input',
      placeholder: 'Commit message',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_create_file', 'gitlab_update_file'],
      },
    },
    // Job ID
    {
      id: 'jobId',
      title: 'Job ID',
      type: 'short-input',
      placeholder: 'Enter job ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_get_job_log', 'gitlab_play_job'],
      },
    },
    // Subdirectory path (for repository tree)
    {
      id: 'path',
      title: 'Path',
      type: 'short-input',
      placeholder: 'Subdirectory path (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_repository_tree'],
      },
    },
    // Recursive tree listing
    {
      id: 'recursive',
      title: 'Recursive',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_repository_tree'],
      },
    },
    // Ref name filter (for list commits)
    {
      id: 'refName',
      title: 'Ref (branch/tag)',
      type: 'short-input',
      placeholder: 'Branch or tag (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_commits'],
      },
    },
    // Job scope filter (for list pipeline jobs)
    {
      id: 'scope',
      title: 'Job Scope',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Failed', id: 'failed' },
        { label: 'Success', id: 'success' },
        { label: 'Running', id: 'running' },
        { label: 'Pending', id: 'pending' },
        { label: 'Canceled', id: 'canceled' },
        { label: 'Manual', id: 'manual' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_pipeline_jobs'],
      },
    },
    // Commit SHA (for approve merge request)
    {
      id: 'sha',
      title: 'Commit SHA',
      type: 'short-input',
      placeholder: 'Optional HEAD SHA to approve',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_approve_merge_request'],
      },
    },
    // Labels
    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'Enter labels (comma-separated)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'gitlab_create_issue',
          'gitlab_update_issue',
          'gitlab_list_issues',
          'gitlab_create_merge_request',
          'gitlab_update_merge_request',
          'gitlab_list_merge_requests',
        ],
      },
    },
    // Assignee IDs
    {
      id: 'assigneeIds',
      title: 'Assignee IDs',
      type: 'short-input',
      placeholder: 'Enter assignee user IDs (comma-separated)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'gitlab_create_issue',
          'gitlab_update_issue',
          'gitlab_create_merge_request',
          'gitlab_update_merge_request',
        ],
      },
    },
    // Milestone ID
    {
      id: 'milestoneId',
      title: 'Milestone ID',
      type: 'short-input',
      placeholder: 'Enter milestone ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_issue', 'gitlab_update_issue'],
      },
    },
    // State filter for issues
    {
      id: 'issueState',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Open', id: 'opened' },
        { label: 'Closed', id: 'closed' },
      ],
      value: () => 'all',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_issues'],
      },
    },
    // State filter for merge requests
    {
      id: 'mrState',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Open', id: 'opened' },
        { label: 'Closed', id: 'closed' },
        { label: 'Merged', id: 'merged' },
      ],
      value: () => 'all',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_merge_requests'],
      },
    },
    // State event (for updates)
    {
      id: 'stateEvent',
      title: 'State Event',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Close', id: 'close' },
        { label: 'Reopen', id: 'reopen' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_update_issue', 'gitlab_update_merge_request'],
      },
    },
    // Pipeline status filter
    {
      id: 'pipelineStatus',
      title: 'Pipeline Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Running', id: 'running' },
        { label: 'Pending', id: 'pending' },
        { label: 'Success', id: 'success' },
        { label: 'Failed', id: 'failed' },
        { label: 'Canceled', id: 'canceled' },
        { label: 'Skipped', id: 'skipped' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_pipelines'],
      },
    },
    // Remove source branch after merge
    {
      id: 'removeSourceBranch',
      title: 'Remove Source Branch',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_merge_request', 'gitlab_merge_merge_request'],
      },
    },
    // Squash commits
    {
      id: 'squash',
      title: 'Squash Commits',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_merge_merge_request'],
      },
    },
    // Merge commit message
    {
      id: 'mergeCommitMessage',
      title: 'Merge Commit Message',
      type: 'long-input',
      placeholder: 'Enter custom merge commit message (optional)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_merge_merge_request'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear merge commit message based on the user's request.
The message should summarize what is being merged and why.

Return ONLY the commit message - no explanations, no extra text.`,
        placeholder: 'Describe the merge...',
      },
    },
    // Per page (pagination)
    {
      id: 'perPage',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: 'Number of results per page (default: 20, max: 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'gitlab_list_projects',
          'gitlab_list_issues',
          'gitlab_list_merge_requests',
          'gitlab_list_pipelines',
          'gitlab_list_repository_tree',
          'gitlab_list_branches',
          'gitlab_list_commits',
          'gitlab_list_pipeline_jobs',
          'gitlab_list_releases',
          'gitlab_list_members',
          'gitlab_list_invitations',
          'gitlab_list_access_requests',
          'gitlab_search_users',
        ],
      },
    },
    // Page number
    {
      id: 'page',
      title: 'Page Number',
      type: 'short-input',
      placeholder: 'Page number (default: 1)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'gitlab_list_projects',
          'gitlab_list_issues',
          'gitlab_list_merge_requests',
          'gitlab_list_pipelines',
          'gitlab_list_repository_tree',
          'gitlab_list_branches',
          'gitlab_list_commits',
          'gitlab_list_pipeline_jobs',
          'gitlab_list_releases',
          'gitlab_list_members',
          'gitlab_list_invitations',
          'gitlab_list_access_requests',
          'gitlab_search_users',
        ],
      },
    },
    // Resource type (project or group) for access/membership operations
    {
      id: 'resourceType',
      title: 'Resource Type',
      type: 'dropdown',
      options: [
        { label: 'Project', id: 'project' },
        { label: 'Group', id: 'group' },
      ],
      value: () => 'project',
      required: true,
      condition: {
        field: 'operation',
        value: RESOURCE_SCOPED_OPS,
      },
    },
    // Project / group ID for access/membership operations
    {
      id: 'resourceId',
      title: 'Project / Group ID',
      type: 'short-input',
      placeholder: 'Enter project or group ID or path (e.g., mygroup/myproject)',
      required: true,
      condition: {
        field: 'operation',
        value: RESOURCE_SCOPED_OPS,
      },
    },
    // Group ID for SAML group link operations (group-scoped only)
    {
      id: 'groupId',
      title: 'Group ID',
      type: 'short-input',
      placeholder: 'Enter group ID or path',
      required: true,
      condition: {
        field: 'operation',
        value: SAML_LINK_OPS,
      },
    },
    // User ID (member target or admin user target)
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter the user ID',
      required: true,
      condition: {
        field: 'operation',
        value: USER_ID_OPS,
      },
    },
    // Access level (named dropdown mapping to GitLab integer access levels)
    {
      id: 'accessLevel',
      title: 'Access Level',
      type: 'dropdown',
      options: [
        { label: 'No access', id: '0' },
        { label: 'Minimal Access', id: '5' },
        { label: 'Guest', id: '10' },
        { label: 'Planner', id: '15' },
        { label: 'Reporter', id: '20' },
        { label: 'Security Manager', id: '25' },
        { label: 'Developer', id: '30' },
        { label: 'Maintainer', id: '40' },
        { label: 'Owner', id: '50' },
      ],
      value: () => '30',
      required: {
        field: 'operation',
        value: ACCESS_LEVEL_REQUIRED_OPS,
      },
      condition: {
        field: 'operation',
        value: ACCESS_LEVEL_OPS,
      },
    },
    // Optional access level for Update Invitation. Defaults to "Leave unchanged"
    // so updating only the expiration does not silently reset the access level.
    {
      id: 'invitationAccessLevel',
      title: 'Access Level',
      type: 'dropdown',
      options: [
        { label: 'Leave unchanged', id: '' },
        { label: 'No access', id: '0' },
        { label: 'Minimal Access', id: '5' },
        { label: 'Guest', id: '10' },
        { label: 'Planner', id: '15' },
        { label: 'Reporter', id: '20' },
        { label: 'Security Manager', id: '25' },
        { label: 'Developer', id: '30' },
        { label: 'Maintainer', id: '40' },
        { label: 'Owner', id: '50' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['gitlab_update_invitation'],
      },
    },
    // Access expiration date (first-class time-boxed grants)
    {
      id: 'expiresAt',
      title: 'Expires At',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (optional) - access is revoked on this date',
      condition: {
        field: 'operation',
        value: EXPIRES_AT_OPS,
      },
    },
    // Custom member role ID (GitLab Ultimate)
    {
      id: 'memberRoleId',
      title: 'Member Role ID',
      type: 'short-input',
      placeholder: 'Custom role ID (GitLab Ultimate only)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: MEMBER_ROLE_OPS,
      },
    },
    // Email address (invitations)
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email address (comma-separated for multiple invites)',
      required: true,
      condition: {
        field: 'operation',
        value: EMAIL_OPS,
      },
    },
    // Filter for member / invitation listings
    {
      id: 'query',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'Filter members by name/username, or invitations by email',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_list_members', 'gitlab_list_invitations'],
      },
    },
    // Direct members only toggle (list members)
    {
      id: 'directMembersOnly',
      title: 'Direct Members Only',
      type: 'switch',
      mode: 'advanced',
      description: 'Exclude members inherited from ancestor groups',
      condition: {
        field: 'operation',
        value: ['gitlab_list_members'],
      },
    },
    // User search query
    {
      id: 'userSearch',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Name, username, or email to search for',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_search_users'],
      },
    },
    // SAML group name
    {
      id: 'samlGroupName',
      title: 'SAML Group Name',
      type: 'short-input',
      placeholder: 'Name of the SAML group as sent by the identity provider',
      required: true,
      condition: {
        field: 'operation',
        value: SAML_NAME_OPS,
      },
    },
    // SAML provider name (add/delete SAML group link)
    {
      id: 'samlProvider',
      title: 'SAML Provider',
      type: 'short-input',
      placeholder: 'Provider name (required when multiple links share a group name)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: SAML_NAME_OPS,
      },
    },
    // Provider (delete user identity)
    {
      id: 'provider',
      title: 'Identity Provider',
      type: 'short-input',
      placeholder: 'e.g., saml, ldapmain',
      required: true,
      condition: {
        field: 'operation',
        value: ['gitlab_delete_user_identity'],
      },
    },
    // Hard delete toggle (delete user)
    {
      id: 'hardDelete',
      title: 'Hard Delete',
      type: 'switch',
      mode: 'advanced',
      description:
        'Delete contributions and personal projects instead of moving them to a Ghost User',
      condition: {
        field: 'operation',
        value: ['gitlab_delete_user'],
      },
    },
    // User attributes (create/update user)
    {
      id: 'userAdminEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: "The user's email address",
      required: {
        field: 'operation',
        value: ['gitlab_create_user'],
      },
      condition: {
        field: 'operation',
        value: ['gitlab_create_user', 'gitlab_update_user'],
      },
    },
    {
      id: 'userAdminUsername',
      title: 'Username',
      type: 'short-input',
      placeholder: "The user's username",
      required: {
        field: 'operation',
        value: ['gitlab_create_user'],
      },
      condition: {
        field: 'operation',
        value: ['gitlab_create_user', 'gitlab_update_user'],
      },
    },
    {
      id: 'userAdminName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: "The user's display name",
      required: {
        field: 'operation',
        value: ['gitlab_create_user'],
      },
      condition: {
        field: 'operation',
        value: ['gitlab_create_user', 'gitlab_update_user'],
      },
    },
    {
      id: 'userAdminPassword',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'Password (omit and enable Send Reset Link instead)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_user'],
      },
    },
    {
      id: 'resetPassword',
      title: 'Send Password Reset Link',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_user'],
      },
    },
    {
      id: 'skipConfirmation',
      title: 'Skip Email Confirmation',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['gitlab_create_user'],
      },
    },
    {
      id: 'userAdminIsAdmin',
      title: 'Administrator',
      type: 'switch',
      mode: 'advanced',
      description: 'Whether the user is an instance administrator',
      condition: {
        field: 'operation',
        value: ['gitlab_create_user', 'gitlab_update_user'],
      },
    },
    ...getTrigger('gitlab_push').subBlocks,
    ...getTrigger('gitlab_merge_request').subBlocks,
    ...getTrigger('gitlab_issue').subBlocks,
    ...getTrigger('gitlab_pipeline').subBlocks,
    ...getTrigger('gitlab_comment').subBlocks,
    ...getTrigger('gitlab_webhook').subBlocks,
  ],
  tools: {
    access: [
      'gitlab_list_projects',
      'gitlab_get_project',
      'gitlab_list_issues',
      'gitlab_get_issue',
      'gitlab_create_issue',
      'gitlab_update_issue',
      'gitlab_delete_issue',
      'gitlab_create_issue_note',
      'gitlab_list_merge_requests',
      'gitlab_get_merge_request',
      'gitlab_create_merge_request',
      'gitlab_update_merge_request',
      'gitlab_merge_merge_request',
      'gitlab_create_merge_request_note',
      'gitlab_list_pipelines',
      'gitlab_get_pipeline',
      'gitlab_create_pipeline',
      'gitlab_retry_pipeline',
      'gitlab_cancel_pipeline',
      'gitlab_list_repository_tree',
      'gitlab_get_file',
      'gitlab_create_file',
      'gitlab_update_file',
      'gitlab_create_branch',
      'gitlab_delete_branch',
      'gitlab_compare_branches',
      'gitlab_list_branches',
      'gitlab_list_commits',
      'gitlab_get_merge_request_changes',
      'gitlab_approve_merge_request',
      'gitlab_list_pipeline_jobs',
      'gitlab_get_job_log',
      'gitlab_play_job',
      'gitlab_list_releases',
      'gitlab_create_release',
      'gitlab_list_members',
      'gitlab_add_member',
      'gitlab_update_member',
      'gitlab_remove_member',
      'gitlab_invite_member',
      'gitlab_list_invitations',
      'gitlab_update_invitation',
      'gitlab_revoke_invitation',
      'gitlab_list_access_requests',
      'gitlab_approve_access_request',
      'gitlab_deny_access_request',
      'gitlab_list_saml_group_links',
      'gitlab_search_users',
      'gitlab_create_user',
      'gitlab_update_user',
      'gitlab_delete_user',
      'gitlab_block_user',
      'gitlab_unblock_user',
      'gitlab_deactivate_user',
      'gitlab_activate_user',
      'gitlab_ban_user',
      'gitlab_unban_user',
      'gitlab_approve_user',
      'gitlab_reject_user',
      'gitlab_delete_user_identity',
      'gitlab_add_saml_group_link',
      'gitlab_delete_saml_group_link',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'gitlab_list_projects'
      },
      params: (params) => {
        const baseParams: Record<string, any> = {
          accessToken: params.accessToken,
          host: params.host?.trim() || undefined,
        }

        switch (params.operation) {
          case 'gitlab_list_projects':
            return {
              ...baseParams,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_project':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
            }

          case 'gitlab_list_issues':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              state: params.issueState !== 'all' ? params.issueState : undefined,
              labels: params.labels?.trim() || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_issue':
            if (!params.projectId?.trim() || !params.issueIid) {
              throw new Error('Project ID and Issue Number are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              issueIid: Number(params.issueIid),
            }

          case 'gitlab_create_issue':
            if (!params.projectId?.trim() || !params.title?.trim()) {
              throw new Error('Project ID and title are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              title: params.title.trim(),
              description: params.description?.trim() || undefined,
              labels: params.labels?.trim() || undefined,
              assigneeIds: params.assigneeIds
                ? params.assigneeIds.split(',').map((id: string) => Number(id.trim()))
                : undefined,
              milestoneId: params.milestoneId ? Number(params.milestoneId) : undefined,
            }

          case 'gitlab_update_issue':
            if (!params.projectId?.trim() || !params.issueIid) {
              throw new Error('Project ID and Issue IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              issueIid: Number(params.issueIid),
              title: params.title?.trim() || undefined,
              description: params.description?.trim() || undefined,
              labels: params.labels?.trim() || undefined,
              assigneeIds: params.assigneeIds
                ? params.assigneeIds.split(',').map((id: string) => Number(id.trim()))
                : undefined,
              stateEvent: params.stateEvent || undefined,
            }

          case 'gitlab_delete_issue':
            if (!params.projectId?.trim() || !params.issueIid) {
              throw new Error('Project ID and Issue IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              issueIid: Number(params.issueIid),
            }

          case 'gitlab_create_issue_note':
            if (!params.projectId?.trim() || !params.issueIid || !params.body?.trim()) {
              throw new Error('Project ID, Issue IID, and comment body are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              issueIid: Number(params.issueIid),
              body: params.body.trim(),
            }

          case 'gitlab_list_merge_requests':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              state: params.mrState !== 'all' ? params.mrState : undefined,
              labels: params.labels?.trim() || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_merge_request':
            if (!params.projectId?.trim() || !params.mergeRequestIid) {
              throw new Error('Project ID and Merge Request IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              mergeRequestIid: Number(params.mergeRequestIid),
            }

          case 'gitlab_create_merge_request':
            if (
              !params.projectId?.trim() ||
              !params.title?.trim() ||
              !params.sourceBranch?.trim() ||
              !params.targetBranch?.trim()
            ) {
              throw new Error('Project ID, title, source branch, and target branch are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              title: params.title.trim(),
              sourceBranch: params.sourceBranch.trim(),
              targetBranch: params.targetBranch.trim(),
              description: params.description?.trim() || undefined,
              labels: params.labels?.trim() || undefined,
              assigneeIds: params.assigneeIds
                ? params.assigneeIds.split(',').map((id: string) => Number(id.trim()))
                : undefined,
              removeSourceBranch: params.removeSourceBranch || undefined,
            }

          case 'gitlab_update_merge_request':
            if (!params.projectId?.trim() || !params.mergeRequestIid) {
              throw new Error('Project ID and Merge Request IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              mergeRequestIid: Number(params.mergeRequestIid),
              title: params.title?.trim() || undefined,
              description: params.description?.trim() || undefined,
              labels: params.labels?.trim() || undefined,
              assigneeIds: params.assigneeIds
                ? params.assigneeIds.split(',').map((id: string) => Number(id.trim()))
                : undefined,
              stateEvent: params.stateEvent || undefined,
            }

          case 'gitlab_merge_merge_request':
            if (!params.projectId?.trim() || !params.mergeRequestIid) {
              throw new Error('Project ID and Merge Request IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              mergeRequestIid: Number(params.mergeRequestIid),
              mergeCommitMessage: params.mergeCommitMessage?.trim() || undefined,
              squash: params.squash || undefined,
              shouldRemoveSourceBranch: params.removeSourceBranch || undefined,
            }

          case 'gitlab_create_merge_request_note':
            if (!params.projectId?.trim() || !params.mergeRequestIid || !params.body?.trim()) {
              throw new Error('Project ID, Merge Request IID, and comment body are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              mergeRequestIid: Number(params.mergeRequestIid),
              body: params.body.trim(),
            }

          case 'gitlab_list_pipelines':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              status: params.pipelineStatus || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_pipeline':
            if (!params.projectId?.trim() || !params.pipelineId) {
              throw new Error('Project ID and Pipeline ID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              pipelineId: Number(params.pipelineId),
            }

          case 'gitlab_create_pipeline':
            if (!params.projectId?.trim() || !params.ref?.trim()) {
              throw new Error('Project ID and branch/tag ref are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              ref: params.ref.trim(),
            }

          case 'gitlab_retry_pipeline':
          case 'gitlab_cancel_pipeline':
            if (!params.projectId?.trim() || !params.pipelineId) {
              throw new Error('Project ID and Pipeline ID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              pipelineId: Number(params.pipelineId),
            }

          case 'gitlab_list_repository_tree':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              path: params.path?.trim() || undefined,
              recursive: params.recursive || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_file':
            if (!params.projectId?.trim() || !params.filePath?.trim() || !params.ref?.trim()) {
              throw new Error('Project ID, file path, and ref are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              filePath: params.filePath.trim(),
              ref: params.ref.trim(),
            }

          case 'gitlab_create_file':
          case 'gitlab_update_file':
            if (
              !params.projectId?.trim() ||
              !params.filePath?.trim() ||
              !params.branch?.trim() ||
              !params.content ||
              !params.commitMessage?.trim()
            ) {
              throw new Error(
                'Project ID, file path, branch, content, and commit message are required.'
              )
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              filePath: params.filePath.trim(),
              branch: params.branch.trim(),
              content: params.content,
              commitMessage: params.commitMessage.trim(),
            }

          case 'gitlab_create_branch':
            if (!params.projectId?.trim() || !params.branch?.trim() || !params.ref?.trim()) {
              throw new Error('Project ID, branch name, and source ref are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              branch: params.branch.trim(),
              ref: params.ref.trim(),
            }

          case 'gitlab_list_branches':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_delete_branch':
            if (!params.projectId?.trim() || !params.branch?.trim()) {
              throw new Error('Project ID and branch name are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              branch: params.branch.trim(),
            }

          case 'gitlab_compare_branches':
            if (
              !params.projectId?.trim() ||
              !params.compareFrom?.trim() ||
              !params.compareTo?.trim()
            ) {
              throw new Error('Project ID, from ref, and to ref are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              from: params.compareFrom.trim(),
              to: params.compareTo.trim(),
              straight: params.straight || undefined,
            }

          case 'gitlab_list_commits':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              refName: params.refName?.trim() || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_merge_request_changes':
            if (!params.projectId?.trim() || !params.mergeRequestIid) {
              throw new Error('Project ID and Merge Request IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              mergeRequestIid: Number(params.mergeRequestIid),
            }

          case 'gitlab_approve_merge_request':
            if (!params.projectId?.trim() || !params.mergeRequestIid) {
              throw new Error('Project ID and Merge Request IID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              mergeRequestIid: Number(params.mergeRequestIid),
              sha: params.sha?.trim() || undefined,
            }

          case 'gitlab_list_pipeline_jobs':
            if (!params.projectId?.trim() || !params.pipelineId) {
              throw new Error('Project ID and Pipeline ID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              pipelineId: Number(params.pipelineId),
              scope: params.scope || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_get_job_log':
            if (!params.projectId?.trim() || !params.jobId) {
              throw new Error('Project ID and Job ID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              jobId: Number(params.jobId),
            }

          case 'gitlab_play_job':
            if (!params.projectId?.trim() || !params.jobId) {
              throw new Error('Project ID and Job ID are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              jobId: Number(params.jobId),
            }

          case 'gitlab_list_releases':
            if (!params.projectId?.trim()) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_create_release':
            if (!params.projectId?.trim() || !params.tagName?.trim()) {
              throw new Error('Project ID and tag name are required.')
            }
            return {
              ...baseParams,
              projectId: params.projectId.trim(),
              tagName: params.tagName.trim(),
              name: params.releaseName?.trim() || undefined,
              description: params.description?.trim() || undefined,
              ref: params.ref?.trim() || undefined,
              releasedAt: params.releasedAt?.trim() || undefined,
              milestones: params.releaseMilestones
                ? params.releaseMilestones
                    .split(',')
                    .map((title: string) => title.trim())
                    .filter(Boolean)
                : undefined,
            }

          case 'gitlab_list_members':
            if (!params.resourceId?.trim()) {
              throw new Error('Project / Group ID is required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              directOnly: params.directMembersOnly || undefined,
              query: params.query?.trim() || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_add_member':
            if (!params.resourceId?.trim() || !params.userId || !params.accessLevel) {
              throw new Error('Project / Group ID, User ID, and Access Level are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              userId: Number(params.userId),
              accessLevel: Number(params.accessLevel),
              expiresAt: params.expiresAt?.trim() || undefined,
              memberRoleId: params.memberRoleId ? Number(params.memberRoleId) : undefined,
            }

          case 'gitlab_update_member':
            if (!params.resourceId?.trim() || !params.userId || !params.accessLevel) {
              throw new Error('Project / Group ID, User ID, and Access Level are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              userId: Number(params.userId),
              accessLevel: Number(params.accessLevel),
              expiresAt: params.expiresAt?.trim() || undefined,
              memberRoleId: params.memberRoleId ? Number(params.memberRoleId) : undefined,
            }

          case 'gitlab_remove_member':
            if (!params.resourceId?.trim() || !params.userId) {
              throw new Error('Project / Group ID and User ID are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              userId: Number(params.userId),
            }

          case 'gitlab_invite_member':
            if (!params.resourceId?.trim() || !params.email?.trim() || !params.accessLevel) {
              throw new Error('Project / Group ID, Email, and Access Level are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              email: params.email.trim(),
              accessLevel: Number(params.accessLevel),
              expiresAt: params.expiresAt?.trim() || undefined,
              memberRoleId: params.memberRoleId ? Number(params.memberRoleId) : undefined,
            }

          case 'gitlab_list_invitations':
            if (!params.resourceId?.trim()) {
              throw new Error('Project / Group ID is required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              query: params.query?.trim() || undefined,
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_update_invitation':
            if (!params.resourceId?.trim() || !params.email?.trim()) {
              throw new Error('Project / Group ID and Email are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              email: params.email.trim(),
              // Only send access_level when a level is chosen; "Leave unchanged"
              // ('') keeps the invitation's current level instead of resetting it.
              accessLevel: params.invitationAccessLevel
                ? Number(params.invitationAccessLevel)
                : undefined,
              expiresAt: params.expiresAt?.trim() || undefined,
            }

          case 'gitlab_revoke_invitation':
            if (!params.resourceId?.trim() || !params.email?.trim()) {
              throw new Error('Project / Group ID and Email are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              email: params.email.trim(),
            }

          case 'gitlab_list_access_requests':
            if (!params.resourceId?.trim()) {
              throw new Error('Project / Group ID is required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_approve_access_request':
            if (!params.resourceId?.trim() || !params.userId) {
              throw new Error('Project / Group ID and User ID are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              userId: Number(params.userId),
              accessLevel: params.accessLevel ? Number(params.accessLevel) : undefined,
            }

          case 'gitlab_deny_access_request':
            if (!params.resourceId?.trim() || !params.userId) {
              throw new Error('Project / Group ID and User ID are required.')
            }
            return {
              ...baseParams,
              resourceType: params.resourceType || 'project',
              resourceId: params.resourceId.trim(),
              userId: Number(params.userId),
            }

          case 'gitlab_list_saml_group_links':
            if (!params.groupId?.trim()) {
              throw new Error('Group ID is required.')
            }
            return {
              ...baseParams,
              groupId: params.groupId.trim(),
            }

          case 'gitlab_add_saml_group_link':
            if (!params.groupId?.trim() || !params.samlGroupName?.trim() || !params.accessLevel) {
              throw new Error('Group ID, SAML Group Name, and Access Level are required.')
            }
            return {
              ...baseParams,
              groupId: params.groupId.trim(),
              samlGroupName: params.samlGroupName.trim(),
              accessLevel: Number(params.accessLevel),
              memberRoleId: params.memberRoleId ? Number(params.memberRoleId) : undefined,
              provider: params.samlProvider?.trim() || undefined,
            }

          case 'gitlab_delete_saml_group_link':
            if (!params.groupId?.trim() || !params.samlGroupName?.trim()) {
              throw new Error('Group ID and SAML Group Name are required.')
            }
            return {
              ...baseParams,
              groupId: params.groupId.trim(),
              samlGroupName: params.samlGroupName.trim(),
              provider: params.samlProvider?.trim() || undefined,
            }

          case 'gitlab_search_users':
            if (!params.userSearch?.trim()) {
              throw new Error('Search query is required.')
            }
            return {
              ...baseParams,
              search: params.userSearch.trim(),
              perPage: params.perPage ? Number(params.perPage) : undefined,
              page: params.page ? Number(params.page) : undefined,
            }

          case 'gitlab_create_user':
            if (
              !params.userAdminEmail?.trim() ||
              !params.userAdminUsername?.trim() ||
              !params.userAdminName?.trim()
            ) {
              throw new Error('Email, Username, and Full Name are required.')
            }
            return {
              ...baseParams,
              email: params.userAdminEmail.trim(),
              username: params.userAdminUsername.trim(),
              name: params.userAdminName.trim(),
              password: params.userAdminPassword?.trim() || undefined,
              resetPassword: params.resetPassword || undefined,
              admin: params.userAdminIsAdmin || undefined,
              skipConfirmation: params.skipConfirmation || undefined,
            }

          case 'gitlab_update_user':
            if (!params.userId) {
              throw new Error('User ID is required.')
            }
            return {
              ...baseParams,
              userId: Number(params.userId),
              email: params.userAdminEmail?.trim() || undefined,
              username: params.userAdminUsername?.trim() || undefined,
              name: params.userAdminName?.trim() || undefined,
              // Pass the boolean through (not `|| undefined`) so an explicit `false`
              // demotes the user. An untouched switch is `undefined` and is skipped
              // by the tool body, leaving the admin flag unchanged.
              admin: params.userAdminIsAdmin,
            }

          case 'gitlab_delete_user':
            if (!params.userId) {
              throw new Error('User ID is required.')
            }
            return {
              ...baseParams,
              userId: Number(params.userId),
              hardDelete: params.hardDelete || undefined,
            }

          case 'gitlab_block_user':
          case 'gitlab_unblock_user':
          case 'gitlab_deactivate_user':
          case 'gitlab_activate_user':
          case 'gitlab_ban_user':
          case 'gitlab_unban_user':
          case 'gitlab_approve_user':
          case 'gitlab_reject_user':
            if (!params.userId) {
              throw new Error('User ID is required.')
            }
            return {
              ...baseParams,
              userId: Number(params.userId),
            }

          case 'gitlab_delete_user_identity':
            if (!params.userId || !params.provider?.trim()) {
              throw new Error('User ID and Identity Provider are required.')
            }
            return {
              ...baseParams,
              userId: Number(params.userId),
              provider: params.provider.trim(),
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    accessToken: { type: 'string', description: 'GitLab Personal Access Token' },
    host: { type: 'string', description: 'Self-managed GitLab host (defaults to gitlab.com)' },
    projectId: { type: 'string', description: 'Project ID or URL-encoded path' },
    issueIid: { type: 'number', description: 'Issue internal ID' },
    mergeRequestIid: { type: 'number', description: 'Merge request internal ID' },
    pipelineId: { type: 'number', description: 'Pipeline ID' },
    title: { type: 'string', description: 'Title for issue or merge request' },
    description: { type: 'string', description: 'Description (Markdown supported)' },
    body: { type: 'string', description: 'Comment body' },
    sourceBranch: { type: 'string', description: 'Source branch for merge request' },
    targetBranch: { type: 'string', description: 'Target branch for merge request' },
    ref: { type: 'string', description: 'Branch or tag reference for pipeline' },
    labels: { type: 'string', description: 'Labels (comma-separated)' },
    assigneeIds: { type: 'string', description: 'Assignee user IDs (comma-separated)' },
    milestoneId: { type: 'number', description: 'Milestone ID' },
    issueState: { type: 'string', description: 'Issue state filter (opened, closed, all)' },
    mrState: {
      type: 'string',
      description: 'Merge request state filter (opened, closed, merged, all)',
    },
    stateEvent: { type: 'string', description: 'State event (close, reopen)' },
    pipelineStatus: { type: 'string', description: 'Pipeline status filter' },
    removeSourceBranch: { type: 'boolean', description: 'Remove source branch after merge' },
    squash: { type: 'boolean', description: 'Squash commits on merge' },
    mergeCommitMessage: { type: 'string', description: 'Custom merge commit message' },
    perPage: { type: 'number', description: 'Results per page' },
    page: { type: 'number', description: 'Page number' },
    filePath: { type: 'string', description: 'Path to file in the repository' },
    branch: { type: 'string', description: 'Branch name' },
    content: { type: 'string', description: 'File content' },
    commitMessage: { type: 'string', description: 'Commit message' },
    jobId: { type: 'number', description: 'Job ID' },
    path: { type: 'string', description: 'Subdirectory path for repository tree' },
    recursive: { type: 'boolean', description: 'Recursively list repository tree' },
    refName: { type: 'string', description: 'Branch or tag name filter' },
    scope: { type: 'string', description: 'Job scope filter' },
    sha: { type: 'string', description: 'Commit SHA' },
    compareFrom: { type: 'string', description: 'Branch, tag, or commit SHA to compare from' },
    compareTo: { type: 'string', description: 'Branch, tag, or commit SHA to compare to' },
    straight: { type: 'boolean', description: 'Compare directly instead of using the merge base' },
    tagName: { type: 'string', description: 'Git tag for the release' },
    releaseName: { type: 'string', description: 'Release name' },
    releasedAt: { type: 'string', description: 'ISO 8601 date for the release' },
    releaseMilestones: { type: 'string', description: 'Milestone titles (comma-separated)' },
    resourceType: { type: 'string', description: "Access resource type ('project' or 'group')" },
    resourceId: { type: 'string', description: 'Project or group ID or URL-encoded path' },
    groupId: { type: 'string', description: 'Group ID or URL-encoded path' },
    userId: { type: 'number', description: 'Target user ID' },
    accessLevel: { type: 'number', description: 'GitLab access level (10-50)' },
    invitationAccessLevel: {
      type: 'string',
      description: 'Optional new access level for an invitation ("" leaves it unchanged)',
    },
    expiresAt: { type: 'string', description: 'Access expiration date (YYYY-MM-DD)' },
    memberRoleId: { type: 'number', description: 'Custom member role ID (Ultimate)' },
    email: { type: 'string', description: 'Email address for invitations' },
    directMembersOnly: { type: 'boolean', description: 'Exclude inherited members' },
    query: {
      type: 'string',
      description: 'Filter members by name/username, or invitations by email',
    },
    userSearch: { type: 'string', description: 'User search query' },
    samlGroupName: { type: 'string', description: 'SAML group name' },
    samlProvider: {
      type: 'string',
      description: 'SAML provider name for a group link (disambiguates duplicate link names)',
    },
    provider: { type: 'string', description: 'External identity provider name' },
    hardDelete: { type: 'boolean', description: 'Hard-delete a user' },
    userAdminEmail: { type: 'string', description: "User's email (create/update user)" },
    userAdminUsername: { type: 'string', description: "User's username (create/update user)" },
    userAdminName: { type: 'string', description: "User's display name (create/update user)" },
    userAdminPassword: { type: 'string', description: "User's password (create user)" },
    resetPassword: { type: 'boolean', description: 'Send a password reset link (create user)' },
    skipConfirmation: { type: 'boolean', description: 'Skip email confirmation (create user)' },
    userAdminIsAdmin: { type: 'boolean', description: 'Whether the user is an administrator' },
  },
  outputs: {
    // Project outputs
    projects: { type: 'json', description: 'List of projects' },
    project: { type: 'json', description: 'Project details' },
    // Issue outputs
    issues: { type: 'json', description: 'List of issues' },
    issue: { type: 'json', description: 'Issue details' },
    // Merge request outputs
    mergeRequests: { type: 'json', description: 'List of merge requests' },
    mergeRequest: { type: 'json', description: 'Merge request details' },
    mergeRequestIid: { type: 'number', description: 'Merge request internal ID (IID)' },
    // Pipeline outputs
    pipelines: { type: 'json', description: 'List of pipelines' },
    pipeline: { type: 'json', description: 'Pipeline details' },
    // Note outputs
    note: { type: 'json', description: 'Comment/note details' },
    // Repository outputs
    tree: { type: 'json', description: 'Repository tree entries' },
    content: { type: 'string', description: 'File contents (decoded)' },
    fileName: { type: 'string', description: 'File name' },
    filePath: { type: 'string', description: 'Path to the file in the repository' },
    branch: { type: 'string', description: 'Branch the file was committed to' },
    branches: { type: 'json', description: 'List of branches' },
    commits: { type: 'json', description: 'List of commits' },
    commit: { type: 'json', description: 'A single commit (e.g. latest commit in a comparison)' },
    name: { type: 'string', description: 'Created branch name' },
    protected: { type: 'boolean', description: 'Whether the branch is protected' },
    size: { type: 'number', description: 'File size in bytes' },
    ref: { type: 'string', description: 'The branch, tag, or commit SHA' },
    blobId: { type: 'string', description: 'The blob ID' },
    lastCommitId: { type: 'string', description: 'The last commit ID that modified the file' },
    webUrl: { type: 'string', description: 'Web URL' },
    // Merge request change outputs
    changes: { type: 'json', description: 'Merge request file changes/diffs' },
    changesCount: { type: 'number', description: 'Number of changed files returned' },
    approvalsRequired: { type: 'number', description: 'Approvals required' },
    approvalsLeft: { type: 'number', description: 'Approvals remaining' },
    approvedBy: { type: 'json', description: 'List of approvers' },
    // Job outputs
    jobs: { type: 'json', description: 'Pipeline jobs' },
    log: { type: 'string', description: 'Job log output' },
    id: { type: 'number', description: 'Job ID' },
    status: { type: 'string', description: 'Job status' },
    // Compare outputs
    diffs: { type: 'json', description: 'File diffs between two compared references' },
    compareTimeout: { type: 'boolean', description: 'Whether the comparison timed out' },
    compareSameRef: { type: 'boolean', description: 'Whether both compared references match' },
    // Release outputs
    releases: { type: 'json', description: 'List of releases' },
    release: { type: 'json', description: 'Release details' },
    // Access / membership outputs
    members: { type: 'json', description: 'List of project or group members' },
    member: { type: 'json', description: 'A single member' },
    alreadyMember: { type: 'boolean', description: 'Whether the user was already a member' },
    invitations: { type: 'json', description: 'List of pending invitations' },
    invitation: { type: 'json', description: 'A single invitation' },
    accessRequests: { type: 'json', description: 'List of pending access requests' },
    accessRequest: { type: 'json', description: 'A single access request' },
    samlGroupLinks: { type: 'json', description: 'List of SAML group links' },
    samlGroupLink: { type: 'json', description: 'A single SAML group link' },
    message: { type: 'json', description: 'Per-email invitation result detail' },
    // User outputs
    users: { type: 'json', description: 'List of matching users' },
    user: { type: 'json', description: 'User details' },
    // Pagination
    total: { type: 'number', description: 'Total number of items available across all pages' },
    // Success indicator
    success: { type: 'boolean', description: 'Operation success status' },
  },

  triggers: {
    enabled: true,
    available: [
      'gitlab_push',
      'gitlab_merge_request',
      'gitlab_issue',
      'gitlab_pipeline',
      'gitlab_comment',
      'gitlab_webhook',
    ],
  },
}

export const GitLabBlockMeta = {
  tags: ['version-control', 'ci-cd'],
  url: 'https://about.gitlab.com',
  templates: [
    {
      icon: GitLabIcon,
      title: 'GitLab merge request reviewer',
      prompt:
        'Create a knowledge base from my coding standards and architecture docs. Build a scheduled workflow that lists open GitLab merge requests, fetches each diff, runs an agent that checks the code against the knowledge base and flags security issues, performance concerns, and style violations, then posts a structured review as an MR comment.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab pipeline failure responder',
      prompt:
        'Build a scheduled workflow that lists recent GitLab pipelines on the main branch, finds newly failed runs, summarizes the root cause from the job logs, identifies the most likely owner from recent commits, opens a GitLab issue with the diagnosis, and posts an alert to Slack with a link to the failing pipeline.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab issue triager',
      prompt:
        'Create a scheduled workflow that runs every hour, pulls new GitLab issues, classifies each by component, severity, and effort, applies labels and assigns the right owner, and posts a daily Slack digest of unassigned and stale issues so nothing slips through.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab release publisher',
      prompt:
        'Build a scheduled workflow that detects new GitLab release tags, gathers merged merge requests since the previous tag, groups changes by component, drafts release notes as a file, and posts the formatted summary back as a comment on the release.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'content'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab project health digest',
      prompt:
        'Create a scheduled weekly workflow that pulls open issues, stale merge requests, recent pipeline failures, and contributor activity for every GitLab project, logs metrics to a tracking table, and sends a Slack health digest to engineering leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab merge request unblocker',
      prompt:
        'Build a scheduled daily workflow that lists open GitLab merge requests, identifies those blocked on review for more than two days, sends targeted Slack DMs to the assigned reviewers with the MR link, and updates a table tracking unblock actions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab repository knowledge base',
      prompt:
        'Create a knowledge base that ingests GitLab project files, merge request descriptions, and issue threads, then build an agent I can ask things like "how does the billing module handle proration?" or "which MR introduced the rate limiter?" and get answers with GitLab citations.',
      modules: ['knowledge-base', 'agent'],
      category: 'engineering',
      tags: ['engineering', 'research', 'devops'],
    },
  ],
  skills: [
    {
      name: 'review-merge-request',
      description:
        'Fetch a GitLab merge request and post a structured review comment with actionable feedback.',
      content:
        '# Review Merge Request\n\nUse GitLab to read a merge request and leave a useful review.\n\n## Steps\n1. Get the merge request by project ID and MR IID to read its title, description, and changes.\n2. Assess the change for correctness, missing tests, and risky edits.\n3. Post a review note on the MR with Add MR Comment, summarizing the feedback.\n\n## Output\nConfirm the comment was posted and return a short summary: what looks good, what needs changes, and any blocking concerns.',
    },
    {
      name: 'triage-gitlab-issue',
      description:
        'Read a GitLab issue, classify it, and post a triage comment or update its fields.',
      content:
        '# Triage GitLab Issue\n\nUse GitLab to triage an incoming issue.\n\n## Steps\n1. Get the issue by project ID and issue IID to read its title and description.\n2. Classify it (bug, feature, question) and judge severity.\n3. Update the issue with the right labels and assignee using Update Issue, and add a triage note with Add Issue Comment.\n\n## Output\nReturn the classification, applied labels, assignee, and a one-line triage summary. Note any missing reproduction details.',
    },
    {
      name: 'monitor-pipeline-status',
      description:
        'Check GitLab pipeline status for a project and report failures, optionally retrying a failed pipeline.',
      content:
        '# Monitor Pipeline Status\n\nUse GitLab to keep an eye on CI pipelines.\n\n## Steps\n1. List pipelines for the project and identify the most recent runs.\n2. Get the pipeline details for any that failed to read the status and reason.\n3. If a failure looks transient, use Retry Pipeline to re-run it.\n\n## Output\nReturn a summary of recent pipeline runs (ref, status, when) and call out any failures. If a retry was triggered, include the retried pipeline ID.',
    },
    {
      name: 'draft-release-notes',
      description:
        'Compare two refs, summarize the merged changes, and publish a GitLab release with generated notes.',
      content:
        "# Draft Release Notes\n\nUse GitLab to publish a release with notes generated from the changes since the last tag.\n\n## Steps\n1. Compare Branches between the previous release tag and the target ref to list the commits and diffs.\n2. Summarize the changes into readable release notes, grouped by feature, fix, or chore.\n3. Use Create Release with the new tag name, the generated description, and the target ref.\n\n## Output\nReturn the created release's tag name and a confirmation that the notes were published, along with the release notes text.",
    },
  ],
} as const satisfies BlockMeta
