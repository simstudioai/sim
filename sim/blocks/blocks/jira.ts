import { JiraIcon } from '@/components/icons'
import { BlockConfig } from '../types'
import { JiraRetrieveResponse, JiraUpdateResponse, JiraWriteResponse } from '@/tools/jira/types'

type JiraResponse = JiraRetrieveResponse | JiraUpdateResponse | JiraWriteResponse

export const JiraBlock: BlockConfig<JiraResponse> = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  longDescription:
    'Connect to Jira workspaces to read, write, and update issues. Access content, metadata, and integrate Jira documentation into your workflows.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: JiraIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Issue', id: 'read' },
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
    // Use file-selector component for issue selection
    {
      id: 'projectId',
      title: 'Select Project',
      type: 'project-selector',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira project',
      condition: { field: 'operation', value: ['read', 'update', 'write'] },
    },
    {
      id: 'issueKey',
      title: 'Select Issue',
      type: 'file-selector',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select Jira issue',
      condition: { field: 'operation', value: ['read', 'update'] },
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
    access: ['jira_retrieve', 'jira_update', 'jira_write'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'jira_retrieve'
          case 'update':
            return 'jira_update'
          case 'write':
            return 'jira_write'
          default:
            return 'jira_retrieve'
        }
      },
      params: (params) => {
        // Base params that are always needed
        const baseParams = {
          accessToken: params.credential,
          domain: params.domain,
        }
        
        // Define allowed parameters for each operation
        switch (params.operation) {
          case 'write': {
            // For write operations, only include write-specific fields
            const writeParams = {
              projectId: params.projectId,
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
            // For update operations, only include update-specific fields
            const updateParams = {
              projectId: params.projectId,
              issueKey: params.issueKey,
              summary: params.summary || '',
              description: params.description || '',
            }
            
            return {
              ...baseParams,
              ...updateParams,
            }
          }
          case 'read': {
            // For read operations, only include read-specific fields
            return {
              ...baseParams,
              issueKey: params.issueKey,
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
    issueKey: { type: 'string', required: true },
    projectId: { type: 'string', required: false },
    // Update operation inputs
    summary: { type: 'string', required: true },
    description: { type: 'string', required: false },
    // Write operation inputs
    issueType: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        ts: 'string',
        issueKey: 'string',
        summary: 'string',
        description: 'string',
        created: 'string',
        updated: 'string',
        success: 'boolean',
        url: 'string'
      },
    },
  },
}