import { LinearIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { LinearResponse } from '@/tools/linear/types'

export const LinearBlock: BlockConfig<LinearResponse> = {
  type: 'linear',
  name: 'Linear',
  description: 'Interact with Linear issues, projects, and more',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Linear into the workflow. Can manage issues, comments, projects, labels, workflow states, cycles, attachments, and more.',
  docsLink: 'https://docs.sim.ai/tools/linear',
  category: 'tools',
  icon: LinearIcon,
  bgColor: '#5E6AD2',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        // Issue Operations
        { label: 'Read Issues', id: 'linear_read_issues' },
        { label: 'Get Issue', id: 'linear_get_issue' },
        { label: 'Create Issue', id: 'linear_create_issue' },
        { label: 'Update Issue', id: 'linear_update_issue' },
        { label: 'Archive Issue', id: 'linear_archive_issue' },
        { label: 'Unarchive Issue', id: 'linear_unarchive_issue' },
        { label: 'Delete Issue', id: 'linear_delete_issue' },
        { label: 'Search Issues', id: 'linear_search_issues' },
        { label: 'Add Label to Issue', id: 'linear_add_label_to_issue' },
        { label: 'Remove Label from Issue', id: 'linear_remove_label_from_issue' },
        // Comment Operations
        { label: 'Create Comment', id: 'linear_create_comment' },
        { label: 'Update Comment', id: 'linear_update_comment' },
        { label: 'Delete Comment', id: 'linear_delete_comment' },
        { label: 'List Comments', id: 'linear_list_comments' },
        // Project Operations
        { label: 'List Projects', id: 'linear_list_projects' },
        { label: 'Get Project', id: 'linear_get_project' },
        { label: 'Create Project', id: 'linear_create_project' },
        { label: 'Update Project', id: 'linear_update_project' },
        { label: 'Archive Project', id: 'linear_archive_project' },
        // User & Team Operations
        { label: 'List Users', id: 'linear_list_users' },
        { label: 'List Teams', id: 'linear_list_teams' },
        { label: 'Get Viewer', id: 'linear_get_viewer' },
        // Label Operations
        { label: 'List Labels', id: 'linear_list_labels' },
        { label: 'Create Label', id: 'linear_create_label' },
        { label: 'Update Label', id: 'linear_update_label' },
        { label: 'Archive Label', id: 'linear_archive_label' },
        // Workflow State Operations
        { label: 'List Workflow States', id: 'linear_list_workflow_states' },
        { label: 'Create Workflow State', id: 'linear_create_workflow_state' },
        { label: 'Update Workflow State', id: 'linear_update_workflow_state' },
        // Cycle Operations
        { label: 'List Cycles', id: 'linear_list_cycles' },
        { label: 'Get Cycle', id: 'linear_get_cycle' },
        { label: 'Create Cycle', id: 'linear_create_cycle' },
        { label: 'Get Active Cycle', id: 'linear_get_active_cycle' },
        // Attachment Operations
        { label: 'Create Attachment', id: 'linear_create_attachment' },
        { label: 'List Attachments', id: 'linear_list_attachments' },
        { label: 'Update Attachment', id: 'linear_update_attachment' },
        { label: 'Delete Attachment', id: 'linear_delete_attachment' },
        // Issue Relation Operations
        { label: 'Create Issue Relation', id: 'linear_create_issue_relation' },
        { label: 'List Issue Relations', id: 'linear_list_issue_relations' },
        { label: 'Delete Issue Relation', id: 'linear_delete_issue_relation' },
        // Favorite Operations
        { label: 'Create Favorite', id: 'linear_create_favorite' },
        { label: 'List Favorites', id: 'linear_list_favorites' },
        // Project Update Operations
        { label: 'Create Project Update', id: 'linear_create_project_update' },
        { label: 'List Project Updates', id: 'linear_list_project_updates' },
        { label: 'Create Project Link', id: 'linear_create_project_link' },
        // Notification Operations
        { label: 'List Notifications', id: 'linear_list_notifications' },
        { label: 'Update Notification', id: 'linear_update_notification' },
      ],
      value: () => 'linear_read_issues',
    },
    {
      id: 'credential',
      title: 'Linear Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'linear',
      serviceId: 'linear',
      requiredScopes: ['read', 'write'],
      placeholder: 'Select Linear account',
      required: true,
    },
    // Team selector (for most operations)
    {
      id: 'teamId',
      title: 'Team',
      type: 'project-selector',
      layout: 'full',
      canonicalParamId: 'teamId',
      provider: 'linear',
      serviceId: 'linear',
      placeholder: 'Select a team',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'linear_read_issues',
          'linear_create_issue',
          'linear_search_issues',
          'linear_list_projects',
          'linear_create_project',
          'linear_list_labels',
          'linear_list_workflow_states',
          'linear_create_workflow_state',
          'linear_list_cycles',
          'linear_create_cycle',
          'linear_get_active_cycle',
        ],
      },
    },
    // Manual team ID input (advanced mode)
    {
      id: 'manualTeamId',
      title: 'Team ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'teamId',
      placeholder: 'Enter Linear team ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'linear_read_issues',
          'linear_create_issue',
          'linear_search_issues',
          'linear_list_projects',
          'linear_create_project',
          'linear_list_labels',
          'linear_list_workflow_states',
          'linear_create_workflow_state',
          'linear_list_cycles',
          'linear_create_cycle',
          'linear_get_active_cycle',
        ],
      },
    },
    // Project selector (for issue creation)
    {
      id: 'projectId',
      title: 'Project',
      type: 'project-selector',
      layout: 'full',
      canonicalParamId: 'projectId',
      provider: 'linear',
      serviceId: 'linear',
      placeholder: 'Select a project',
      dependsOn: ['credential', 'teamId'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: ['linear_read_issues', 'linear_create_issue'],
      },
    },
    // Manual project ID input (advanced mode)
    {
      id: 'manualProjectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'projectId',
      placeholder: 'Enter Linear project ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'linear_read_issues',
          'linear_create_issue',
          'linear_get_project',
          'linear_update_project',
          'linear_archive_project',
          'linear_create_project_update',
          'linear_list_project_updates',
          'linear_create_project_link',
        ],
      },
    },
    // Issue ID input (for operations requiring issue ID)
    {
      id: 'issueId',
      title: 'Issue ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Linear issue ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'linear_get_issue',
          'linear_update_issue',
          'linear_archive_issue',
          'linear_unarchive_issue',
          'linear_delete_issue',
          'linear_add_label_to_issue',
          'linear_remove_label_from_issue',
          'linear_create_comment',
          'linear_list_comments',
          'linear_create_attachment',
          'linear_list_attachments',
          'linear_create_issue_relation',
          'linear_list_issue_relations',
        ],
      },
    },
    // Title (for issue creation/update)
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter issue title',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_create_issue', 'linear_update_issue'],
      },
    },
    // Description (for issue creation/update, comments, projects)
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter description',
      condition: {
        field: 'operation',
        value: [
          'linear_create_issue',
          'linear_update_issue',
          'linear_create_project',
          'linear_update_project',
        ],
      },
    },
    // Comment body
    {
      id: 'body',
      title: 'Comment',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter comment text',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_create_comment', 'linear_update_comment', 'linear_create_project_update'],
      },
    },
    // Comment ID
    {
      id: 'commentId',
      title: 'Comment ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter comment ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_update_comment', 'linear_delete_comment'],
      },
    },
    // Label ID
    {
      id: 'labelId',
      title: 'Label ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter label ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'linear_add_label_to_issue',
          'linear_remove_label_from_issue',
          'linear_update_label',
          'linear_archive_label',
        ],
      },
    },
    // Label name (for creating labels)
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter name',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'linear_create_label',
          'linear_update_label',
          'linear_create_project',
          'linear_update_project',
          'linear_create_workflow_state',
          'linear_update_workflow_state',
          'linear_create_cycle',
        ],
      },
    },
    // Label color
    {
      id: 'color',
      title: 'Color (hex)',
      type: 'short-input',
      layout: 'full',
      placeholder: '#5E6AD2',
      condition: {
        field: 'operation',
        value: [
          'linear_create_label',
          'linear_update_label',
          'linear_create_workflow_state',
          'linear_update_workflow_state',
        ],
      },
    },
    // State ID (for issue updates)
    {
      id: 'stateId',
      title: 'State ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter workflow state ID',
      condition: {
        field: 'operation',
        value: ['linear_update_issue', 'linear_update_workflow_state'],
      },
    },
    // Assignee ID (for issue operations)
    {
      id: 'assigneeId',
      title: 'Assignee ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter user ID to assign',
      condition: {
        field: 'operation',
        value: ['linear_create_issue', 'linear_update_issue'],
      },
    },
    // Priority (for issues and projects)
    {
      id: 'priority',
      title: 'Priority',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'No Priority', id: '0' },
        { label: 'Urgent', id: '1' },
        { label: 'High', id: '2' },
        { label: 'Normal', id: '3' },
        { label: 'Low', id: '4' },
      ],
      value: () => '0',
      condition: {
        field: 'operation',
        value: ['linear_create_issue', 'linear_update_issue', 'linear_create_project'],
      },
    },
    // Estimate (for issues)
    {
      id: 'estimate',
      title: 'Estimate',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter estimate points',
      condition: {
        field: 'operation',
        value: ['linear_create_issue', 'linear_update_issue'],
      },
    },
    // Search query
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search query',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_search_issues'],
      },
    },
    // Include archived (for list operations)
    {
      id: 'includeArchived',
      title: 'Include Archived',
      type: 'switch',
      layout: 'full',
      condition: {
        field: 'operation',
        value: ['linear_read_issues', 'linear_search_issues', 'linear_list_projects'],
      },
    },
    // Cycle ID
    {
      id: 'cycleId',
      title: 'Cycle ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter cycle ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_get_cycle'],
      },
    },
    // Cycle start/end dates
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['linear_create_cycle', 'linear_create_project'],
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['linear_create_cycle'],
      },
    },
    // Target date (for projects)
    {
      id: 'targetDate',
      title: 'Target Date',
      type: 'short-input',
      layout: 'full',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: ['linear_create_project', 'linear_update_project'],
      },
    },
    // Attachment URL
    {
      id: 'url',
      title: 'URL',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter URL',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_create_attachment', 'linear_create_project_link'],
      },
    },
    // Attachment title
    {
      id: 'attachmentTitle',
      title: 'Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter attachment title',
      condition: {
        field: 'operation',
        value: ['linear_create_attachment', 'linear_update_attachment'],
      },
    },
    // Attachment ID
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter attachment ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_update_attachment', 'linear_delete_attachment'],
      },
    },
    // Issue relation type
    {
      id: 'relationType',
      title: 'Relation Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Blocks', id: 'blocks' },
        { label: 'Blocked by', id: 'blocked' },
        { label: 'Duplicate', id: 'duplicate' },
        { label: 'Related', id: 'related' },
      ],
      value: () => 'related',
      condition: {
        field: 'operation',
        value: ['linear_create_issue_relation'],
      },
    },
    // Related issue ID
    {
      id: 'relatedIssueId',
      title: 'Related Issue ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter related issue ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_create_issue_relation'],
      },
    },
    // Relation ID
    {
      id: 'relationId',
      title: 'Relation ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter relation ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_delete_issue_relation'],
      },
    },
    // Favorite type
    {
      id: 'favoriteType',
      title: 'Favorite Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Issue', id: 'issue' },
        { label: 'Project', id: 'project' },
        { label: 'Cycle', id: 'cycle' },
        { label: 'Label', id: 'label' },
      ],
      value: () => 'issue',
      condition: {
        field: 'operation',
        value: ['linear_create_favorite'],
      },
    },
    // Favorite target ID
    {
      id: 'favoriteTargetId',
      title: 'Target ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter ID to favorite',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_create_favorite'],
      },
    },
    // Project health (for project updates)
    {
      id: 'health',
      title: 'Project Health',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'On Track', id: 'onTrack' },
        { label: 'At Risk', id: 'atRisk' },
        { label: 'Off Track', id: 'offTrack' },
      ],
      value: () => 'onTrack',
      condition: {
        field: 'operation',
        value: ['linear_create_project_update'],
      },
    },
    // Notification ID
    {
      id: 'notificationId',
      title: 'Notification ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter notification ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['linear_update_notification'],
      },
    },
    // Mark as read
    {
      id: 'markAsRead',
      title: 'Mark as Read',
      type: 'switch',
      layout: 'full',
      condition: {
        field: 'operation',
        value: ['linear_update_notification'],
      },
    },
    // Workflow state type
    {
      id: 'workflowType',
      title: 'Workflow Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Backlog', id: 'backlog' },
        { label: 'Unstarted', id: 'unstarted' },
        { label: 'Started', id: 'started' },
        { label: 'Completed', id: 'completed' },
        { label: 'Canceled', id: 'canceled' },
      ],
      value: () => 'started',
      condition: {
        field: 'operation',
        value: ['linear_create_workflow_state'],
      },
    },
    // Lead ID (for projects)
    {
      id: 'leadId',
      title: 'Lead ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter user ID for project lead',
      condition: {
        field: 'operation',
        value: ['linear_create_project', 'linear_update_project'],
      },
    },
    // Project state
    {
      id: 'projectState',
      title: 'Project State',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter project state',
      condition: {
        field: 'operation',
        value: ['linear_update_project'],
      },
    },
  ],
  tools: {
    access: [
      'linear_read_issues',
      'linear_get_issue',
      'linear_create_issue',
      'linear_update_issue',
      'linear_archive_issue',
      'linear_unarchive_issue',
      'linear_delete_issue',
      'linear_search_issues',
      'linear_add_label_to_issue',
      'linear_remove_label_from_issue',
      'linear_create_comment',
      'linear_update_comment',
      'linear_delete_comment',
      'linear_list_comments',
      'linear_list_projects',
      'linear_get_project',
      'linear_create_project',
      'linear_update_project',
      'linear_archive_project',
      'linear_list_users',
      'linear_list_teams',
      'linear_get_viewer',
      'linear_list_labels',
      'linear_create_label',
      'linear_update_label',
      'linear_archive_label',
      'linear_list_workflow_states',
      'linear_create_workflow_state',
      'linear_update_workflow_state',
      'linear_list_cycles',
      'linear_get_cycle',
      'linear_create_cycle',
      'linear_get_active_cycle',
      'linear_create_attachment',
      'linear_list_attachments',
      'linear_update_attachment',
      'linear_delete_attachment',
      'linear_create_issue_relation',
      'linear_list_issue_relations',
      'linear_delete_issue_relation',
      'linear_create_favorite',
      'linear_list_favorites',
      'linear_create_project_update',
      'linear_list_project_updates',
      'linear_create_project_link',
      'linear_list_notifications',
      'linear_update_notification',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'linear_read_issues'
      },
      params: (params) => {
        // Handle both selector and manual inputs
        const effectiveTeamId = (params.teamId || params.manualTeamId || '').trim()
        const effectiveProjectId = (params.projectId || params.manualProjectId || '').trim()

        // Base params that most operations need
        const baseParams: Record<string, any> = {
          credential: params.credential,
        }

        // Operation-specific param mapping
        switch (params.operation) {
          case 'linear_read_issues':
            if (!effectiveTeamId || !effectiveProjectId) {
              throw new Error('Team ID and Project ID are required.')
            }
            return {
              ...baseParams,
              teamId: effectiveTeamId,
              projectId: effectiveProjectId,
              includeArchived: params.includeArchived,
            }

          case 'linear_get_issue':
            if (!params.issueId?.trim()) {
              throw new Error('Issue ID is required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
            }

          case 'linear_create_issue':
            if (!effectiveTeamId || !effectiveProjectId) {
              throw new Error('Team ID and Project ID are required.')
            }
            if (!params.title?.trim()) {
              throw new Error('Title is required.')
            }
            return {
              ...baseParams,
              teamId: effectiveTeamId,
              projectId: effectiveProjectId,
              title: params.title.trim(),
              description: params.description,
              stateId: params.stateId,
              assigneeId: params.assigneeId,
              priority: params.priority ? Number(params.priority) : undefined,
              estimate: params.estimate ? Number(params.estimate) : undefined,
            }

          case 'linear_update_issue':
            if (!params.issueId?.trim()) {
              throw new Error('Issue ID is required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
              title: params.title,
              description: params.description,
              stateId: params.stateId,
              assigneeId: params.assigneeId,
              priority: params.priority ? Number(params.priority) : undefined,
              estimate: params.estimate ? Number(params.estimate) : undefined,
            }

          case 'linear_archive_issue':
          case 'linear_unarchive_issue':
          case 'linear_delete_issue':
            if (!params.issueId?.trim()) {
              throw new Error('Issue ID is required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
            }

          case 'linear_search_issues':
            if (!params.query?.trim()) {
              throw new Error('Search query is required.')
            }
            return {
              ...baseParams,
              query: params.query.trim(),
              teamId: effectiveTeamId,
              includeArchived: params.includeArchived,
            }

          case 'linear_add_label_to_issue':
          case 'linear_remove_label_from_issue':
            if (!params.issueId?.trim() || !params.labelId?.trim()) {
              throw new Error('Issue ID and Label ID are required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
              labelId: params.labelId.trim(),
            }

          case 'linear_create_comment':
            if (!params.issueId?.trim() || !params.body?.trim()) {
              throw new Error('Issue ID and comment body are required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
              body: params.body.trim(),
            }

          case 'linear_update_comment':
            if (!params.commentId?.trim() || !params.body?.trim()) {
              throw new Error('Comment ID and body are required.')
            }
            return {
              ...baseParams,
              commentId: params.commentId.trim(),
              body: params.body.trim(),
            }

          case 'linear_delete_comment':
            if (!params.commentId?.trim()) {
              throw new Error('Comment ID is required.')
            }
            return {
              ...baseParams,
              commentId: params.commentId.trim(),
            }

          case 'linear_list_comments':
            if (!params.issueId?.trim()) {
              throw new Error('Issue ID is required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
            }

          case 'linear_list_projects':
            return {
              ...baseParams,
              teamId: effectiveTeamId,
              includeArchived: params.includeArchived,
            }

          case 'linear_get_project':
            if (!effectiveProjectId) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: effectiveProjectId,
            }

          case 'linear_create_project':
            if (!effectiveTeamId || !params.name?.trim()) {
              throw new Error('Team ID and project name are required.')
            }
            return {
              ...baseParams,
              teamId: effectiveTeamId,
              name: params.name.trim(),
              description: params.description,
              leadId: params.leadId,
              startDate: params.startDate,
              targetDate: params.targetDate,
              priority: params.priority ? Number(params.priority) : undefined,
            }

          case 'linear_update_project':
            if (!effectiveProjectId) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: effectiveProjectId,
              name: params.name,
              description: params.description,
              state: params.projectState,
              leadId: params.leadId,
              targetDate: params.targetDate,
            }

          case 'linear_archive_project':
            if (!effectiveProjectId) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: effectiveProjectId,
            }

          case 'linear_list_users':
          case 'linear_list_teams':
          case 'linear_get_viewer':
            return baseParams

          case 'linear_list_labels':
            return {
              ...baseParams,
              teamId: effectiveTeamId,
            }

          case 'linear_create_label':
            if (!params.name?.trim()) {
              throw new Error('Label name is required.')
            }
            return {
              ...baseParams,
              name: params.name.trim(),
              color: params.color,
              teamId: effectiveTeamId,
            }

          case 'linear_update_label':
            if (!params.labelId?.trim()) {
              throw new Error('Label ID is required.')
            }
            return {
              ...baseParams,
              labelId: params.labelId.trim(),
              name: params.name,
              color: params.color,
            }

          case 'linear_archive_label':
            if (!params.labelId?.trim()) {
              throw new Error('Label ID is required.')
            }
            return {
              ...baseParams,
              labelId: params.labelId.trim(),
            }

          case 'linear_list_workflow_states':
            return {
              ...baseParams,
              teamId: effectiveTeamId,
            }

          case 'linear_create_workflow_state':
            if (!effectiveTeamId || !params.name?.trim() || !params.workflowType) {
              throw new Error('Team ID, name, and workflow type are required.')
            }
            if (!params.color?.trim()) {
              throw new Error('Color is required for workflow state creation.')
            }
            return {
              ...baseParams,
              teamId: effectiveTeamId,
              name: params.name.trim(),
              type: params.workflowType,
              color: params.color.trim(),
            }

          case 'linear_update_workflow_state':
            if (!params.stateId?.trim()) {
              throw new Error('State ID is required.')
            }
            return {
              ...baseParams,
              stateId: params.stateId.trim(),
              name: params.name,
              color: params.color,
            }

          case 'linear_list_cycles':
            return {
              ...baseParams,
              teamId: effectiveTeamId,
            }

          case 'linear_get_cycle':
            if (!params.cycleId?.trim()) {
              throw new Error('Cycle ID is required.')
            }
            return {
              ...baseParams,
              cycleId: params.cycleId.trim(),
            }

          case 'linear_create_cycle':
            if (!effectiveTeamId || !params.name?.trim()) {
              throw new Error('Team ID and cycle name are required.')
            }
            return {
              ...baseParams,
              teamId: effectiveTeamId,
              name: params.name.trim(),
              startsAt: params.startDate,
              endsAt: params.endDate,
            }

          case 'linear_get_active_cycle':
            if (!effectiveTeamId) {
              throw new Error('Team ID is required.')
            }
            return {
              ...baseParams,
              teamId: effectiveTeamId,
            }

          case 'linear_create_attachment':
            if (!params.issueId?.trim() || !params.url?.trim()) {
              throw new Error('Issue ID and URL are required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
              url: params.url.trim(),
              title: params.attachmentTitle,
            }

          case 'linear_list_attachments':
            if (!params.issueId?.trim()) {
              throw new Error('Issue ID is required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
            }

          case 'linear_update_attachment':
            if (!params.attachmentId?.trim()) {
              throw new Error('Attachment ID is required.')
            }
            return {
              ...baseParams,
              attachmentId: params.attachmentId.trim(),
              title: params.attachmentTitle,
            }

          case 'linear_delete_attachment':
            if (!params.attachmentId?.trim()) {
              throw new Error('Attachment ID is required.')
            }
            return {
              ...baseParams,
              attachmentId: params.attachmentId.trim(),
            }

          case 'linear_create_issue_relation':
            if (!params.issueId?.trim() || !params.relatedIssueId?.trim() || !params.relationType) {
              throw new Error('Issue ID, related issue ID, and relation type are required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
              relatedIssueId: params.relatedIssueId.trim(),
              type: params.relationType,
            }

          case 'linear_list_issue_relations':
            if (!params.issueId?.trim()) {
              throw new Error('Issue ID is required.')
            }
            return {
              ...baseParams,
              issueId: params.issueId.trim(),
            }

          case 'linear_delete_issue_relation':
            if (!params.relationId?.trim()) {
              throw new Error('Relation ID is required.')
            }
            return {
              ...baseParams,
              relationId: params.relationId.trim(),
            }

          case 'linear_create_favorite':
            if (!params.favoriteTargetId?.trim() || !params.favoriteType) {
              throw new Error('Target ID and favorite type are required.')
            }
            return {
              ...baseParams,
              type: params.favoriteType,
              [`${params.favoriteType}Id`]: params.favoriteTargetId.trim(),
            }

          case 'linear_list_favorites':
            return baseParams

          case 'linear_create_project_update':
            if (!effectiveProjectId || !params.body?.trim()) {
              throw new Error('Project ID and update body are required.')
            }
            return {
              ...baseParams,
              projectId: effectiveProjectId,
              body: params.body.trim(),
              health: params.health,
            }

          case 'linear_list_project_updates':
            if (!effectiveProjectId) {
              throw new Error('Project ID is required.')
            }
            return {
              ...baseParams,
              projectId: effectiveProjectId,
            }

          case 'linear_create_project_link':
            if (!effectiveProjectId || !params.url?.trim()) {
              throw new Error('Project ID and URL are required.')
            }
            return {
              ...baseParams,
              projectId: effectiveProjectId,
              url: params.url.trim(),
              label: params.name,
            }

          case 'linear_list_notifications':
            return baseParams

          case 'linear_update_notification':
            if (!params.notificationId?.trim()) {
              throw new Error('Notification ID is required.')
            }
            return {
              ...baseParams,
              notificationId: params.notificationId.trim(),
              readAt: params.markAsRead ? new Date().toISOString() : null,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Linear access token' },
    teamId: { type: 'string', description: 'Linear team identifier' },
    projectId: { type: 'string', description: 'Linear project identifier' },
    manualTeamId: { type: 'string', description: 'Manual team identifier' },
    manualProjectId: { type: 'string', description: 'Manual project identifier' },
    issueId: { type: 'string', description: 'Issue identifier' },
    title: { type: 'string', description: 'Title' },
    description: { type: 'string', description: 'Description' },
    body: { type: 'string', description: 'Comment or update body' },
    commentId: { type: 'string', description: 'Comment identifier' },
    labelId: { type: 'string', description: 'Label identifier' },
    name: { type: 'string', description: 'Name field' },
    color: { type: 'string', description: 'Color in hex format' },
    stateId: { type: 'string', description: 'Workflow state identifier' },
    assigneeId: { type: 'string', description: 'Assignee user identifier' },
    priority: { type: 'string', description: 'Priority level' },
    estimate: { type: 'string', description: 'Estimate points' },
    query: { type: 'string', description: 'Search query' },
    includeArchived: { type: 'boolean', description: 'Include archived items' },
    cycleId: { type: 'string', description: 'Cycle identifier' },
    startDate: { type: 'string', description: 'Start date' },
    endDate: { type: 'string', description: 'End date' },
    targetDate: { type: 'string', description: 'Target date' },
    url: { type: 'string', description: 'URL' },
    attachmentTitle: { type: 'string', description: 'Attachment title' },
    attachmentId: { type: 'string', description: 'Attachment identifier' },
    relationType: { type: 'string', description: 'Relation type' },
    relatedIssueId: { type: 'string', description: 'Related issue identifier' },
    relationId: { type: 'string', description: 'Relation identifier' },
    favoriteType: { type: 'string', description: 'Favorite type' },
    favoriteTargetId: { type: 'string', description: 'Favorite target identifier' },
    health: { type: 'string', description: 'Project health status' },
    notificationId: { type: 'string', description: 'Notification identifier' },
    markAsRead: { type: 'boolean', description: 'Mark as read flag' },
    workflowType: { type: 'string', description: 'Workflow state type' },
    leadId: { type: 'string', description: 'Project lead identifier' },
    projectState: { type: 'string', description: 'Project state' },
  },
  outputs: {
    // Issue outputs
    issues: { type: 'json', description: 'Issues list' },
    issue: { type: 'json', description: 'Single issue data' },
    issueId: { type: 'string', description: 'Issue ID for operations' },
    // Comment outputs
    comment: { type: 'json', description: 'Comment data' },
    comments: { type: 'json', description: 'Comments list' },
    // Project outputs
    project: { type: 'json', description: 'Project data' },
    projects: { type: 'json', description: 'Projects list' },
    projectId: { type: 'string', description: 'Project ID for operations' },
    // User/Team outputs
    users: { type: 'json', description: 'Users list' },
    teams: { type: 'json', description: 'Teams list' },
    user: { type: 'json', description: 'User data' },
    viewer: { type: 'json', description: 'Current user data' },
    // Label outputs
    label: { type: 'json', description: 'Label data' },
    labels: { type: 'json', description: 'Labels list' },
    labelId: { type: 'string', description: 'Label ID for operations' },
    // Workflow state outputs
    state: { type: 'json', description: 'Workflow state data' },
    states: { type: 'json', description: 'Workflow states list' },
    // Cycle outputs
    cycle: { type: 'json', description: 'Cycle data' },
    cycles: { type: 'json', description: 'Cycles list' },
    // Attachment outputs
    attachment: { type: 'json', description: 'Attachment data' },
    attachments: { type: 'json', description: 'Attachments list' },
    // Relation outputs
    relation: { type: 'json', description: 'Issue relation data' },
    relations: { type: 'json', description: 'Issue relations list' },
    // Favorite outputs
    favorite: { type: 'json', description: 'Favorite data' },
    favorites: { type: 'json', description: 'Favorites list' },
    // Project update outputs
    update: { type: 'json', description: 'Project update data' },
    updates: { type: 'json', description: 'Project updates list' },
    link: { type: 'json', description: 'Project link data' },
    // Notification outputs
    notification: { type: 'json', description: 'Notification data' },
    notifications: { type: 'json', description: 'Notifications list' },
    // Pagination
    pageInfo: {
      type: 'json',
      description: 'Pagination information (hasNextPage, endCursor) for list operations',
    },
    // Success indicators
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
