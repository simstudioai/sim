import { JiraIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { JiraResponse } from '@/tools/jira/types'
import { getTrigger } from '@/triggers'

export const JiraBlock: BlockConfig<JiraResponse> = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  authMode: AuthMode.OAuth,
  triggerAllowed: true,
  longDescription:
    'Integrate Jira into the workflow. Can read, write, and update issues. Can also trigger workflows based on Jira webhook events.',
  docsLink: 'https://docs.sim.ai/tools/jira',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: JiraIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Read Issue', id: 'read' },
        { label: 'Update Issue', id: 'update' },
        { label: 'Write Issue', id: 'write' },
        { label: 'Delete Issue', id: 'delete' },
        { label: 'Assign Issue', id: 'assign' },
        { label: 'Transition Issue', id: 'transition' },
        { label: 'Search Issues', id: 'search' },
        { label: 'Add Comment', id: 'add_comment' },
        { label: 'Get Comments', id: 'get_comments' },
        { label: 'Update Comment', id: 'update_comment' },
        { label: 'Delete Comment', id: 'delete_comment' },
        { label: 'Get Attachments', id: 'get_attachments' },
        { label: 'Delete Attachment', id: 'delete_attachment' },
        { label: 'Add Worklog', id: 'add_worklog' },
        { label: 'Get Worklogs', id: 'get_worklogs' },
        { label: 'Update Worklog', id: 'update_worklog' },
        { label: 'Delete Worklog', id: 'delete_worklog' },
        { label: 'Create Issue Link', id: 'create_link' },
        { label: 'Delete Issue Link', id: 'delete_link' },
        { label: 'Add Watcher', id: 'add_watcher' },
        { label: 'Remove Watcher', id: 'remove_watcher' },
      ],
      value: () => 'read',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      required: true,
      placeholder: 'Enter Jira domain (e.g., simstudio.atlassian.net)',
    },
    {
      id: 'credential',
      title: 'Jira Account',
      type: 'oauth-input',
      required: true,
      provider: 'jira',
      serviceId: 'jira',
      requiredScopes: [
        'read:jira-work',
        'read:jira-user',
        'write:jira-work',
        'read:issue-event:jira',
        'write:issue:jira',
        'read:project:jira',
        'read:issue-type:jira',
        'read:me',
        'offline_access',
        'read:issue-meta:jira',
        'read:issue-security-level:jira',
        'read:issue.vote:jira',
        'read:issue.changelog:jira',
        'read:avatar:jira',
        'read:issue:jira',
        'read:status:jira',
        'read:user:jira',
        'read:field-configuration:jira',
        'read:issue-details:jira',
        'delete:issue:jira',
        'write:comment:jira',
        'read:comment:jira',
        'delete:comment:jira',
        'read:attachment:jira',
        'delete:attachment:jira',
        'write:issue-worklog:jira',
        'read:issue-worklog:jira',
        'delete:issue-worklog:jira',
        'write:issue-link:jira',
        'delete:issue-link:jira',
      ],
      placeholder: 'Select Jira account',
    },
    // Project selector (basic mode)
    {
      id: 'projectId',
      title: 'Select Project',
      type: 'project-selector',
      canonicalParamId: 'projectId',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira project',
      dependsOn: ['credential', 'domain'],
      mode: 'basic',
    },
    // Manual project ID input (advanced mode)
    {
      id: 'manualProjectId',
      title: 'Project ID',
      type: 'short-input',
      canonicalParamId: 'projectId',
      placeholder: 'Enter Jira project ID',
      dependsOn: ['credential', 'domain'],
      mode: 'advanced',
    },
    // Issue selector (basic mode)
    {
      id: 'issueKey',
      title: 'Select Issue',
      type: 'file-selector',
      canonicalParamId: 'issueKey',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira issue',
      dependsOn: ['credential', 'domain', 'projectId'],
      condition: {
        field: 'operation',
        value: [
          'read',
          'update',
          'delete',
          'assign',
          'transition',
          'add_comment',
          'get_comments',
          'update_comment',
          'delete_comment',
          'get_attachments',
          'add_worklog',
          'get_worklogs',
          'update_worklog',
          'delete_worklog',
          'add_watcher',
          'remove_watcher',
        ],
      },
      mode: 'basic',
    },
    // Manual issue key input (advanced mode)
    {
      id: 'manualIssueKey',
      title: 'Issue Key',
      type: 'short-input',
      canonicalParamId: 'issueKey',
      placeholder: 'Enter Jira issue key',
      dependsOn: ['credential', 'domain', 'projectId', 'manualProjectId'],
      condition: {
        field: 'operation',
        value: [
          'read',
          'update',
          'delete',
          'assign',
          'transition',
          'add_comment',
          'get_comments',
          'update_comment',
          'delete_comment',
          'get_attachments',
          'add_worklog',
          'get_worklogs',
          'update_worklog',
          'delete_worklog',
          'add_watcher',
          'remove_watcher',
        ],
      },
      mode: 'advanced',
    },
    {
      id: 'summary',
      title: 'New Summary',
      type: 'short-input',
      required: true,
      placeholder: 'Enter new summary for the issue',
      dependsOn: ['issueKey'],
      condition: { field: 'operation', value: ['update', 'write'] },
    },
    {
      id: 'description',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Enter new description for the issue',
      dependsOn: ['issueKey'],
      condition: { field: 'operation', value: ['update', 'write'] },
    },
    // Delete Issue fields
    {
      id: 'deleteSubtasks',
      title: 'Delete Subtasks',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'delete' },
    },
    // Assign Issue fields
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter user account ID to assign',
      condition: { field: 'operation', value: ['assign', 'add_watcher', 'remove_watcher'] },
    },
    // Transition Issue fields
    {
      id: 'transitionId',
      title: 'Transition ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter transition ID (e.g., 21)',
      condition: { field: 'operation', value: 'transition' },
    },
    {
      id: 'transitionComment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Add optional comment for transition',
      condition: { field: 'operation', value: 'transition' },
    },
    // Search Issues fields
    {
      id: 'jql',
      title: 'JQL Query',
      type: 'long-input',
      required: true,
      placeholder: 'Enter JQL query (e.g., project = PROJ AND status = "In Progress")',
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum results to return (default: 50)',
      condition: { field: 'operation', value: ['search', 'get_comments', 'get_worklogs'] },
    },
    // Comment fields
    {
      id: 'commentBody',
      title: 'Comment Text',
      type: 'long-input',
      required: true,
      placeholder: 'Enter comment text',
      condition: { field: 'operation', value: ['add_comment', 'update_comment'] },
    },
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter comment ID',
      condition: { field: 'operation', value: ['update_comment', 'delete_comment'] },
    },
    // Attachment fields
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter attachment ID',
      condition: { field: 'operation', value: 'delete_attachment' },
    },
    // Worklog fields
    {
      id: 'timeSpentSeconds',
      title: 'Time Spent (seconds)',
      type: 'short-input',
      required: true,
      placeholder: 'Enter time in seconds (e.g., 3600 for 1 hour)',
      condition: { field: 'operation', value: 'add_worklog' },
    },
    {
      id: 'timeSpentSecondsUpdate',
      title: 'Time Spent (seconds) - Optional',
      type: 'short-input',
      placeholder: 'Enter time in seconds (leave empty to keep unchanged)',
      condition: { field: 'operation', value: 'update_worklog' },
    },
    {
      id: 'worklogComment',
      title: 'Worklog Comment',
      type: 'long-input',
      placeholder: 'Enter optional worklog comment',
      condition: { field: 'operation', value: ['add_worklog', 'update_worklog'] },
    },
    {
      id: 'started',
      title: 'Started At',
      type: 'short-input',
      placeholder: 'ISO timestamp (defaults to now)',
      condition: { field: 'operation', value: ['add_worklog', 'update_worklog'] },
    },
    {
      id: 'worklogId',
      title: 'Worklog ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter worklog ID',
      condition: { field: 'operation', value: ['update_worklog', 'delete_worklog'] },
    },
    // Issue Link fields
    {
      id: 'inwardIssueKey',
      title: 'Inward Issue Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter inward issue key (e.g., PROJ-123)',
      condition: { field: 'operation', value: 'create_link' },
    },
    {
      id: 'outwardIssueKey',
      title: 'Outward Issue Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter outward issue key (e.g., PROJ-456)',
      condition: { field: 'operation', value: 'create_link' },
    },
    {
      id: 'linkType',
      title: 'Link Type',
      type: 'short-input',
      required: true,
      placeholder: 'Enter link type (e.g., "Blocks", "Relates")',
      condition: { field: 'operation', value: 'create_link' },
    },
    {
      id: 'linkComment',
      title: 'Link Comment',
      type: 'long-input',
      placeholder: 'Add optional comment for the link',
      condition: { field: 'operation', value: 'create_link' },
    },
    {
      id: 'linkId',
      title: 'Link ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter link ID to delete',
      condition: { field: 'operation', value: 'delete_link' },
    },
    // Trigger SubBlocks
    ...getTrigger('jira_issue_created').subBlocks,
    ...getTrigger('jira_issue_updated').subBlocks,
    ...getTrigger('jira_issue_deleted').subBlocks,
    ...getTrigger('jira_issue_commented').subBlocks,
    ...getTrigger('jira_worklog_created').subBlocks,
    ...getTrigger('jira_webhook').subBlocks,
  ],
  tools: {
    access: [
      'jira_retrieve',
      'jira_update',
      'jira_write',
      'jira_bulk_read',
      'jira_delete_issue',
      'jira_assign_issue',
      'jira_transition_issue',
      'jira_search_issues',
      'jira_add_comment',
      'jira_get_comments',
      'jira_update_comment',
      'jira_delete_comment',
      'jira_get_attachments',
      'jira_delete_attachment',
      'jira_add_worklog',
      'jira_get_worklogs',
      'jira_update_worklog',
      'jira_delete_worklog',
      'jira_create_issue_link',
      'jira_delete_issue_link',
      'jira_add_watcher',
      'jira_remove_watcher',
    ],
    config: {
      tool: (params) => {
        const effectiveProjectId = (params.projectId || params.manualProjectId || '').trim()
        const effectiveIssueKey = (params.issueKey || params.manualIssueKey || '').trim()

        switch (params.operation) {
          case 'read':
            // If a project is selected but no issue is chosen, route to bulk read
            if (effectiveProjectId && !effectiveIssueKey) {
              return 'jira_bulk_read'
            }
            return 'jira_retrieve'
          case 'update':
            return 'jira_update'
          case 'write':
            return 'jira_write'
          case 'read-bulk':
            return 'jira_bulk_read'
          case 'delete':
            return 'jira_delete_issue'
          case 'assign':
            return 'jira_assign_issue'
          case 'transition':
            return 'jira_transition_issue'
          case 'search':
            return 'jira_search_issues'
          case 'add_comment':
            return 'jira_add_comment'
          case 'get_comments':
            return 'jira_get_comments'
          case 'update_comment':
            return 'jira_update_comment'
          case 'delete_comment':
            return 'jira_delete_comment'
          case 'get_attachments':
            return 'jira_get_attachments'
          case 'delete_attachment':
            return 'jira_delete_attachment'
          case 'add_worklog':
            return 'jira_add_worklog'
          case 'get_worklogs':
            return 'jira_get_worklogs'
          case 'update_worklog':
            return 'jira_update_worklog'
          case 'delete_worklog':
            return 'jira_delete_worklog'
          case 'create_link':
            return 'jira_create_issue_link'
          case 'delete_link':
            return 'jira_delete_issue_link'
          case 'add_watcher':
            return 'jira_add_watcher'
          case 'remove_watcher':
            return 'jira_remove_watcher'
          default:
            return 'jira_retrieve'
        }
      },
      params: (params) => {
        const { credential, projectId, manualProjectId, issueKey, manualIssueKey, ...rest } = params

        // Use the selected IDs or the manually entered ones
        const effectiveProjectId = (projectId || manualProjectId || '').trim()
        const effectiveIssueKey = (issueKey || manualIssueKey || '').trim()

        const baseParams = {
          credential,
          domain: params.domain,
        }

        switch (params.operation) {
          case 'write': {
            if (!effectiveProjectId) {
              throw new Error(
                'Project ID is required. Please select a project or enter a project ID manually.'
              )
            }
            const writeParams = {
              projectId: effectiveProjectId,
              summary: params.summary || '',
              description: params.description || '',
              issueType: params.issueType || 'Task',
              parent: params.parentIssue ? { key: params.parentIssue } : undefined,
            }
            return {
              ...baseParams,
              ...writeParams,
            }
          }
          case 'update': {
            if (!effectiveProjectId) {
              throw new Error(
                'Project ID is required. Please select a project or enter a project ID manually.'
              )
            }
            if (!effectiveIssueKey) {
              throw new Error(
                'Issue Key is required. Please select an issue or enter an issue key manually.'
              )
            }
            const updateParams = {
              projectId: effectiveProjectId,
              issueKey: effectiveIssueKey,
              summary: params.summary || '',
              description: params.description || '',
            }
            return {
              ...baseParams,
              ...updateParams,
            }
          }
          case 'read': {
            // Check for project ID from either source
            const projectForRead = (params.projectId || params.manualProjectId || '').trim()
            const issueForRead = (params.issueKey || params.manualIssueKey || '').trim()

            if (!issueForRead) {
              throw new Error(
                'Select a project to read issues, or provide an issue key to read a single issue.'
              )
            }
            return {
              ...baseParams,
              issueKey: issueForRead,
              // Include projectId if available for context
              ...(projectForRead && { projectId: projectForRead }),
            }
          }
          case 'read-bulk': {
            // Check both projectId and manualProjectId directly from params
            const finalProjectId = params.projectId || params.manualProjectId || ''

            if (!finalProjectId) {
              throw new Error(
                'Project ID is required. Please select a project or enter a project ID manually.'
              )
            }
            return {
              ...baseParams,
              projectId: finalProjectId.trim(),
            }
          }
          case 'delete': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to delete an issue.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              deleteSubtasks: params.deleteSubtasks === 'true',
            }
          }
          case 'assign': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to assign an issue.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              accountId: params.accountId,
            }
          }
          case 'transition': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to transition an issue.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              transitionId: params.transitionId,
              comment: params.transitionComment,
            }
          }
          case 'search': {
            return {
              ...baseParams,
              jql: params.jql,
              maxResults: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          }
          case 'add_comment': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to add a comment.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              body: params.commentBody,
            }
          }
          case 'get_comments': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to get comments.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              maxResults: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          }
          case 'update_comment': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to update a comment.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              commentId: params.commentId,
              body: params.commentBody,
            }
          }
          case 'delete_comment': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to delete a comment.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              commentId: params.commentId,
            }
          }
          case 'get_attachments': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to get attachments.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
            }
          }
          case 'delete_attachment': {
            return {
              ...baseParams,
              attachmentId: params.attachmentId,
            }
          }
          case 'add_worklog': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to add a worklog.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              timeSpentSeconds: params.timeSpentSeconds
                ? Number.parseInt(params.timeSpentSeconds)
                : undefined,
              comment: params.worklogComment,
              started: params.started,
            }
          }
          case 'get_worklogs': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to get worklogs.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              maxResults: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          }
          case 'update_worklog': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to update a worklog.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              worklogId: params.worklogId,
              timeSpentSeconds: params.timeSpentSecondsUpdate
                ? Number.parseInt(params.timeSpentSecondsUpdate)
                : undefined,
              comment: params.worklogComment,
              started: params.started,
            }
          }
          case 'delete_worklog': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to delete a worklog.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              worklogId: params.worklogId,
            }
          }
          case 'create_link': {
            return {
              ...baseParams,
              inwardIssueKey: params.inwardIssueKey,
              outwardIssueKey: params.outwardIssueKey,
              linkType: params.linkType,
              comment: params.linkComment,
            }
          }
          case 'delete_link': {
            return {
              ...baseParams,
              linkId: params.linkId,
            }
          }
          case 'add_watcher': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to add a watcher.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              accountId: params.accountId,
            }
          }
          case 'remove_watcher': {
            if (!effectiveIssueKey) {
              throw new Error('Issue Key is required to remove a watcher.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              accountId: params.accountId,
            }
          }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Jira domain' },
    credential: { type: 'string', description: 'Jira access token' },
    issueKey: { type: 'string', description: 'Issue key identifier' },
    projectId: { type: 'string', description: 'Project identifier' },
    manualProjectId: { type: 'string', description: 'Manual project identifier' },
    manualIssueKey: { type: 'string', description: 'Manual issue key' },
    // Update/Write operation inputs
    summary: { type: 'string', description: 'Issue summary' },
    description: { type: 'string', description: 'Issue description' },
    issueType: { type: 'string', description: 'Issue type' },
    // Delete operation inputs
    deleteSubtasks: { type: 'string', description: 'Whether to delete subtasks (true/false)' },
    // Assign/Watcher operation inputs
    accountId: {
      type: 'string',
      description: 'User account ID for assignment or watcher operations',
    },
    // Transition operation inputs
    transitionId: { type: 'string', description: 'Transition ID for workflow status changes' },
    transitionComment: { type: 'string', description: 'Optional comment for transition' },
    // Search operation inputs
    jql: { type: 'string', description: 'JQL (Jira Query Language) search query' },
    maxResults: { type: 'string', description: 'Maximum number of results to return' },
    // Comment operation inputs
    commentBody: { type: 'string', description: 'Text content for comment operations' },
    commentId: { type: 'string', description: 'Comment ID for update/delete operations' },
    // Attachment operation inputs
    attachmentId: { type: 'string', description: 'Attachment ID for delete operation' },
    // Worklog operation inputs
    timeSpentSeconds: {
      type: 'string',
      description: 'Time spent in seconds for add worklog (required)',
    },
    timeSpentSecondsUpdate: {
      type: 'string',
      description: 'Time spent in seconds for update worklog (optional)',
    },
    worklogComment: { type: 'string', description: 'Optional comment for worklog' },
    started: { type: 'string', description: 'ISO timestamp when work started (optional)' },
    worklogId: { type: 'string', description: 'Worklog ID for update/delete operations' },
    // Issue Link operation inputs
    inwardIssueKey: { type: 'string', description: 'Inward issue key for creating link' },
    outwardIssueKey: { type: 'string', description: 'Outward issue key for creating link' },
    linkType: { type: 'string', description: 'Type of link (e.g., "Blocks", "Relates")' },
    linkComment: { type: 'string', description: 'Optional comment for issue link' },
    linkId: { type: 'string', description: 'Link ID for delete operation' },
  },
  outputs: {
    // Common outputs across all Jira operations
    ts: { type: 'string', description: 'Timestamp of the operation' },
    success: { type: 'boolean', description: 'Whether the operation was successful' },

    // jira_retrieve (read) outputs
    issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
    summary: { type: 'string', description: 'Issue summary/title' },
    description: { type: 'string', description: 'Issue description content' },
    created: { type: 'string', description: 'Issue creation date' },
    updated: { type: 'string', description: 'Issue last update date' },
    status: { type: 'string', description: 'Issue status name' },
    assignee: { type: 'string', description: 'Issue assignee display name or account ID' },

    // jira_write (create) outputs
    url: { type: 'string', description: 'URL to the created/accessed issue' },
    id: { type: 'string', description: 'Jira issue ID' },
    key: { type: 'string', description: 'Jira issue key' },

    // jira_search_issues outputs
    total: { type: 'number', description: 'Total number of matching issues' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    issues: {
      type: 'json',
      description: 'Array of matching issues with key, summary, status, assignee, dates',
    },

    // jira_get_comments outputs
    comments: {
      type: 'json',
      description: 'Array of comments with id, author, body, created, updated',
    },

    // jira_add_comment, jira_update_comment outputs
    commentId: { type: 'string', description: 'Comment ID' },
    commentBody: { type: 'string', description: 'Comment text content' },
    author: { type: 'string', description: 'Comment author display name' },

    // jira_get_attachments outputs
    attachments: {
      type: 'json',
      description: 'Array of attachments with id, filename, size, mimeType, created, author',
    },

    // jira_delete_attachment, jira_delete_comment, jira_delete_issue, jira_delete_worklog, jira_delete_issue_link outputs
    attachmentId: { type: 'string', description: 'Deleted attachment ID' },

    // jira_get_worklogs outputs
    worklogs: {
      type: 'json',
      description:
        'Array of worklogs with id, author, timeSpentSeconds, timeSpent, comment, created, updated, started',
    },

    // jira_add_worklog, jira_update_worklog outputs
    worklogId: { type: 'string', description: 'Worklog ID' },
    timeSpentSeconds: { type: 'number', description: 'Time spent in seconds' },
    timeSpent: { type: 'string', description: 'Formatted time spent string' },

    // jira_assign_issue outputs
    assigneeId: { type: 'string', description: 'Assigned user account ID' },

    // jira_transition_issue outputs
    transitionId: { type: 'string', description: 'Applied transition ID' },
    newStatus: { type: 'string', description: 'New status after transition' },

    // jira_create_issue_link outputs
    linkId: { type: 'string', description: 'Created link ID' },
    inwardIssue: { type: 'string', description: 'Inward issue key' },
    outwardIssue: { type: 'string', description: 'Outward issue key' },
    linkType: { type: 'string', description: 'Type of issue link' },

    // jira_add_watcher, jira_remove_watcher outputs
    watcherAccountId: { type: 'string', description: 'Watcher account ID' },

    // jira_bulk_read outputs
    // Note: bulk_read returns an array in the output field, each item contains:
    // ts, issueKey, summary, description, status, assignee, created, updated

    // Trigger outputs (from webhook events)
    event_type: { type: 'string', description: 'Webhook event type' },
    issue_id: { type: 'string', description: 'Issue ID from webhook' },
    issue_key: { type: 'string', description: 'Issue key from webhook' },
    project_key: { type: 'string', description: 'Project key from webhook' },
    project_name: { type: 'string', description: 'Project name from webhook' },
    issue_type_name: { type: 'string', description: 'Issue type from webhook' },
    priority_name: { type: 'string', description: 'Issue priority from webhook' },
    status_name: { type: 'string', description: 'Issue status from webhook' },
    assignee_name: { type: 'string', description: 'Assignee display name from webhook' },
    assignee_email: { type: 'string', description: 'Assignee email from webhook' },
    reporter_name: { type: 'string', description: 'Reporter display name from webhook' },
    reporter_email: { type: 'string', description: 'Reporter email from webhook' },
    comment_id: { type: 'string', description: 'Comment ID (for comment events)' },
    comment_body: { type: 'string', description: 'Comment text (for comment events)' },
    worklog_id: { type: 'string', description: 'Worklog ID (for worklog events)' },
    time_spent: { type: 'string', description: 'Time spent (for worklog events)' },
    changelog: { type: 'json', description: 'Changelog object (for update events)' },
    issue: { type: 'json', description: 'Complete issue object from webhook' },
    jira: { type: 'json', description: 'Complete webhook payload' },
    user: { type: 'json', description: 'User object who triggered the event' },
    webhook: { type: 'json', description: 'Webhook metadata' },
  },
  triggers: {
    enabled: true,
    available: [
      'jira_issue_created',
      'jira_issue_updated',
      'jira_issue_deleted',
      'jira_issue_commented',
      'jira_worklog_created',
      'jira_webhook',
    ],
  },
}
