import { JiraIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
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
        { label: 'Add Attachment', id: 'add_attachment' },
        { label: 'Delete Attachment', id: 'delete_attachment' },
        { label: 'Add Worklog', id: 'add_worklog' },
        { label: 'Get Worklogs', id: 'get_worklogs' },
        { label: 'Update Worklog', id: 'update_worklog' },
        { label: 'Delete Worklog', id: 'delete_worklog' },
        { label: 'Create Issue Link', id: 'create_link' },
        { label: 'Delete Issue Link', id: 'delete_link' },
        { label: 'Add Watcher', id: 'add_watcher' },
        { label: 'Remove Watcher', id: 'remove_watcher' },
        { label: 'Get Users', id: 'get_users' },
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
      serviceId: 'jira',
      placeholder: 'Select Jira project',
      dependsOn: ['credential', 'domain'],
      mode: 'basic',
      required: { field: 'operation', value: ['write', 'update', 'read-bulk'] },
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
      required: { field: 'operation', value: ['write', 'update', 'read-bulk'] },
    },
    // Issue selector (basic mode)
    {
      id: 'issueKey',
      title: 'Select Issue',
      type: 'file-selector',
      canonicalParamId: 'issueKey',
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
          'add_attachment',
          'add_worklog',
          'get_worklogs',
          'update_worklog',
          'delete_worklog',
          'add_watcher',
          'remove_watcher',
        ],
      },
      required: {
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
          'add_attachment',
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
          'add_attachment',
          'add_worklog',
          'get_worklogs',
          'update_worklog',
          'delete_worklog',
          'add_watcher',
          'remove_watcher',
        ],
      },
      required: {
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
          'add_attachment',
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
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: ['update', 'write'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a concise Jira issue summary/title based on the user's description.
The summary should:
- Be clear and descriptive
- Capture the essence of the issue
- Be suitable for issue tracking

Return ONLY the summary text - no explanations.`,
        placeholder:
          'Describe the issue (e.g., "login page not loading", "add dark mode feature")...',
      },
    },
    {
      id: 'description',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Enter new description for the issue',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: ['update', 'write'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a detailed Jira issue description based on the user's description.
The description should:
- Provide context and details about the issue
- Include steps to reproduce (for bugs) or requirements (for features)
- Be professional and clear

Return ONLY the description text - no explanations.`,
        placeholder:
          'Describe the issue details (e.g., "users seeing 500 error when clicking submit")...',
      },
    },
    // Write Issue additional fields
    {
      id: 'assignee',
      title: 'Assignee Account ID',
      type: 'short-input',
      placeholder: 'Assignee account ID (e.g., 5b109f2e9729b51b54dc274d)',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'priority',
      title: 'Priority',
      type: 'short-input',
      placeholder: 'Priority ID or name (e.g., "10000" or "High")',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'labels',
      title: 'Labels',
      type: 'short-input',
      placeholder: 'Comma-separated labels (e.g., bug, urgent)',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'duedate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD (e.g., 2024-12-31)',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "tomorrow" -> Calculate tomorrow's date
- "next week" -> Calculate 7 days from now
- "end of month" -> Calculate the last day of the current month
- "in 2 weeks" -> Calculate 14 days from now

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the due date (e.g., "next Friday", "end of month")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'reporter',
      title: 'Reporter Account ID',
      type: 'short-input',
      placeholder: 'Reporter account ID',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'long-input',
      placeholder: 'Environment information (e.g., Production, Staging)',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'customFieldId',
      title: 'Custom Field ID',
      type: 'short-input',
      placeholder: 'e.g., customfield_10001 or 10001',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'customFieldValue',
      title: 'Custom Field Value',
      type: 'short-input',
      placeholder: 'Value for the custom field',
      dependsOn: ['projectId'],
      condition: { field: 'operation', value: 'write' },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a transition comment for a Jira issue based on the user's description.
The comment should:
- Explain the reason for the status change
- Provide any relevant context
- Be professional and informative

Return ONLY the comment text - no explanations.`,
        placeholder: 'Describe the transition reason (e.g., "fixed bug", "ready for QA review")...',
      },
    },
    // Search Issues fields
    {
      id: 'jql',
      title: 'JQL Query',
      type: 'long-input',
      required: true,
      placeholder: 'Enter JQL query (e.g., project = PROJ AND status = "In Progress")',
      condition: { field: 'operation', value: 'search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JQL (Jira Query Language) query based on the user's description.
JQL syntax examples:
- project = PROJ
- status = "In Progress"
- assignee = currentUser()
- created >= -7d
- priority = High AND status != Done
- labels in (bug, urgent)

Return ONLY the JQL query - no explanations or markdown formatting.`,
        placeholder:
          'Describe what you want to search for (e.g., "open bugs assigned to me", "high priority issues from last week")...',
        generationType: 'sql-query',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a Jira issue comment based on the user's description.
The comment should:
- Be professional and informative
- Provide relevant updates or information
- Be suitable for team collaboration

Return ONLY the comment text - no explanations.`,
        placeholder:
          'Describe what you want to comment (e.g., "update on investigation", "requesting review")...',
      },
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
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files',
      condition: { field: 'operation', value: 'add_attachment' },
      mode: 'basic',
      multiple: true,
      required: true,
    },
    {
      id: 'files',
      title: 'File References',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'File reference from previous block',
      condition: { field: 'operation', value: 'add_attachment' },
      mode: 'advanced',
      required: true,
    },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a worklog comment for Jira based on the user's description.
The comment should:
- Describe the work that was done
- Be concise but informative
- Be suitable for time tracking records

Return ONLY the comment text - no explanations.`,
        placeholder:
          'Describe the work done (e.g., "implemented API endpoint", "fixed login bug")...',
      },
    },
    {
      id: 'started',
      title: 'Started At',
      type: 'short-input',
      placeholder: 'ISO timestamp (defaults to now)',
      condition: { field: 'operation', value: ['add_worklog', 'update_worklog'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SS.sssZ (UTC timezone).
Examples:
- "now" -> Current timestamp
- "yesterday at 9am" -> Yesterday's date at 09:00:00.000Z
- "last Monday at 2pm" -> Calculate last Monday at 14:00:00.000Z
- "start of today" -> Today's date at 00:00:00.000Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when the work started (e.g., "yesterday at 9am")...',
        generationType: 'timestamp',
      },
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a comment for a Jira issue link based on the user's description.
The comment should:
- Explain why the issues are linked
- Provide context for the relationship
- Be concise and clear

Return ONLY the comment text - no explanations.`,
        placeholder:
          'Describe the relationship (e.g., "blocks deployment", "related to refactoring effort")...',
      },
    },
    {
      id: 'linkId',
      title: 'Link ID',
      type: 'short-input',
      required: true,
      placeholder: 'Enter link ID to delete',
      condition: { field: 'operation', value: 'delete_link' },
    },
    // Get Users fields
    {
      id: 'userAccountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Enter account ID for specific user',
      condition: { field: 'operation', value: 'get_users' },
    },
    {
      id: 'usersStartAt',
      title: 'Start At',
      type: 'short-input',
      placeholder: 'Pagination start index (default: 0)',
      condition: { field: 'operation', value: 'get_users' },
    },
    {
      id: 'usersMaxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum users to return (default: 50)',
      condition: { field: 'operation', value: 'get_users' },
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
      'jira_add_attachment',
      'jira_delete_attachment',
      'jira_add_worklog',
      'jira_get_worklogs',
      'jira_update_worklog',
      'jira_delete_worklog',
      'jira_create_issue_link',
      'jira_delete_issue_link',
      'jira_add_watcher',
      'jira_remove_watcher',
      'jira_get_users',
    ],
    config: {
      tool: (params) => {
        // Use canonical param IDs (raw subBlock IDs are deleted after serialization)
        const effectiveProjectId = params.projectId ? String(params.projectId).trim() : ''
        const effectiveIssueKey = params.issueKey ? String(params.issueKey).trim() : ''

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
          case 'add_attachment':
            return 'jira_add_attachment'
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
          case 'get_users':
            return 'jira_get_users'
          default:
            return 'jira_retrieve'
        }
      },
      params: (params) => {
        const { credential, projectId, issueKey, ...rest } = params

        // Use canonical param IDs (raw subBlock IDs are deleted after serialization)
        const effectiveProjectId = projectId ? String(projectId).trim() : ''
        const effectiveIssueKey = issueKey ? String(issueKey).trim() : ''

        const baseParams = {
          credential,
          domain: params.domain,
        }

        switch (params.operation) {
          case 'write': {
            // Parse comma-separated strings into arrays
            const parseCommaSeparated = (value: string | undefined): string[] | undefined => {
              if (!value || value.trim() === '') return undefined
              return value
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item !== '')
            }

            const customFieldValue = params.customFieldValue || undefined

            const writeParams = {
              projectId: effectiveProjectId,
              summary: params.summary || '',
              description: params.description || '',
              issueType: params.issueType || 'Task',
              parent: params.parentIssue ? { key: params.parentIssue } : undefined,
              assignee: params.assignee || undefined,
              priority: params.priority || undefined,
              labels: parseCommaSeparated(params.labels),
              duedate: params.duedate || undefined,
              reporter: params.reporter || undefined,
              environment: params.environment || undefined,
              customFieldId: params.customFieldId || undefined,
              customFieldValue: customFieldValue,
            }
            return {
              ...baseParams,
              ...writeParams,
            }
          }
          case 'update': {
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
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              // Include projectId if available for context
              ...(effectiveProjectId && { projectId: effectiveProjectId }),
            }
          }
          case 'read-bulk': {
            return {
              ...baseParams,
              projectId: effectiveProjectId.trim(),
            }
          }
          case 'delete': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              deleteSubtasks: params.deleteSubtasks === 'true',
            }
          }
          case 'assign': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              accountId: params.accountId,
            }
          }
          case 'transition': {
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
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              body: params.commentBody,
            }
          }
          case 'get_comments': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              maxResults: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          }
          case 'update_comment': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              commentId: params.commentId,
              body: params.commentBody,
            }
          }
          case 'delete_comment': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              commentId: params.commentId,
            }
          }
          case 'get_attachments': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
            }
          }
          case 'add_attachment': {
            const normalizedFiles = normalizeFileInput(params.files)
            if (!normalizedFiles || normalizedFiles.length === 0) {
              throw new Error('At least one attachment file is required.')
            }
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              files: normalizedFiles,
            }
          }
          case 'delete_attachment': {
            return {
              ...baseParams,
              attachmentId: params.attachmentId,
            }
          }
          case 'add_worklog': {
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
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              maxResults: params.maxResults ? Number.parseInt(params.maxResults) : undefined,
            }
          }
          case 'update_worklog': {
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
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              accountId: params.accountId,
            }
          }
          case 'remove_watcher': {
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
              accountId: params.accountId,
            }
          }
          case 'get_users': {
            return {
              ...baseParams,
              accountId: params.userAccountId || undefined,
              startAt: params.usersStartAt ? Number.parseInt(params.usersStartAt) : undefined,
              maxResults: params.usersMaxResults
                ? Number.parseInt(params.usersMaxResults)
                : undefined,
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
    issueKey: { type: 'string', description: 'Issue key identifier (canonical param)' },
    projectId: { type: 'string', description: 'Project identifier (canonical param)' },
    // Update/Write operation inputs
    summary: { type: 'string', description: 'Issue summary' },
    description: { type: 'string', description: 'Issue description' },
    issueType: { type: 'string', description: 'Issue type' },
    // Write operation additional inputs
    assignee: { type: 'string', description: 'Assignee account ID' },
    priority: { type: 'string', description: 'Priority ID or name' },
    labels: { type: 'string', description: 'Comma-separated labels for the issue' },
    duedate: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
    reporter: { type: 'string', description: 'Reporter account ID' },
    environment: { type: 'string', description: 'Environment information' },
    customFieldId: { type: 'string', description: 'Custom field ID (e.g., customfield_10001)' },
    customFieldValue: { type: 'string', description: 'Value for the custom field' },
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
    files: { type: 'array', description: 'Files to attach (canonical param)' },
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
    // Get Users operation inputs
    userAccountId: {
      type: 'string',
      description: 'Account ID for specific user lookup (optional)',
    },
    usersStartAt: { type: 'string', description: 'Pagination start index for users' },
    usersMaxResults: { type: 'string', description: 'Maximum users to return' },
  },
  outputs: {
    // Common outputs across all Jira operations
    ts: { type: 'string', description: 'Timestamp of the operation' },

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
    files: { type: 'file[]', description: 'Uploaded attachment files' },
    attachmentIds: { type: 'json', description: 'Uploaded attachment IDs' },

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

    // jira_get_users outputs
    users: {
      type: 'json',
      description: 'Array of users with accountId, displayName, emailAddress, active status',
    },

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
