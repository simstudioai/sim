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
    // Update issue fields
    {
      id: 'title',
      title: 'New Summary',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter new summary for the issue',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'content',
      title: 'New Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter new description for the issue',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'content',
      title: 'Issue Summary',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter summary for the new issue',
      condition: { field: 'operation', value: 'write' },
    },
    {
      id: 'content',
      title: 'Issue Description',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter description for the new issue',
      condition: { field: 'operation', value: 'write' },
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
        const { credential, ...rest } = params

        return {
          accessToken: credential,
          ...rest,
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
    issueTypeId: { type: 'string', required: true },
    // Update operation inputs
    title: { type: 'string', required: false },
    content: { type: 'string', required: false },
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