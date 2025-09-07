import { JiraIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { JiraResponse } from '@/tools/jira/types'

export const JiraBlock: BlockConfig<JiraResponse> = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  longDescription:
    'Connect to Jira workspaces to read, write, and update issues. Access content, metadata, and integrate Jira documentation into your workflows.',
  docsLink: 'https://docs.sim.ai/tools/jira',
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
      value: () => 'read',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter Jira domain (e.g., simstudio.atlassian.net)',
    },
    {
      id: 'credential',
      title: 'Jira Account',
      type: 'oauth-input',
      layout: 'full',
      required: true,
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
      layout: 'full',
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
      layout: 'full',
      canonicalParamId: 'issueKey',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira issue',
      dependsOn: ['credential', 'domain', 'projectId'],
      condition: { field: 'operation', value: ['read', 'update'] },
      mode: 'basic',
    },
    // Manual issue key input (advanced mode)
    {
      id: 'manualIssueKey',
      title: 'Issue Key',
      type: 'short-input',
      layout: 'full',
      canonicalParamId: 'issueKey',
      placeholder: 'Enter Jira issue key',
      dependsOn: ['credential', 'domain', 'projectId'],
      condition: { field: 'operation', value: ['read', 'update'] },
      mode: 'advanced',
    },
    {
      id: 'summary',
      title: 'New Summary',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter new summary for the issue',
      dependsOn: ['issueKey'],
      condition: { field: 'operation', value: ['update', 'write'] },
    },
    {
      id: 'description',
      title: 'New Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter new description for the issue',
      dependsOn: ['issueKey'],
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
            if (!effectiveIssueKey) {
              throw new Error(
                'Issue Key is required. Please select an issue or enter an issue key manually.'
              )
            }
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
    operation: { type: 'string', description: 'Operation to perform' },
    domain: { type: 'string', description: 'Jira domain' },
    credential: { type: 'string', description: 'Jira access token' },
    issueKey: { type: 'string', description: 'Issue key identifier' },
    projectId: { type: 'string', description: 'Project identifier' },
    manualProjectId: { type: 'string', description: 'Manual project identifier' },
    manualIssueKey: { type: 'string', description: 'Manual issue key' },
    // Update operation inputs
    summary: { type: 'string', description: 'Issue summary' },
    description: { type: 'string', description: 'Issue description' },
    // Write operation inputs
    issueType: { type: 'string', description: 'Issue type' },
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

    // jira_update outputs
    success: { type: 'boolean', description: 'Whether the update operation was successful' },

    // jira_write (create) outputs
    url: { type: 'string', description: 'URL to the created/accessed issue' },

    // jira_bulk_read outputs (array of issues)
    // Note: bulk_read returns an array in the output field, each item contains:
    // ts, summary, description, created, updated
  },
}
