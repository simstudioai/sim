import { JiraIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { JiraResponse } from '@/tools/jira/types'

export const JiraBlock: BlockConfig<JiraResponse> = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  longDescription:
    'Connect to Jira workspaces to read, write, and update issues. Access content, metadata, and integrate Jira documentation into your workflows.',
  docsLink: 'https://docs.simstudio.ai/tools/jira',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: JiraIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Issue', id: 'read' },
        { label: 'Read Issues', id: 'read-bulk' },
        { label: 'Update Issue', id: 'update' },
        { label: 'Write Issue', id: 'write' },
      ],
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Jira domain (e.g., simstudio.atlassian.net)',
    },
    {
      id: 'credential',
      title: 'Jira Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      requiredScopes: [
        'read:jira-work',
        'read:jira-user',
        'write:jira-work',
        'read:issue-event:jira',
        'write:issue:jira',
        'read:me',
        'offline_access',
      ],
      placeholder: 'Select Jira account',
    },
    // Project selector (basic mode)
    {
      id: 'projectId',
      title: 'Select Project',
      type: 'project-selector',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira project',
      mode: 'basic',
    },
    // Manual project ID input (advanced mode)
    {
      id: 'manualProjectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Jira project ID',
      mode: 'advanced',
    },
    // Issue selector (basic mode)
    {
      id: 'issueKey',
      title: 'Select Issue',
      type: 'file-selector',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira issue',
      condition: { field: 'operation', value: ['read', 'update'] },
      mode: 'basic',
    },
    // Manual issue key input (advanced mode)
    {
      id: 'manualIssueKey',
      title: 'Issue Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Jira issue key',
      condition: { field: 'operation', value: ['read', 'update'] },
      mode: 'advanced',
    },
    {
      id: 'summary',
      title: 'New Summary',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter new summary for the issue',
      condition: { field: 'operation', value: ['update', 'write'] },
    },
    {
      id: 'description',
      title: 'New Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter new description for the issue',
      condition: { field: 'operation', value: ['update', 'write'] },
    },
  ],
  tools: {
    access: ['jira_retrieve', 'jira_update', 'jira_write', 'jira_bulk_read'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'jira_retrieve'
          case 'update':
            return 'jira_update'
          case 'write':
            return 'jira_write'
          case 'read-bulk':
            return 'jira_bulk_read'
          default:
            return 'jira_retrieve'
        }
      },
      params: (params) => {
        const { credential, projectId, manualProjectId, issueKey, manualIssueKey, ...rest } = params

        // Base params that are always needed
        const baseParams = {
          accessToken: credential,
          domain: params.domain,
        }

        // Use the selected project ID or the manually entered one
        const effectiveProjectId = (projectId || manualProjectId || '').trim()

        // Use the selected issue key or the manually entered one
        const effectiveIssueKey = (issueKey || manualIssueKey || '').trim()

        // Define allowed parameters for each operation
        switch (params.operation) {
          case 'write': {
            if (!effectiveProjectId) {
              throw new Error(
                'Project ID is required. Please select a project or enter a project ID manually.'
              )
            }

            // For write operations, only include write-specific fields
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

            // For update operations, only include update-specific fields
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
            if (!effectiveIssueKey) {
              throw new Error(
                'Issue Key is required. Please select an issue or enter an issue key manually.'
              )
            }

            // For read operations, only include read-specific fields
            return {
              ...baseParams,
              issueKey: effectiveIssueKey,
            }
          }
          case 'read-bulk': {
            if (!effectiveProjectId) {
              throw new Error(
                'Project ID is required. Please select a project or enter a project ID manually.'
              )
            }

            // For read-bulk operations, only include read-bulk-specific fields
            return {
              ...baseParams,
              projectId: effectiveProjectId,
            }
          }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    domain: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    issueKey: { type: 'string', required: false },
    projectId: { type: 'string', required: false },
    manualProjectId: { type: 'string', required: false },
    manualIssueKey: { type: 'string', required: false },
    // Update operation inputs
    summary: { type: 'string', required: true },
    description: { type: 'string', required: false },
    // Write operation inputs
    issueType: { type: 'string', required: false },
  },
  outputs: {
    ts: 'string',
    issueKey: 'string',
    summary: 'string',
    description: 'string',
    created: 'string',
    updated: 'string',
    success: 'boolean',
    url: 'string',
  },
}
